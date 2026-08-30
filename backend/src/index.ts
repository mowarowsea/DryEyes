import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { watchesRouter } from './routes/watches.js';
import { proxyRouter } from './routes/proxy.js';
import { changedetectionClient } from './services/changedetection.js';
import { buildWatchClickUrl } from './services/ntfyTopic.js';

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/watches', watchesRouter);
app.use('/api/proxy', proxyRouter);

app.listen(config.port, async () => {
  console.log(`[DryEyes BFF] Server is running on http://localhost:${config.port}`);
  console.log(`[DryEyes BFF] Changedetection URL: ${config.changedetection.baseUrl}`);
  console.log(`[DryEyes BFF] ntfy URL: ${config.ntfy.baseUrl}`);
  console.log(`[DryEyes BFF] 通知タップで開く URL: ${config.app.baseUrl}`);
  console.log(`[DryEyes BFF] データ保存先: ${config.dataDir}`);

  // 既存の監視にも通知タップ先を行き渡らせる（changedetection.io 側の設定なので起動時に揃える）
  try {
    const updated = await changedetectionClient.refreshNotificationClickUrls(
      buildWatchClickUrl(config.app.baseUrl)
    );
    if (updated > 0) {
      console.log(`[DryEyes BFF] 既存監視 ${updated} 件の通知タップ先を更新しました`);
    }
  } catch (err: any) {
    // changedetection.io が起動していないだけのこともあるので致命的には扱わない
    console.warn('[DryEyes BFF] 通知タップ先の更新に失敗しました:', err.message);
  }
});
