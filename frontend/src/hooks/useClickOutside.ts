import { RefObject, useEffect, useRef } from 'react';

// ドロップダウンの外をタップしたら閉じる。開いている間だけ購読する。
// ヘッダーのアカウントメニューと監視カードの操作メニューで同じ処理が要るため共通化した。
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onOutside: () => void
): void {
  // 呼び出し側がインラインの関数を渡しても購読し直さないよう、最新の関数を ref で持つ
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutsideRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, ref]);
}
