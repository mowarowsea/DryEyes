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
}

// Android の共有は URL が `text` に混ざって渡ってくることが多く、
// 「記事タイトル https://example.com/…」のような文字列になるため、
// url → text の順で最初に見つかった http(s) URL を採用する。
export function takeCreateIntent(): CreateIntent | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  // `url` も一応受ける（Vite を介さず配信する場合や手書きのリンク向け）
  const keys = ['shared', 'url', 'text', 'title', 'add'];
  if (!keys.some((k) => params.has(k))) return null;

  const shared =
    extractUrl(params.get('shared')) ??
    extractUrl(params.get('url')) ??
    extractUrl(params.get('text'));

  // 読み取ったパラメータは消す。残しておくとリロードのたびに登録モーダルが開き直す。
  keys.forEach((k) => params.delete(k));
  const query = params.toString();
  window.history.replaceState(
    {},
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  );

  return { url: shared };
}

function extractUrl(value: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;

  // 文中に混ざっている場合は最初の http(s) URL を拾う
  const match = trimmed.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}
