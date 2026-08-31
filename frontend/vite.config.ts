import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { buildManifest } from './manifest';

// DryEyes を配信するパス。Tailscale の 1 ホストに複数のツールを並べられるよう、
// 既定でサブパス (/DryEyes/) 配下に置く。ルート直下で配信したい場合は BASE_PATH=/ を渡す。
// 末尾のスラッシュは Vite の base の仕様として必須。
const base = (process.env.BASE_PATH || '/DryEyes/').replace(/\/*$/, '/');

// マニフェストは配信パスを埋め込んで組み立てるため、静的ファイルではなくここで出力する。
function manifestPlugin(): Plugin {
  const body = () => JSON.stringify(buildManifest(base), null, 2);
  const FILE = 'manifest.webmanifest';

  return {
    name: 'dryeyes-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // base 付き・base 抜きのどちらで届いても返す
        // （前段のプロキシがパスを剥がす構成があるため）
        const path = (req.url || '').split('?')[0];
        if (path !== `${base}${FILE}` && path !== `/${FILE}`) return next();

        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.end(body());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FILE, source: body() });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [react(), manifestPlugin()],
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
