import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 通知をタップしたときに開く URL はスマホから叩かれるため localhost では届かない。
// 同一 LAN からアクセスできる IPv4 を既定値として拾う。
// (Tailscale などの 100.64.0.0/10 は同一 LAN からは使えないので候補に含めない)
const PRIVATE_IPV4 = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
// Hyper-V や WSL の仮想スイッチにも私用アドレスが付くが、スマホからは到達できない
const VIRTUAL_INTERFACE = /vethernet|virtualbox|vmware|docker|wsl|hyper-v|loopback/i;

function detectLanAddress(): string {
  const candidates: { name: string; address: string }[] = [];

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      const isIPv4 = address.family === 'IPv4' || (address.family as unknown as number) === 4;
      if (!isIPv4 || address.internal) continue;
      if (PRIVATE_IPV4.test(address.address)) candidates.push({ name, address: address.address });
    }
  }

  const real = candidates.find((c) => !VIRTUAL_INTERFACE.test(c.name));
  return (real || candidates[0])?.address || 'localhost';
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  // ユーザー・セッション・監視の所有者情報を置くディレクトリ（ローカル運用のため JSON ファイル）
  dataDir: process.env.DATA_DIR || path.join(backendRoot, 'data'),
  auth: {
    // ブラウザに保持するトークンの有効期限（日数）。ローカル運用なので長めが既定。
    sessionTtlDays: parseInt(process.env.SESSION_TTL_DAYS || '90', 10),
  },
  app: {
    // 画面 (Vite) のポート
    port: parseInt(process.env.APP_PORT || '3010', 10),
    // ntfy 通知をタップしたときに開く DryEyes 自身の URL。
    // 外出先からも開きたい場合は Tailscale などの URL を APP_BASE_URL に設定する。
    baseUrl: (
      process.env.APP_BASE_URL ||
      `http://${detectLanAddress()}:${process.env.APP_PORT || '3010'}`
    ).replace(/\/$/, ''),
  },
  changedetection: {
    baseUrl: process.env.CHANGEDETECTION_URL || 'http://localhost:5000',
    apiKey: process.env.CHANGEDETECTION_API_KEY || '',
  },
  browser: {
    // クロールに使っている sockpuppetbrowser の CDP エンドポイント。
    // 監視対象ピッカーも同じブラウザで描画して、クロールと同じ絵を見せる。
    // (docker-compose がコンテナの 3000 番をホストの 3020 番へ出している)
    wsUrl: process.env.BROWSER_WS_URL || 'ws://localhost:3020',
  },
  powerdowner: {
    // ダウンロード司令塔。候補を投入する先 (ARCHITECTURE.md 5 章)
    baseUrl: (process.env.POWERDOWNER_URL || 'http://127.0.0.1:3939').replace(/\/$/, ''),
    // PowerDowner の config.json の apiToken と同じ値。
    // 向こうは LAN に開いているので、これが無いと誰でも任意 URL を落とさせられる
    token: process.env.POWERDOWNER_TOKEN || '',
    // 1 回の投入で送る上限。PowerDowner 側も 20 件で切るので、それに合わせて分割する
    batchSize: 20,
  },
  pinax: {
    // 蔵書の台帳 (C:\Users\seamo\pinax)。作者・作品名の表記をここから借りる。
    // 棚に並んでいる綴りをそのまま使えば、落としたファイルが既存のフォルダへ素直に入る
    baseUrl: (process.env.PINAX_URL || 'http://127.0.0.1:3838').replace(/\/$/, ''),
  },
  ntfy: {
    // ホスト／ブラウザから見た ntfy の URL（購読リンクの表示用）
    baseUrl: process.env.NTFY_URL || 'http://localhost:8085',
    // changedetection.io コンテナ内から見た ntfy の URL（通知送信用）。
    // ntfy は別ネットワークのコンテナなので、ホスト経由で到達する必要がある。
    internalUrl: process.env.NTFY_INTERNAL_URL || 'http://host.docker.internal:8085',
    defaultTopic: process.env.NTFY_DEFAULT_TOPIC || 'dryeyes',
  },
};
