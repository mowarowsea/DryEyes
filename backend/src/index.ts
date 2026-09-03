import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { watchesRouter } from './routes/watches.js';
import { proxyRouter } from './routes/proxy.js';
import { publicWatchesRouter } from './routes/publicFavicon.js';
import { changedetectionClient } from './services/changedetection.js';
import { buildWatchClickUrl, buildWatchFaviconUrl } from './services/ntfyTopic.js';
import { startRedirectScanner } from './services/redirectScan.js';

// Cloudflare 由来の 403 を検知したら User-Agent を差し替えて再チェックするジョブの実行間隔。
// 各監視のチェック間隔（最短でも分単位）に対して十分短く、かつ無駄打ちしすぎない値。
const CLOUDFLARE_RETRY_POLL_INTERVAL_MS = 5 * 60 * 1000;

const app = express();

// 画面は Vite（3010）越しに /api を叩くので、ブラウザから見れば同一オリジンになり
// CORS は本来出番が無い。直接 3001 を叩く場合のために口は残しつつ、
// 任意のサイトから API を読まれないよう出せる相手を絞る。
//
// Origin を持たない要求（ntfy のスマホアプリが通知アイコンを取りに来る、curl での確認など）は
// ブラウザ発ではないので通す。CORS はブラウザに読ませてよいかを答える仕組みでしかない。
const allowedOrigins = new Set(
  [
    config.app.baseUrl,
    `http://localhost:${config.app.port}`,
    `http://127.0.0.1:${config.app.port}`,
  ].map((url) => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  })
);

app.use(
  cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  })
);
// 既定の 100KB では、カード背景に手元の画像を登録する要求（data: URL を JSON に載せる）が
// 入らない。画像そのものの上限は保存側 (cardImage) が実物を見て弾くので、
// ここは base64 で膨らむぶんを見込んだ受け皿の広さだけを決める。
app.use(express.json({ limit: '8mb' }));

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/watches', watchesRouter);
app.use('/api/proxy', proxyRouter);
// ntfy のクライアントが通知アイコンを取りに来る公開エンドポイント（認証なし）
app.use('/api/public/watches', publicWatchesRouter);

app.listen(config.port, async () => {
  console.log(`[DryEyes BFF] Server is running on http://localhost:${config.port}`);
  console.log(`[DryEyes BFF] Changedetection URL: ${config.changedetection.baseUrl}`);
  console.log(`[DryEyes BFF] ntfy URL: ${config.ntfy.baseUrl}`);
  console.log(`[DryEyes BFF] 通知タップで開く URL: ${config.app.baseUrl}`);
  console.log(`[DryEyes BFF] データ保存先: ${config.dataDir}`);

  // 既存の監視にも通知タップ先とテンプレートを行き渡らせる
  // （changedetection.io 側の設定なので起動時に揃える）
  try {
    const updated = await changedetectionClient.syncNotificationSettings(
      buildWatchClickUrl(config.app.baseUrl),
      buildWatchFaviconUrl(config.app.baseUrl)
    );
    if (updated > 0) {
      console.log(`[DryEyes BFF] 既存監視 ${updated} 件の通知設定を更新しました`);
    }
  } catch (err: any) {
    // changedetection.io が起動していないだけのこともあるので致命的には扱わない
    console.warn('[DryEyes BFF] 通知設定の同期に失敗しました:', err.message);
  }

  // Cloudflare 由来の 403 を User-Agent 差し替えで解消できないか、定期的に確認する
  const runCloudflareRetry = () => {
    changedetectionClient.retryCloudflareBlockedWatches().catch((err: any) => {
      console.warn('[DryEyes BFF] Cloudflare UA retry の実行に失敗しました:', err.message);
    });
  };
  runCloudflareRetry();
  setInterval(runCloudflareRetry, CLOUDFLARE_RETRY_POLL_INTERVAL_MS);

  // 監視対象が別ドメインへ移転していないかを定期的に確かめる。
  // 見つけても URL は勝手に変えず、画面で確認してもらう（承認済みの行き先だけ自動で追従する）。
  startRedirectScanner();
});
