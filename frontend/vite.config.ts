import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DryEyes を配信するパス。Tailscale の 1 ホストに複数のツールを並べられるよう、
// 既定でサブパス (/DryEyes/) 配下に置く。ルート直下で配信したい場合は BASE_PATH=/ を渡す。
// 末尾のスラッシュは Vite の base の仕様として必須。
const base = (process.env.BASE_PATH || '/DryEyes/').replace(/\/*$/, '/');

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 3010,
    host: true,
    // Tailscale 越しに開くと Host ヘッダが <machine>.<tailnet>.ts.net になる。
    // Vite は既定で未知のホストを拒否するため、tailnet のドメインを許可しておく。
    allowedHosts: ['.ts.net'],
    proxy: {
      // 画面が base 配下にあるので、API 呼び出しも `<base>api/...` で飛んでくる。
      // BFF 自身は `/api` で待っているため、転送時に base を取り除く。
      [`${base}api`]: {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(`${base}api`, '/api'),
      },
    },
  },
});
