import { Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isOwnedBy } from '../services/ownership.js';
import { changedetectionClient } from '../services/changedetection.js';
import { scanWatchForFeed } from '../services/feedScan.js';
import { sendCandidates } from '../services/feedSend.js';
import {
  dismissCandidate,
  getCandidate,
  getFeedConfig,
  listCandidates,
  restoreCandidate,
  setFeedConfig,
  withFeedMeta,
} from '../services/feedStore.js';
import { FeedCandidate, FeedCandidateWithState } from '../types/index.js';
import { checkItems, deleteLibraryItem, listUsers, registerHave } from '../services/powerdowner.js';
import { searchSeries } from '../services/pinax.js';

// PowerDowner への投入候補まわり。
//
// 区分けは対象／対象外の 2 つ。振り分けを間違えても対象外から戻せる
// (ARCHITECTURE.md 5 章「承認フローと投入ポインタ」)。

export const feedRouter = Router();
feedRouter.use(requireAuth);

/** 他人の監視の候補を覗けないようにする。所有していなければ 404 を返して存在も伏せる */
function ensureOwned(watchId: string, userId: string, res: Response): boolean {
  if (isOwnedBy(watchId, userId)) return true;
  res.status(404).json({ error: 'Watch not found' });
  return false;
}

const STATUSES: FeedCandidate['status'][] = ['pending', 'sent', 'dismissed'];

/**
 * 候補を投入先の PowerDowner ユーザーごとに束ねる。
 * 台帳がユーザー単位なので、所持の判定も登録もユーザーを跨げない。
 * 投入先が未設定の監視の候補は、誰の手元の話か決まらないので落とす。
 */
function groupByPowerdownerUser(candidates: FeedCandidate[]): Map<number, FeedCandidate[]> {
  const byUser = new Map<number, FeedCandidate[]>();
  for (const candidate of candidates) {
    const userId = getFeedConfig(candidate.watchId).userId;
    if (userId === null) continue;
    const list = byUser.get(userId) ?? [];
    list.push(candidate);
    byUser.set(userId, list);
  }
  return byUser;
}

feedRouter.get('/candidates', async (req, res) => {
  const raw = String(req.query.status ?? 'pending');
  const status = STATUSES.includes(raw as FeedCandidate['status'])
    ? (raw as FeedCandidate['status'])
    : undefined;
  const watchId = req.query.watchId ? String(req.query.watchId) : undefined;

  const candidates = listCandidates({ status, watchId }).filter((c) => isOwnedBy(c.watchId, req.user!.id));

  // 「もう持っているか」は PowerDowner の台帳しか知らないので聞きに行く。
  // 落ちていても一覧そのものは出す (判定が付かないだけ) — ここで失敗させると
  // PowerDowner を起動していない間は候補を眺めることもできなくなる
  //
  // 台帳は PowerDowner のユーザー単位なので、投入先ユーザーごとに分けて聞く。
  // 投入先が未設定の監視は誰の手元の話か決まらないので、判定を付けずに出す
  const checks = new Map<
    string,
    { state: 'new' | 'skip' | 'merge'; reason: string | null; volumeFrom: number | null; volumeTo: number | null }
  >();
  for (const [userId, group] of groupByPowerdownerUser(candidates)) {
    try {
      // 投入するときと同じメタで聞く。ここだけ積んだ時点の写しを使うと、
      // 台帳に載っているものを「持っていない」と言ってしまう
      for (const result of await checkItems(userId, group.map(withFeedMeta))) {
        if (result.sourceKey) {
          checks.set(result.sourceKey, {
            state: result.state,
            reason: result.reason,
            volumeFrom: result.volumeFrom,
            volumeTo: result.volumeTo,
          });
        }
      }
    } catch {
      /* 判定なしで返す */
    }
  }

  const withState: FeedCandidateWithState[] = candidates.map((c) => ({
    ...c,
    powerdowner: checks.get(c.sourceKey) ?? null,
  }));
  res.json(withState);
});

/**
 * 選んだ候補を PowerDowner へ送る。
 * 監視ごとの設定 (投入先ユーザー・保存先) でまとめ、上限を超える分は分割して順に送る。
 *
 * `resend` を立てると投入済みのものも送り直す。PowerDowner 側でジョブを消して
 * しまったときの入れ直し口で、人が画面から押したときだけ立つ。
 */
feedRouter.post('/candidates/send', async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: '投入する候補を選んでください' });
    return;
  }
  try {
    res.json(await sendCandidates(ids, req.user!.id, { resend: req.body?.resend === true }));
  } catch (err: any) {
    res.status(500).json({ error: '投入に失敗しました', message: err.message });
  }
});

/**
 * 対象外にする。PowerDowner の台帳へ「所持済み」として登録したうえで候補を畳む。
 *
 * 「今は落とさないが、あとで落とすかもしれない」という中間状態は置いていない。
 * 対象か対象外かの 2 つで足りるので、迷いどころを増やさない。
 * 戻せるように、登録した台帳 ID を候補に控えておく。
 */
feedRouter.post('/candidates/exclude', async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: '対象外にする候補を選んでください' });
    return;
  }

  const targets = ids
    .map((id) => getCandidate(id))
    .filter((c): c is FeedCandidate => !!c && isOwnedBy(c.watchId, req.user!.id));

  try {
    // 台帳はユーザー単位。監視ごとに投入先が違いうるので、まとめてから送る
    const itemIdOf = new Map<string, number>();
    let registered = 0;
    let skipped = 0;
    for (const [userId, group] of groupByPowerdownerUser(targets)) {
      const result = await registerHave(
        userId,
        group.map(withFeedMeta).map((c) => ({
          sourceKey: c.sourceKey,
          title: c.meta.title ?? c.meta.rawText,
          author: c.meta.author,
          volumes: c.meta.volume,
        }))
      );
      for (const item of result.created) {
        if (item.sourceKey) itemIdOf.set(item.sourceKey, item.id);
      }
      registered += result.created.length;
      skipped += result.skipped;
    }
    // 台帳に入ったかどうかに関わらず候補からは外す。
    // 巻数を読めないもの・投入先が未設定のものを残しても、次に押して結果が変わるわけではない
    for (const candidate of targets) {
      dismissCandidate(candidate.id, itemIdOf.get(candidate.sourceKey) ?? null);
    }
    res.json({ registered, skipped, excluded: targets.length });
  } catch (err: any) {
    res.status(502).json({ error: '所持の登録に失敗しました', message: err.message });
  }
});

/** 対象外を取り消す。台帳へ入れたぶんも一緒に消して、元の状態へ戻す */
feedRouter.post('/candidates/:id/restore', async (req, res) => {
  const candidate = getCandidate(req.params.id);
  if (!candidate) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  if (!ensureOwned(candidate.watchId, req.user!.id, res)) return;

  if (candidate.libraryItemId) {
    try {
      await deleteLibraryItem(candidate.libraryItemId);
    } catch (err: any) {
      res.status(502).json({ error: '所持登録を取り消せませんでした', message: err.message });
      return;
    }
  }
  res.json(restoreCandidate(req.params.id));
});

feedRouter.get('/powerdowner/users', async (_req, res) => {
  try {
    res.json(await listUsers());
  } catch (err: any) {
    res.status(502).json({ error: 'PowerDowner のユーザー一覧を取れません', message: err.message });
  }
});

/**
 * 投入設定の作者・作品名を、蔵書 (Pinax) の綴りから選べるようにする。
 *
 * 手で書くと棚と 1 文字違うだけで別フォルダに割れるので、既にある綴りを借りる
 * (services/pinax.ts)。Pinax が止まっていても投入設定自体は手入力で使えるように、
 * 失敗はここで止めて画面側に握り潰させる。
 */
feedRouter.get('/pinax/series', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    res.json(await searchSeries(q));
  } catch (err: any) {
    res.status(502).json({ error: '蔵書を引けません', message: err.message });
  }
});

feedRouter.get('/watches/:watchId', (req, res) => {
  if (!ensureOwned(req.params.watchId, req.user!.id, res)) return;
  res.json(getFeedConfig(req.params.watchId));
});

feedRouter.put('/watches/:watchId', (req, res) => {
  if (!ensureOwned(req.params.watchId, req.user!.id, res)) return;
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};

  if (body.autoSend !== undefined) patch.autoSend = Boolean(body.autoSend);
  if (body.userId !== undefined) {
    patch.userId = body.userId === null ? null : Number(body.userId);
    if (patch.userId !== null && !Number.isInteger(patch.userId)) {
      res.status(400).json({ error: 'userId は整数で指定してください' });
      return;
    }
  }
  for (const key of ['author', 'title'] as const) {
    if (body[key] !== undefined) {
      const value = body[key] === null ? null : String(body[key]).trim();
      patch[key] = value || null;
    }
  }
  if (body.destDir !== undefined) {
    const dir = body.destDir === null ? null : String(body.destDir).trim();
    patch.destDir = dir || null;
  }
  if (body.itemPattern !== undefined) {
    const pattern = body.itemPattern === null ? null : String(body.itemPattern).trim();
    if (pattern) {
      // 壊れた正規表現は保存時に弾く。抽出時は「当たらなかった」と同じ扱いになるので、
      // ここで教えないと「なぜメタが取れないのか」が分からない
      try {
        new RegExp(pattern);
      } catch (err: any) {
        res.status(400).json({ error: `正規表現として読めません: ${err.message}` });
        return;
      }
    }
    patch.itemPattern = pattern || null;
  }

  res.json(setFeedConfig(req.params.watchId, patch));
});

feedRouter.post('/watches/:watchId/scan', async (req, res) => {
  if (!ensureOwned(req.params.watchId, req.user!.id, res)) return;
  try {
    const watch = await changedetectionClient.getWatch(req.params.watchId);
    // all を立てると差分を見ずにページ全体を候補にする (登録直後の洗い出し)
    const mode = req.body?.all === true || req.query.all === 'true' ? 'all' : 'increment';
    res.json(await scanWatchForFeed(watch, undefined, { mode }));
  } catch (err: any) {
    res.status(500).json({ error: '候補の作成に失敗しました', message: err.message });
  }
});
