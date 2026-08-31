import { Router } from 'express';
import { changedetectionClient } from '../services/changedetection.js';
import { getFavicon } from '../services/favicon.js';

export const publicWatchesRouter = Router();

// ntfy のクライアント（スマホアプリ等）が通知アイコンを取得しに来るための公開エンドポイント。
// DryEyes へのログインは持っていない前提なので認証は課さない
// （UUID を知っていても、返るのは監視対象サイトの favicon 画像だけ）。
publicWatchesRouter.get('/:id/favicon', async (req, res) => {
  try {
    const watch = await changedetectionClient.getWatch(req.params.id);
    const asset = await getFavicon(watch.url);
    if (!asset) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', asset.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(asset.data);
  } catch {
    res.status(404).end();
  }
});
