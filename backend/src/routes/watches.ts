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
import { clearRedirectState, getPendingRedirect, pruneRedirectState } from '../services/redirectReview.js';
import { acceptPendingRedirect, dismissPendingRedirect } from '../services/redirectScan.js';
import { clearCardImage, getCardImage } from '../services/cardImage.js';
import { requireAuth } from '../middleware/auth.js';
import { CreateWatchDto, UpdateWatchDto, WatchDiffResponse, WatchModel } from '../types/index.js';

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
  return {
    ...watch,
    hasUnviewed: hasUnviewedChange(userId, watch.id, watch.lastChanged),
    unviewedCount: countUnviewedChanges(userId, watch.id, watch.snapshotCount, watch.lastChanged),
    lastViewedAt: getViewState(userId, watch.id)?.viewedAt ?? null,
    pendingRedirect: getPendingRedirect(watch.id),
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
    res.json(
      watches.filter((w) => isOwnedBy(w.id, req.user!.id)).map((w) => withViewState(w, req.user!.id))
    );
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch watches', message: err.message });
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
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete watch', message: err.message });
  }
});

// カードの背景に敷く画像。決められなければ 404 を返し、画面側は絵なしの見た目に戻す。
// 画像を BFF が代理で取るのはファビコンと同じ理由で、Referer / UA を見て
// 直リンクを弾くサイトが多いため。
watchesRouter.get('/:id/card-image', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    const asset = await getCardImage(watch);
    if (!asset) {
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(404).end();
    }
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(asset.data);
  } catch {
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.status(404).end();
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

    if (history.length === 0) {
      const empty: WatchDiffResponse = {
        watchId, from: null, to: null, lines: [], added: 0, removed: 0, truncated: false,
        hasUnviewed: false, lastViewedAt, snapshotCount: 0,
      };
      return res.json(empty);
    }

    const latest = history[0];

    // 比較対象が無い（初回スナップショットのみ）か、最新まで確認済みで見るべき変更が残っていない場合は、
    // 過去の差分を蒸し返さず現在保持している値だけを返す。
    const upToDate = !!state && state.snapshotTimestamp >= latest.timestamp;
    if (history.length === 1 || upToDate) {
      const current = await changedetectionClient.getSnapshot(watchId, latest.timestamp);
      const currentOnly: WatchDiffResponse = {
        watchId, from: null, to: latest.timestamp, lines: [], added: 0, removed: 0, truncated: false,
        hasUnviewed: false, lastViewedAt, snapshotCount: history.length,
        currentPreview: splitSnapshotLines(current).slice(0, INITIAL_PREVIEW_LINES),
      };
      return res.json(currentOnly);
    }

    // 比較元は「既読にした時点以前で最も新しいスナップショット」。
    // 既読の記録が無い場合は直前のスナップショットと比較して直近の変更を見せる。
    const viewedBaseline = state
      ? history.find((h) => h.timestamp <= state.snapshotTimestamp)
      : undefined;
    const baseline =
      viewedBaseline && viewedBaseline.timestamp !== latest.timestamp ? viewedBaseline : history[1];

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

// 検知した移転を承認して、監視先を差し替える。
// always を立てると、以後この行き先ホストへの移動は確認なしで追従する
// （example.com ⇄ example.other のように行き来するミラーサイト向け）。
watchesRouter.post('/:id/redirect/accept', async (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  try {
    const proposal = await acceptPendingRedirect(watchId, Boolean(req.body?.always));
    res.json({ success: true, url: proposal.toUrl });
  } catch (err: any) {
    res.status(upstreamStatus(err)).json({ error: 'Failed to accept redirect', message: err.message });
  }
});

// 移転を却下して、監視先を元の URL のままにする。
// always を立てると、以後この行き先への移動は提案しない。
watchesRouter.post('/:id/redirect/dismiss', (req, res) => {
  const watchId = req.params.id;
  if (!ensureOwned(watchId, req.user!.id, res)) return;

  try {
    const proposal = dismissPendingRedirect(watchId, Boolean(req.body?.always));
    res.json({ success: true, url: proposal.fromUrl });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to dismiss redirect', message: err.message });
  }
});
