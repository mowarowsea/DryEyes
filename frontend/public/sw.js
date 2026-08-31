// PWA としてインストールできるようにするための最小限の Service Worker。
// 共有シート（Web Share Target）はインストール済みの PWA でしか出てこないため、
// 「オフラインでも何か返せる」ことを示すこの SW が必要になる。
//
// キャッシュは意図的にほぼ持たない。監視状況は常に最新を見たい画面なので、
// 古い HTML や JS を掴んで「更新したのに変わらない」状態になる方が困る。
const OFFLINE_CACHE = 'dryeyes-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request('/', { cache: 'reload' })))
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 画面遷移だけ面倒を見る。API や静的ファイルはブラウザ任せで十分。
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(async () => {
      // 圏外のときだけ、インストール時に保存しておいたシェルを返す
      const cached = await caches.match('/', { ignoreSearch: true });
      return (
        cached ||
        new Response('<h1>DryEyes</h1><p>オフラインです。</p>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      );
    })
  );
});
