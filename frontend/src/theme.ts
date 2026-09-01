// 画面のテーマ（ライト / ダーク / OS 設定に追従）。
// 実際の切り替えは <html> の class="dark" の付け外しで行い、Tailwind の dark: が効くようにする。
// 初期適用は index.html のインラインスクリプトが担当する（描画前に確定させるため）。

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'dryeyes.theme';

const prefersDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
};

export function getStoredTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    /* プライベートウィンドウなどで読めない場合は OS 設定に従う */
  }
  return 'system';
}

export function isDarkApplied(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark());
}

// いま <html> に反映されている結果。ライト / ダーク / 端末に合わせる のどれを選んでいても、
// 「見えている画面が暗いか」だけを返す。Tailwind の dark: が届かない場所
// （要素ピッカーが iframe に流すページなど）へテーマを渡すために使う。
export function isDarkNow(): boolean {
  return document.documentElement.classList.contains('dark');
}

// <html> へ反映する。保存はしない（プレビュー用途でも使えるように分けている）
export function applyTheme(mode: ThemeMode): void {
  const dark = isDarkApplied(mode);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 保存できなくてもセッション中は切り替わったままにする */
  }
}

// system のときだけ OS 設定の変更に追従する。戻り値は購読解除用。
export function watchSystemTheme(onChange: () => void): () => void {
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  } catch {
    return () => undefined;
  }
}
