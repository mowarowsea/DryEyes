import { Router } from 'express';
import { changedetectionClient } from '../services/changedetection.js';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
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
