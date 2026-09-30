import { Response, Router } from 'express';
import { changedetectionClient } from '../services/changedetection.js';
import { assignOwner, isOwnedBy, pruneMissing, releaseOwner } from '../services/ownership.js';
import { findPublicUserById } from '../services/users.js';
import {
  clearViewStates,
  countUnviewedChanges,
  getViewState,
  hasUnviewedChange,
  markViewed,
  pruneViewStates,
} from '../services/viewState.js';
import { diffSnapshots, splitSnapshotLines } from '../services/diff.js';
import {
  clearRedirectState,
  getPendingRedirect,
  isAllowedRedirect,
  pruneRedirectState,
} from '../services/redirectReview.js';
import { findDuplicateWatch } from '../services/duplicate.js';
import { buildHistoryDiff, selectUnviewedBaseline } from '../services/historyDiff.js';
import { acceptPendingRedirect, dismissPendingRedirect } from '../services/redirectScan.js';
import {
  clearCardImage,
  decodeImageDataUrl,
  fetchCandidateImage,
  formatCrop,
  getCardImage,
  listCardImageCandidates,
  normalizeCrop,
  saveUploadedCardImage,
  setCardImageOverride,
} from '../services/cardImage.js';
import { assertSafeProxyTarget } from '../services/urlSafety.js';
import { requireAuth } from '../middleware/auth.js';
import { clearFeedState, getFeedConfig, pruneFeedState } from '../services/feedStore.js';
import {
  CreateWatchDto,
  RedirectDecisionOptions,
  SaveCardImageDto,
  UpdateWatchDto,
  WatchDiffResponse,
  WatchModel,
} from '../types/index.js';

export const watchesRouter = Router();

// 初回スナップショットしか無いときに返す現在値のプレビュー行数
const INITIAL_PREVIEW_LINES = 30;

// changedetection.io が返したバリデーションエラー（4xx）はそのままクライアントへ伝え、
// それ以外（接続不能など DryEyes 側の都合）は 500 に丸める
const upstreamStatus = (err: any): number =>
  err?.status >= 400 && err.status < 500 ? err.status : 500;

// 監視は必ずログインユーザーに紐づく
watchesRouter.use(requireAuth);

// 他ユーザーの監視は「存在しない」ものとして扱い、IDの存在有無も漏らさない
function ensureOwned(watchId: string, userId: string, res: Response): boolean {
  if (isOwnedBy(watchId, userId)) return true;
  res.status(404).json({ error: 'Not found', message: '監視が見つかりません' });
  return false;
}

// changedetection.io は既読も「移転の確認待ち」も持たないため、DryEyes 側の状態を合成して返す
function withViewState(watch: WatchModel, userId: string): WatchModel {
  const feed = getFeedConfig(watch.id);
  return {
    ...watch,
    hasUnviewed: hasUnviewedChange(userId, watch.id, watch.lastChanged),
    unviewedCount: countUnviewedChanges(userId, watch.id, watch.snapshotCount, watch.lastChanged),
    lastViewedAt: getViewState(userId, watch.id)?.viewedAt ?? null,
    pendingRedirect: getPendingRedirect(watch.id),
    // 一覧の仕分けに要るぶんだけ写す。設定の編集は投入モーダル側の口で行う
    feed: { userId: feed.userId, author: feed.author, title: feed.title, group: feed.group ?? null },
  };
}

// 一覧取得（ログインユーザーの監視のみ）
watchesRouter.get('/', async (req, res) => {
  try {
    const watches = await changedetectionClient.listWatches();
    // changedetection.io 側で直接消された監視の情報を掃除する
    pruneMissing(watches.map((w) => w.id));
    pruneViewStates(watches.map((w) => w.id));
    pruneRedirectState(watches.map((w) => w.id));
    pruneFeedState(watches.map((w) => w.id));
    res.json(
      watches.filter((w) => isOwnedBy(w.id, req.user!.id)).map((w) => withViewState(w, req.user!.id))
    );
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch watches', message: err.message });
  }
});

// 登録前の重複確認。同じページ（表記ゆれや承認済みの移転を含む）を見ている自分の監視を返す。
// パスが固定の /lookup なので、監視 ID を受ける /:id より前に置く。
watchesRouter.get('/lookup', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url parameter is required' });

  const userId = req.user!.id;
  try {
    const watches = (await changedetectionClient.listWatches()).filter((w) => isOwnedBy(w.id, userId));
    const match = findDuplicateWatch(url, watches, {
      pendingRedirectUrlOf: (watchId) => getPendingRedirect(watchId)?.toUrl ?? null,
      isAllowedRedirect: (from, to) => isAllowedRedirect(userId, from, to),
    });
    res.json({
      duplicate: match
        ? { id: match.watch.id, title: match.watch.title, url: match.watch.url, reason: match.reason }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to look up watches', message: err.message });
  }
});

// 単一取得
watchesRouter.get('/:id', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    res.json(withViewState(watch, req.user!.id));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch watch', message: err.message });
  }
});

// 新規作成
watchesRouter.post('/', async (req, res) => {
  try {
    const dto: CreateWatchDto = req.body;
    if (!dto.url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    const newWatch = await changedetectionClient.createWatch(dto, req.user!.ntfyTopic);
    assignOwner(newWatch.id, req.user!.id);
    res.status(201).json(newWatch);
  } catch (err: any) {
    res.status(upstreamStatus(err)).json({ error: 'Failed to create watch', message: err.message });
  }
});

// 別ユーザーへ、同じ設定のコピーを作成する（所有者はコピー先のユーザーになる）
watchesRouter.post('/:id/copy-to', async (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  const userId = String(req.body?.userId || '').trim();
  if (!userId) {
    return res.status(400).json({ error: 'Invalid target', message: 'コピー先のユーザーを選択してください' });
  }

  const target = findPublicUserById(userId);
  if (!target) {
    return res.status(404).json({ error: 'Not found', message: 'そのユーザーは見つかりません' });
  }
  if (target.id === req.user!.id) {
    return res.status(400).json({ error: 'Invalid target', message: '自分自身へはコピーできません' });
  }

  try {
    const source = await changedetectionClient.getWatch(watchId);
    const dto: CreateWatchDto = {
      url: source.url,
      title: source.title,
      fetchBackend: source.fetchBackend,
      checkIntervalMinutes: source.checkIntervalMinutes,
      includeFilters: source.includeFilters,
      subtractedFilters: source.subtractedFilters,
      tag: source.tag,
      // 通知先は指定しない（コピー先ユーザー専用のトピックへ自動で送られる）
    };
    const copy = await changedetectionClient.createWatch(dto, target.ntfyTopic);
    assignOwner(copy.id, target.id);
    res.status(201).json({ success: true, title: copy.title, username: target.username });
  } catch (err: any) {
    res.status(upstreamStatus(err)).json({ error: 'Failed to copy watch', message: err.message });
  }
});

// 更新
watchesRouter.patch('/:id', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    const dto: UpdateWatchDto = req.body;
    const updated = await changedetectionClient.updateWatch(req.params.id, dto, req.user!.ntfyTopic);
    res.json(withViewState(updated, req.user!.id));
  } catch (err: any) {
    res.status(upstreamStatus(err)).json({ error: 'Failed to update watch', message: err.message });
  }
});

// 削除
watchesRouter.delete('/:id', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    await changedetectionClient.deleteWatch(req.params.id);
    releaseOwner(req.params.id);
    clearViewStates(req.params.id);
    clearRedirectState(req.params.id);
    clearCardImage(req.params.id);
    clearFeedState(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete watch', message: err.message });
  }
});

// カードの背景に敷く画像。決められなければ 404 を返し、画面側は絵なしの見た目に戻す。
// 画像を BFF が代理で取るのはファビコンと同じ理由で、Referer / UA を見て
// 直リンクを弾くサイトが多いため。
//
// キャッシュは no-cache（＝毎回問い合わせて、変わっていなければ 304）にする。
// 同じ URL のまま中身が変わりうるエンドポイントなので、max-age で寝かせてしまうと
// 絵を採り直してもブラウザが期限切れまで古い絵を出し続ける。転送量は ETag で抑える。
watchesRouter.get('/:id/card-image', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    const result = await getCardImage(watch);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (!result) return res.status(404).end();

    const { asset, crop } = result;
    // 切り抜きは画像と一緒に返す。別のエンドポイントに分けると、
    // 一覧を開くたびにカードの枚数だけ往復が増えるだけで得るものがない。
    // 中身が変わっていないときは 304 で返すため、ヘッダーは ETag の判定より先に付ける。
    if (crop) res.setHeader('X-Card-Image-Crop', formatCrop(crop));
    res.setHeader('Access-Control-Expose-Headers', 'X-Card-Image-Crop');
    res.setHeader('ETag', asset.etag);
    // ブラウザは複数の検証子を並べたり W/ を付けたりするので、素の一致比較では取りこぼす
    const known = String(req.headers['if-none-match'] || '')
      .split(',')
      .map((v) => v.trim().replace(/^W\//, ''));
    if (known.includes(asset.etag)) return res.status(304).end();

    res.setHeader('Content-Type', asset.contentType);
    res.send(asset.data);
  } catch {
    res.setHeader('Cache-Control', 'private, no-cache');
    res.status(404).end();
  }
});

// 背景に使えそうな画像の候補。監視対象サイトを実際にブラウザで開くので、数十秒かかることがある。
watchesRouter.get('/:id/card-image/candidates', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    res.json(await listCardImageCandidates(watch));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list card image candidates', message: err.message });
  }
});

// 候補のサムネイル。画面から直接読めないのはカード背景と同じ理由（Referer / UA で弾かれる）。
// 宛先は画面が候補一覧から選んだ URL だが、ここは BFF が外へ取りに行く口なので、
// 言われたとおりに叩かず、プレビューと同じ宛先チェックを通す。
watchesRouter.get('/:id/card-image/candidate', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;

  const imageUrl = String(req.query.url || '');
  if (!imageUrl) return res.status(400).json({ error: 'url parameter is required' });

  try {
    await assertSafeProxyTarget(imageUrl);
  } catch {
    return res.status(400).end();
  }

  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    const asset = await fetchCandidateImage(imageUrl, watch.url);
    if (!asset) return res.status(404).end();

    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(asset.data);
  } catch {
    res.status(404).end();
  }
});

// 背景の絵を決める（候補から選ぶ / 手元の画像を登録する / 絵を出さない / 自動へ戻す）
watchesRouter.put('/:id/card-image', async (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  const dto: SaveCardImageDto = req.body || {};
  const crop = normalizeCrop(dto.crop);

  try {
    if (dto.mode === 'auto') {
      setCardImageOverride(watchId, null);
    } else if (dto.mode === 'none') {
      setCardImageOverride(watchId, { mode: 'none', updatedAt: new Date().toISOString() });
    } else if (dto.mode === 'url') {
      const imageUrl = String(dto.url || '');
      if (!imageUrl) throw new Error('画像の URL が指定されていません');
      // 保存した URL は以後カードを描くたびに BFF が取りに行く。内部向けの宛先を
      // 覚え込まされないよう、ここで一度だけ確かめる。
      await assertSafeProxyTarget(imageUrl);
      setCardImageOverride(watchId, {
        mode: 'url',
        imageUrl,
        crop,
        updatedAt: new Date().toISOString(),
      });
    } else if (dto.mode === 'upload') {
      const uploadFile = saveUploadedCardImage(watchId, decodeImageDataUrl(dto.dataUrl));
      setCardImageOverride(watchId, {
        mode: 'upload',
        uploadFile,
        crop,
        updatedAt: new Date().toISOString(),
      });
    } else {
      throw new Error('指定が正しくありません');
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to save card image', message: err.message });
  }
});

// 手動チェック
watchesRouter.post('/:id/check', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    await changedetectionClient.triggerCheck(req.params.id);
    res.json({ success: true, message: 'Check triggered successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to trigger check', message: err.message });
  }
});

// 履歴取得
watchesRouter.get('/:id/history', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    const history = await changedetectionClient.getHistory(req.params.id);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch history', message: err.message });
  }
});

// 履歴の 1 件分の差分（そのスナップショットと、その直前のスナップショットの比較）
watchesRouter.get('/:id/history/:timestamp/diff', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;

  const timestamp = Number(req.params.timestamp);
  if (!Number.isInteger(timestamp)) {
    return res.status(400).json({ error: 'Invalid timestamp', message: '時刻の指定が正しくありません' });
  }

  try {
    const result = await buildHistoryDiff(changedetectionClient, req.params.id, timestamp);
    if (!result) {
      return res.status(404).json({ error: 'Not found', message: 'そのスナップショットは見つかりません' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to build history diff', message: err.message });
  }
});

// 差分取得（前回このユーザーが確認した時点 → 最新スナップショット）
watchesRouter.get('/:id/diff', async (req, res) => {
  const watchId = req.params.id;
  const userId = req.user!.id;
  if (!ensureOwned(watchId, userId, res)) return;

  try {
    // 新しい順
    const history = await changedetectionClient.getHistory(watchId);
    const state = getViewState(userId, watchId);
    const lastViewedAt = state?.viewedAt ?? null;
    const lastViewedSnapshot = state?.snapshotTimestamp ?? null;

    if (history.length === 0) {
      const empty: WatchDiffResponse = {
        watchId, from: null, to: null, lines: [], added: 0, removed: 0, truncated: false,
        hasUnviewed: false, lastViewedAt, snapshotCount: 0,
      };
      return res.json(empty);
    }

    const latest = history[0];

    // 比較元は「既読にした時点以前で最も新しいスナップショット」。未読の更新が複数溜まって
    // いても、その全部を 1 つの差分として見せる。一度も見ていなければ初回まで遡る。
    const upToDate = !!state && state.snapshotTimestamp >= latest.timestamp;
    const baseline = upToDate ? null : selectUnviewedBaseline(history, lastViewedSnapshot);

    // 比較対象が無い（初回スナップショットのみ）か、最新まで確認済みで見るべき変更が残っていない場合は、
    // 過去の差分を蒸し返さず現在保持している値だけを返す。
    if (!baseline) {
      const current = await changedetectionClient.getSnapshot(watchId, latest.timestamp);
      const currentOnly: WatchDiffResponse = {
        watchId, from: null, to: latest.timestamp, lines: [], added: 0, removed: 0, truncated: false,
        hasUnviewed: false, lastViewedAt, snapshotCount: history.length,
        currentPreview: splitSnapshotLines(current).slice(0, INITIAL_PREVIEW_LINES),
      };
      return res.json(currentOnly);
    }

    const [before, after] = await Promise.all([
      changedetectionClient.getSnapshot(watchId, baseline.timestamp),
      changedetectionClient.getSnapshot(watchId, latest.timestamp),
    ]);

    const diff = diffSnapshots(before, after);
    const response: WatchDiffResponse = {
      watchId,
      from: baseline.timestamp,
      to: latest.timestamp,
      ...diff,
      hasUnviewed: true, // 上で確認済みのケースは返し終えているので、ここに来るのは未読のときだけ
      lastViewedAt,
      snapshotCount: history.length,
    };
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to build diff', message: err.message });
  }
});

// 既読にする（最新スナップショットまで確認済みとして記録）
watchesRouter.post('/:id/viewed', async (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  try {
    const history = await changedetectionClient.getHistory(watchId);
    // 履歴がまだ無い監視でも既読にできるよう現在時刻でフォールバックする
    const latest = history[0]?.timestamp ?? Math.floor(Date.now() / 1000);
    // このときのスナップショット数も残しておくと、次の一覧で未読の更新回数を数えられる
    const state = markViewed(req.user!.id, watchId, latest, history.length);
    res.json({ success: true, ...state });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to mark as viewed', message: err.message });
  }
});

// 移転の確認に対する答え方。
//   always:   以後この「転送元 → 転送先」の組は確認なしで処理する（このユーザーの監視すべてで）
//   onlyThis: 同じ組で確認待ちの他の監視には手を付けず、この 1 件だけ処理する（既定はまとめて処理）
const decisionOptions = (body: any): RedirectDecisionOptions => ({
  always: Boolean(body?.always),
  onlyThis: Boolean(body?.onlyThis),
});

// 検知した移転を承認して、監視先を差し替える。
// 同じ組で確認待ちの監視も、このユーザーの分はまとめて差し替える。
watchesRouter.post('/:id/redirect/accept', async (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  try {
    const result = await acceptPendingRedirect(req.user!.id, watchId, decisionOptions(req.body));
    res.json({
      success: true,
      url: result.proposal.toUrl,
      applied: result.applied,
      failed: result.failed,
    });
  } catch (err: any) {
    res.status(upstreamStatus(err)).json({ error: 'Failed to accept redirect', message: err.message });
  }
});

// 移転を却下して、監視先を元の URL のままにする。
// 同じ組で確認待ちの監視も、このユーザーの分はまとめて畳む。
watchesRouter.post('/:id/redirect/dismiss', (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  try {
    const result = dismissPendingRedirect(req.user!.id, watchId, decisionOptions(req.body));
    res.json({
      success: true,
      url: result.proposal.fromUrl,
      applied: result.applied,
      failed: result.failed,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to dismiss redirect', message: err.message });
  }
});
