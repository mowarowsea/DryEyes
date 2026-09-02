import { Router } from 'express';
import { changedetectionClient } from '../services/changedetection.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';

export const healthRouter = Router();

// 接続先 URL や changedetection.io の systeminfo を含むので、ログイン済みにだけ返す。
// 画面がこれを使うのはログイン後のダッシュボードだけなので、公開する理由が無い。
healthRouter.get('/', requireAuth, async (_req, res) => {
  let changedetectionStatus = 'disconnected';
  let systemInfo = null;

  try {
    systemInfo = await changedetectionClient.getSystemInfo();
    changedetectionStatus = 'connected';
  } catch (err: any) {
    changedetectionStatus = `error: ${err.message}`;
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      changedetectionUrl: config.changedetection.baseUrl,
      ntfyUrl: config.ntfy.baseUrl,
      defaultTopic: config.ntfy.defaultTopic,
    },
    changedetection: {
      status: changedetectionStatus,
      info: systemInfo,
    },
  });
});
