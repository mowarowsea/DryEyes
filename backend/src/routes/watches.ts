import { Router } from 'express';
import { changedetectionClient } from '../services/changedetection.js';
import { CreateWatchDto, UpdateWatchDto } from '../types/index.js';

export const watchesRouter = Router();

// 一覧取得
watchesRouter.get('/', async (_req, res) => {
  try {
    const watches = await changedetectionClient.listWatches();
    res.json(watches);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch watches', message: err.message });
  }
});

// 単一取得
watchesRouter.get('/:id', async (req, res) => {
  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    res.json(watch);
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
    const newWatch = await changedetectionClient.createWatch(dto);
    res.status(201).json(newWatch);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create watch', message: err.message });
  }
});

// 更新
watchesRouter.patch('/:id', async (req, res) => {
  try {
    const dto: UpdateWatchDto = req.body;
    const updated = await changedetectionClient.updateWatch(req.params.id, dto);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update watch', message: err.message });
  }
});

// 削除
watchesRouter.delete('/:id', async (req, res) => {
  try {
    await changedetectionClient.deleteWatch(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete watch', message: err.message });
  }
});

// 手動チェック
watchesRouter.post('/:id/check', async (req, res) => {
  try {
    await changedetectionClient.triggerCheck(req.params.id);
    res.json({ success: true, message: 'Check triggered successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to trigger check', message: err.message });
  }
});

// 履歴取得
watchesRouter.get('/:id/history', async (req, res) => {
  try {
    const history = await changedetectionClient.getHistory(req.params.id);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch history', message: err.message });
  }
});
