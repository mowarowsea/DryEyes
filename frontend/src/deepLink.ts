// ntfy 通知をタップすると `…/?watch=<uuid>` で DryEyes が開く。
// その監視 ID を取り出して、開いた直後に差分を表示するためのヘルパー。
export function takePendingWatchId(): string | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const watchId = params.get('watch');
  if (!watchId) return null;

  // 一度読んだらクエリを消す。リロードや戻る操作で同じ差分が開き直すのを防ぐ。
  params.delete('watch');
  const query = params.toString();
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );

  return watchId;
}

// スマホの共有シート（PWA の Web Share Target）やホーム画面のショートカットから
// `…/?shared=<共有されたURL>` `…/?add=1` で開かれたときに、登録モーダルを出すための情報。
//
// パラメータ名が `url` ではなく `shared` なのは、Vite の開発サーバーが `?url` を
// 内部用のクエリ（アセットを URL として読み込む指定）として横取りし、
// アプリに届く前に 403 を返してしまうため。
export interface CreateIntent {
  /** 共有された URL。ショートカット経由など、URL なしで開かれた場合は null。 */
  url: string | null;
  /** 共有シート経由か、ホーム画面のショートカット経由か。 */
  source: 'share' | 'shortcut';
}

// Android の共有は URL が `text` に混ざって渡ってくることが多く、
// 「記事タイトル https://example.com/…」のような文字列になるため、
// url → text の順で最初に見つかった http(s) URL を採用する。
export function takeCreateIntent(): CreateIntent | null {
  if (typeof window === 'undefined') return null;

  const base = import.meta.env.BASE_URL;
  const params = new URLSearchParams(window.location.search);
  // `url` も一応受ける（Vite を介さず配信する場合や手書きのリンク向け）
  const keys = ['shared', 'url', 'text', 'title', 'add'];

  // 共有シートの受け口は `<base>share`。パラメータが 1 つも付かずに開かれても、
  // パスだけで「共有から来た」と分かるようにしてある。
  const onSharePath = trimSlash(window.location.pathname) === trimSlash(`${base}share`);
  if (!onSharePath && !keys.some((k) => params.has(k))) return null;

  const hasShareParam = ['shared', 'url', 'text', 'title'].some((k) => params.has(k));
  const shared =
    extractUrl(params.get('shared')) ??
    extractUrl(params.get('url')) ??
    extractUrl(params.get('text'));

  // 読み取ったパラメータは消す。残しておくとリロードのたびに登録モーダルが開き直す。
  // 受け口のパスに居る場合は、そのままだとリロードで同じことが起きるので base へ戻す。
  keys.forEach((k) => params.delete(k));
  const query = params.toString();
  const pathname = onSharePath ? base : window.location.pathname;
  window.history.replaceState(
    {},
    '',
    `${pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );

  // `add=1` だけで開かれたときがショートカット。それ以外は共有シート由来とみなす。
  const source = !onSharePath && !hasShareParam ? 'shortcut' : 'share';

  return { url: shared, source };
}

const trimSlash = (path: string): string => path.replace(/\/+$/, '');

function extractUrl(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;

  // 文中に混ざっている場合は最初の http(s) URL を拾う
  const match = trimmed.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

// pinax の「続きを探す」から `…/?find=<作品名>&author=<作者>` で開かれたときの内容。
export interface FindIntent {
  title: string;
  author: string | null;
}

export function takeFindIntent(): FindIntent | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const title = params.get('find')?.trim();
  if (!title) return null;
  const author = params.get('author')?.trim() || null;

  // 他のリンクと同じく、読んだら消す (リロードで開き直さないように)
  params.delete('find');
  params.delete('author');
  const query = params.toString();
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );

  return { title, author };
}
