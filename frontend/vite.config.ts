import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3010,
    host: true,
    // Tailscale 越しに開くと Host ヘッダが <machine>.<tailnet>.ts.net になる。
    // Vite は既定で未知のホストを拒否するため、tailnet のドメインを許可しておく。
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
