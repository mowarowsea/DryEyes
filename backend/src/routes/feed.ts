import { Response, Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isOwnedBy } from '../services/ownership.js';
import { changedetectionClient } from '../services/changedetection.js';
import { scanWatchForFeed } from '../services/feedScan.js';
import {
  dismissCandidate,
  getCandidate,
  getFeedConfig,
  listCandidates,
  setFeedConfig,
} from '../services/feedStore.js';
import { FeedCandidate } from '../types/index.js';

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

feedRouter.get('/candidates', (req, res) => {
  const raw = String(req.query.status ?? 'pending');
  const status = STATUSES.includes(raw as FeedCandidate['status'])
    ? (raw as FeedCandidate['status'])
    : undefined;
  const watchId = req.query.watchId ? String(req.query.watchId) : undefined;

  const candidates = listCandidates({ status, watchId }).filter((c) => isOwnedBy(c.watchId, req.user!.id));
  res.json(candidates);
});

feedRouter.post('/candidates/:id/dismiss', (req, res) => {
  const candidate = getCandidate(req.params.id);
  if (!candidate || !ensureOwned(candidate.watchId, req.user!.id, res)) {
    if (!candidate) res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  res.json(dismissCandidate(req.params.id));
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
    res.json(await scanWatchForFeed(watch));
  } catch (err: any) {
    res.status(500).json({ error: '候補の作成に失敗しました', message: err.message });
  }
});
