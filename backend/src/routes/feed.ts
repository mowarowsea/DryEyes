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
  setFeedConfig,
} from '../services/feedStore.js';
import { FeedCandidate, FeedCandidateWithState } from '../types/index.js';
import { checkItems, registerHave } from '../services/powerdowner.js';

// PowerDowner への投入候補まわり。
//
// 当面は自動投入しない。ここで候補を確認し、押されたものだけを送る
// (ARCHITECTURE.md 5 章「承認フローと投入ポインタ」)。投入そのものは未実装。

export const feedRouter = Router();
feedRouter.use(requireAuth);

/** 他人の監視の候補を覗けないようにする。所有していなければ 404 を返して存在も伏せる */
function ensureOwned(watchId: string, userId: string, res: Response): boolean {
  if (isOwnedBy(watchId, userId)) return true;
  res.status(404).json({ error: 'Watch not found' });
  return false;
}

const STATUSES: FeedCandidate['status'][] = ['pending', 'sent', 'dismissed'];

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
  const checks = new Map<string, { state: 'new' | 'skip' | 'merge'; reason: string | null }>();
  try {
    for (const result of await checkItems(candidates)) {
      if (result.sourceKey) checks.set(result.sourceKey, { state: result.state, reason: result.reason });
    }
  } catch {
    /* 判定なしで返す */
  }

  const withState: FeedCandidateWithState[] = candidates.map((c) => ({
    ...c,
    powerdowner: checks.get(c.sourceKey) ?? null,
  }));
  res.json(withState);
});

/**
 * 「これは既に持っている」を PowerDowner の台帳へ登録し、候補を片付ける。
 * 巻数を読めないものは向こうの重なり判定に参加できないため、登録されず見送りになる。
 */
feedRouter.post('/candidates/have', async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: '所持済みにする候補を選んでください' });
    return;
  }

  const targets = ids
    .map((id) => getCandidate(id))
    .filter((c): c is FeedCandidate => !!c && isOwnedBy(c.watchId, req.user!.id));

  try {
    const result = await registerHave(
      targets.map((c) => ({ title: c.meta.title ?? c.meta.rawText, author: c.meta.author, volumes: c.meta.volume }))
    );
    // 台帳に入ったかどうかに関わらず候補からは外す。
    // 巻数が読めないものを候補に残しても、次に押しても同じ結果にしかならない
    for (const candidate of targets) dismissCandidate(candidate.id);
    res.json({ registered: result.created.length, skipped: result.skipped, dismissed: targets.length });
  } catch (err: any) {
    res.status(502).json({ error: err.message || '所持の登録に失敗しました' });
  }
});

feedRouter.post('/candidates/:id/dismiss', (req, res) => {
  const candidate = getCandidate(req.params.id);
  if (!candidate || !ensureOwned(candidate.watchId, req.user!.id, res)) {
    if (!candidate) res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  res.json(dismissCandidate(req.params.id));
});

/**
 * 選んだ候補を PowerDowner へ送る。
 * 監視ごとの設定 (投入先ユーザー・保存先) でまとめ、上限を超える分は分割して順に送る。
 */
feedRouter.post('/candidates/send', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: '投入する候補を選んでください' });
    return;
  }
  try {
    res.json(await sendCandidates(ids, req.user!.id));
  } catch (err: any) {
    res.status(500).json({ error: '投入に失敗しました', message: err.message });
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

  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.autoSend !== undefined) patch.autoSend = Boolean(body.autoSend);
  if (body.userId !== undefined) {
    patch.userId = body.userId === null ? null : Number(body.userId);
    if (patch.userId !== null && !Number.isInteger(patch.userId)) {
      res.status(400).json({ error: 'userId は整数で指定してください' });
      return;
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
