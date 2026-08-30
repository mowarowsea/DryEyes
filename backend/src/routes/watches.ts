import { Response, Router } from 'express';
import { changedetectionClient } from '../services/changedetection.js';
import { assignOwner, isOwnedBy, pruneMissing, releaseOwner } from '../services/ownership.js';
import {
  clearViewStates,
  getViewState,
  hasUnviewedChange,
  markViewed,
  pruneViewStates,
} from '../services/viewState.js';
import { diffSnapshots, splitSnapshotLines } from '../services/diff.js';
import { requireAuth } from '../middleware/auth.js';
import { CreateWatchDto, UpdateWatchDto, WatchDiffResponse, WatchModel } from '../types/index.js';

export const watchesRouter = Router();

// 初回スナップショットしか無いときに返す現在値のプレビュー行数
const INITIAL_PREVIEW_LINES = 30;

// 監視は必ずログインユーザーに紐づく
watchesRouter.use(requireAuth);

// 他ユーザーの監視は「存在しない」ものとして扱い、IDの存在有無も漏らさない
function ensureOwned(watchId: string, userId: string, res: Response): boolean {
  if (isOwnedBy(watchId, userId)) return true;
  res.status(404).json({ error: 'Not found', message: '監視が見つかりません' });
  return false;
}

// changedetection.io は既読を持たないため、DryEyes 側の既読状態を合成して返す
function withViewState(watch: WatchModel, userId: string): WatchModel {
  return {
    ...watch,
    hasUnviewed: hasUnviewedChange(userId, watch.id, watch.lastChanged),
    lastViewedAt: getViewState(userId, watch.id)?.viewedAt ?? null,
  };
}

// 一覧取得（ログインユーザーの監視のみ）
watchesRouter.get('/', async (req, res) => {
  try {
    const watches = await changedetectionClient.listWatches();
    // changedetection.io 側で直接消された監視の情報を掃除する
    pruneMissing(watches.map((w) => w.id));
    pruneViewStates(watches.map((w) => w.id));
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
    // changedetection.io が返したバリデーションエラーはそのままクライアントへ伝える
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: 'Failed to create watch', message: err.message });
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
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: 'Failed to update watch', message: err.message });
  }
});

// 削除
watchesRouter.delete('/:id', async (req, res) => {
  if (!ensureOwned(req.params.id, req.user!.id, res)) return;
  try {
    await changedetectionClient.deleteWatch(req.params.id);
    releaseOwner(req.params.id);
    clearViewStates(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete watch', message: err.message });
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

    // まだ一度もスナップショットが更新されていない場合は比較対象が無いので現在値だけ返す
    if (history.length === 1) {
      const current = await changedetectionClient.getSnapshot(watchId, latest.timestamp);
      const initial: WatchDiffResponse = {
        watchId, from: null, to: latest.timestamp, lines: [], added: 0, removed: 0, truncated: false,
        hasUnviewed: false, lastViewedAt, snapshotCount: 1,
        currentPreview: splitSnapshotLines(current).slice(0, INITIAL_PREVIEW_LINES),
      };
      return res.json(initial);
    }

    // 比較元は「既読にした時点以前で最も新しいスナップショット」。
    // 未読が無い / 記録が無い場合は直前のスナップショットと比較して直近の変更を見せる。
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
      hasUnviewed: !state || state.snapshotTimestamp < latest.timestamp,
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
    const state = markViewed(req.user!.id, watchId, latest);
    res.json({ success: true, ...state });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to mark as viewed', message: err.message });
  }
});
