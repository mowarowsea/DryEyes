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
