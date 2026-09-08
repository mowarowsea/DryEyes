// PWA としてインストールできるようにするための最小限の Service Worker。
// 共有シート（Web Share Target）はインストール済みの PWA でしか出てこないため、
// 「オフラインでも何か返せる」ことを示すこの SW が必要になる。
//
// キャッシュは意図的にほぼ持たない。監視状況は常に最新を見たい画面なので、
// 古い HTML や JS を掴んで「更新したのに変わらない」状態になる方が困る。
const OFFLINE_CACHE = 'dryeyes-shell-v1';
// 配信パス（ルート直下とは限らない。例: /DryEyes/）。
const SHELL_URL = new URL('./', self.registration.scope).pathname;
// BFF の API（配信パス配下の api/…）。ここへの応答をシェルで代用しても意味が無い。
const API_PREFIX = SHELL_URL + 'api/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: 'reload' })))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  try {
    return new URL(url).pathname.startsWith(API_PREFIX);
  } catch (e) {
    return false;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 面倒を見るのは、タブに直接開く画面遷移だけ。API や静的ファイルはブラウザ任せで十分。
  //
  // iframe の読み込み（要素ピッカーのプレビュー）も mode は 'navigate' だが対象外にする。
  // ここでシェルを返すと、サーバーが落ちているときにプレビュー枠へ DryEyes 自身の画面が入り、
  // サンドボックスの中では描画できずにただ真っ白になる。ブラウザに任せればエラーページが入り、
  // ピッカー側は「プレビューが届いていない」と気づいて理由を出せる。
  if (request.mode !== 'navigate' || request.destination !== 'document') return;
  if (isApiRequest(request.url)) return;

  event.respondWith(
    fetch(request).catch(async () => {
      // 圏外のときだけ、インストール時に保存しておいたシェルを返す
      const cached = await caches.match(SHELL_URL, { ignoreSearch: true });
      return (
        cached ||
        new Response('<h1>DryEyes</h1><p>オフラインです。</p>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );
    })
  );
});
