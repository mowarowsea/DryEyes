// ホーム画面から起動した PWA の中から外部サイトを開くと、その PWA を所有するブラウザ
// （Chrome）のカスタムタブで開かれてしまい、普段使いのブラウザに残らない。
// Android では intent: スキームに包んで「どのアプリで開くか」を Android 側に委ねると、
// 端末の既定ブラウザ（Brave など）で開く。
//
// intent URI は fragment 部分を Intent の記述に使うため、`#` を含む URL は表現できない。
// その場合と、Android 以外・ブラウザのタブで開いている場合は、通常のリンクのままにする。

export interface ExternalLinkProps {
  href: string;
  target?: '_blank';
  rel?: string;
}

export function externalLinkProps(url: string): ExternalLinkProps {
  const intentUrl = toIntentUrl(url);

  // intent: は同じタブで開くとアプリだけが起動し、こちらの画面はそのまま残る。
  // _blank を付けると空のタブが残ってしまう。
  return intentUrl
    ? { href: intentUrl }
    : { href: url, target: '_blank', rel: 'noopener noreferrer' };
}

function toIntentUrl(url: string): string | null {
  if (typeof window === 'undefined') return null;
  if (!isAndroid() || !isStandalone()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  // fragment は intent URI に含められないため、落として開くより通常のリンクにする
  if (parsed.hash) return null;

  const scheme = parsed.protocol.replace(':', '');
  const target = `${parsed.host}${parsed.pathname}${parsed.search}`;
  const fallback = encodeURIComponent(url);

  return (
    `intent://${target}#Intent;scheme=${scheme};action=android.intent.action.VIEW;` +
    `S.browser_fallback_url=${fallback};end`
  );
}

const isAndroid = (): boolean => /android/i.test(navigator.userAgent);

// ホーム画面から起動した状態か（ブラウザのタブで開いているなら細工は不要）
const isStandalone = (): boolean => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
};
