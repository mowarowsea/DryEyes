import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// ヘッダのロゴ文字用。欧文だけなので latin サブセットの太字1本に絞っている。
import '@fontsource/nunito/latin-800.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA としてインストールできるようにする。共有シートから登録する導線がこれに乗る。
// http://<LAN IP> のような secure context でない環境では serviceWorker 自体が生えないため、
// 登録は best-effort に留め、失敗しても通常の Web アプリとして動かす。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 非 secure context・未対応ブラウザではインストール導線が出ないだけ */
    });
  });
}
