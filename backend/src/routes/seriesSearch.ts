import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { changedetectionClient } from '../services/changedetection.js';
import { isOwnedBy } from '../services/ownership.js';
import { findDuplicateWatch } from '../services/duplicate.js';
import { getPendingRedirect, isAllowedRedirect } from '../services/redirectReview.js';
import { addSite, listSites, removeSite, searchAllSites, updateSite } from '../services/seriesSearch.js';

// アップロードサイトの横断検索と、その台帳 (services/seriesSearch.ts)。
export const seriesSearchRouter = Router();

seriesSearchRouter.use(requireAuth);

seriesSearchRouter.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q parameter is required' });

  const userId = req.user!.id;
  try {
    const watches = (await changedetectionClient.listWatches()).filter((w) => isOwnedBy(w.id, userId));
    const deps = {
      pendingRedirectUrlOf: (watchId: string) => getPendingRedirect(watchId)?.toUrl ?? null,
      isAllowedRedirect: (from: string, to: string) => isAllowedRedirect(userId, from, to),
    };
    res.json(await searchAllSites(q, (url) => findDuplicateWatch(url, watches, deps)?.watch.id ?? null));
  } catch (err: any) {
    res.status(500).json({ error: '検索に失敗しました', message: err.message });
  }
});

// 検索 URL は {q} を含む http(s) の URL でないと検索しようがない
function invalidSearchUrl(value: unknown): string | null {
  const url = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return '検索 URL は http(s):// で始めてください';
  if (!url.includes('{q}')) return '検索 URL に {q} (作品名が入る場所) を入れてください';
  return null;
}

seriesSearchRouter.get('/sites', (_req, res) => {
  res.json(listSites());
});

seriesSearchRouter.post('/sites', (req, res) => {
  const label = String(req.body?.label ?? '').trim();
  const problem = invalidSearchUrl(req.body?.searchUrl);
  if (!label) return res.status(400).json({ error: 'サイト名を入れてください' });
  if (problem) return res.status(400).json({ error: problem });
  res.status(201).json(addSite(label, String(req.body.searchUrl).trim()));
});

seriesSearchRouter.patch('/sites/:id', (req, res) => {
  const body = req.body ?? {};
  const patch: { label?: string; searchUrl?: string; enabled?: boolean } = {};
  if (body.label !== undefined) patch.label = String(body.label).trim();
  if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
  if (body.searchUrl !== undefined) {
    const problem = invalidSearchUrl(body.searchUrl);
    if (problem) return res.status(400).json({ error: problem });
    patch.searchUrl = String(body.searchUrl).trim();
  }
  const updated = updateSite(req.params.id, patch);
  if (!updated) return res.status(404).json({ error: 'サイトが見つかりません' });
  res.json(updated);
});

seriesSearchRouter.delete('/sites/:id', (req, res) => {
  if (!removeSite(req.params.id)) return res.status(404).json({ error: 'サイトが見つかりません' });
  res.status(204).end();
});
