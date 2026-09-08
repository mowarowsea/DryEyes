import { describe, it, expect, vi } from 'vitest';
// sw.js はバンドルされない素の JS なので、文字列として読み込む（Vite の ?raw）
import source from '../../public/sw.js?raw';

// sw.js は self / caches / fetch を地の global として使う。
// それらを差し替えた関数として評価し、登録されたリスナーを取り出して試す。
type Listener = (event: any) => void;

const loadServiceWorker = (options: { cachedShell?: unknown; online?: boolean } = {}) => {
  const listeners: Record<string, Listener> = {};
  const self = {
    registration: { scope: 'https://example.test/DryEyes/' },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
  };
  const caches = {
    open: () => Promise.resolve({ add: () => Promise.resolve() }),
    keys: () => Promise.resolve([]),
    delete: () => Promise.resolve(true),
    match: () => Promise.resolve(options.cachedShell),
  };
  const fetch = vi.fn(() =>
    options.online === false ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve('network')
  );
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
  return { listeners, fetch };
};

const fetchEvent = (request: { url: string; mode: string; destination: string }) => ({
  request,
  respondWith: vi.fn(),
});

describe('Service Worker の fetch', () => {
  it('タブに直接開く画面遷移は、圏外ならシェルで代用する', async () => {
    const shell = { body: 'shell' };
    const { listeners } = loadServiceWorker({ online: false, cachedShell: shell });
    const event = fetchEvent({
      url: 'https://example.test/DryEyes/?watch=abc',
      mode: 'navigate',
      destination: 'document',
    });

    listeners.fetch(event);

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    await expect(event.respondWith.mock.calls[0][0]).resolves.toBe(shell);
  });

  it('iframe の読み込み（要素ピッカーのプレビュー）には手を出さない', () => {
    // ここでシェルを返すと、サーバーが落ちているときにプレビュー枠が真っ白になるだけで、
    // ピッカーが「届いていない」と気づけなくなる
    const { listeners } = loadServiceWorker({ online: false });
    const event = fetchEvent({
      url: 'https://example.test/DryEyes/api/proxy/page?url=https%3A%2F%2Fexample.com%2F',
      mode: 'navigate',
      destination: 'iframe',
    });

    listeners.fetch(event);

    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('API の URL は画面遷移として来てもシェルで代用しない', () => {
    const { listeners } = loadServiceWorker({ online: false });
    const event = fetchEvent({
      url: 'https://example.test/DryEyes/api/proxy/page?url=https%3A%2F%2Fexample.com%2F',
      mode: 'navigate',
      destination: 'document',
    });

    listeners.fetch(event);

    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('画面遷移でない要求（API 呼び出しや静的ファイル）はブラウザ任せにする', () => {
    const { listeners } = loadServiceWorker();
    const event = fetchEvent({
      url: 'https://example.test/DryEyes/api/watches',
      mode: 'cors',
      destination: '',
    });

    listeners.fetch(event);

    expect(event.respondWith).not.toHaveBeenCalled();
  });
});
