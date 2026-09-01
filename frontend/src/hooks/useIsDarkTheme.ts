import { useEffect, useState } from 'react';
import { isDarkNow } from '../theme';

// 表示テーマが暗いかどうかを購読する。テーマの切り替えは <html class="dark"> の
// 付け外しで行われるので、選択肢（ライト / ダーク / 端末に合わせる）のどれであっても
// class を見張れば追従できる。
export function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() => isDarkNow());

  useEffect(() => {
    const sync = () => setDark(isDarkNow());
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    // 購読を始めるまでの間に切り替わっていることがあるので、ここで一度合わせる
    sync();
    return () => observer.disconnect();
  }, []);

  return dark;
}
