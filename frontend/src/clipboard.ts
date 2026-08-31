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
