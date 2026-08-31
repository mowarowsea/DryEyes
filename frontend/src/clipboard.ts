// クリップボードへのコピーは必ずブラウザ側で行う（サーバーのクリップボードには触らない）。
//
// navigator.clipboard は secure context（https もしくは localhost）でしか使えないため、
// LAN の IP アドレス（http://192.168.x.x:3010 など）で開いた DryEyes では undefined になり、
// コピーボタンが無反応になっていた。その環境向けに execCommand('copy') へフォールバックする。
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 権限拒否などのときは下のフォールバックを試す */
  }

  return legacyCopy(text);
}

// 非 secure context 用。画面外に一時的な textarea を置いて選択 → コピーする。
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // position: fixed にしないと、スマホでフォーカス時に画面が大きくスクロールしてしまう
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.opacity = '0';

  document.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    // iOS Safari は select() だけでは範囲が付かない
    textarea.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

// クリップボードの読み取りは書き込みと違い、フォールバック手段がない
// （execCommand('paste') はどのブラウザでも封じられている）。
// secure context 以外では貼り付けボタン自体を出さないよう、可否を返す。
export function canReadClipboard(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator.clipboard?.readText === 'function'
  );
}

export async function readTextFromClipboard(): Promise<string | null> {
  if (!canReadClipboard()) return null;

  try {
    const text = await navigator.clipboard.readText();
    return text.trim() || null;
  } catch {
    // 権限を拒否された場合など。手入力に任せる。
    return null;
  }
}
