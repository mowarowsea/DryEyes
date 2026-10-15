import React, { useEffect, useRef } from 'react';
import { X, ShieldAlert } from 'lucide-react';

// アプリ内のモーダルはどれも「半透明の背景 + 角丸カード + 見出しと閉じるボタン + エラー帯」で
// できている。個別に書くと余白や配色がじわじわずれるので、外枠はここに集約する。
// 中身（フォーム本体やフッター）は children に置く。

// 開いているモーダルの閉じる操作を積んでおき、Esc では一番手前のものだけを閉じる。
// 登録モーダルの上に要素ピッカーが重なるため、1 回の Esc で両方閉じないようにする必要がある。
const escapeStack: Array<() => void> = [];

export function useEscapeToClose(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const handler = () => onCloseRef.current();
    escapeStack.push(handler);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 手前に別のモーダルが開いているなら、そちらに任せる
      if (escapeStack[escapeStack.length - 1] !== handler) return;
      handler();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const index = escapeStack.lastIndexOf(handler);
      if (index >= 0) escapeStack.splice(index, 1);
    };
  }, [isOpen]);
}

type ModalSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm', // コピー先の選択など、項目が 1 つだけのもの
  md: 'max-w-lg', // 監視の登録・設定変更
  lg: 'max-w-2xl', // 差分表示
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 見出し */
  title: React.ReactNode;
  /** 見出しの下に小さく出す補足。監視名など長くなるものは自動で省略表示になる。 */
  subtitle?: string;
  /** 見出しの左に付ける小さなラベル（「Step 1/3」など） */
  badge?: React.ReactNode;
  /** 見出しの左に付けるアイコン */
  icon?: React.ReactNode;
  /** 指定すると見出しの下にエラー帯を出す */
  error?: string | null;
  size?: ModalSize;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  icon,
  error,
  size = 'md',
  children,
}) => {
  useEscapeToClose(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div
        className={`bg-white dark:bg-slate-900 rounded-2xl w-full ${SIZE_CLASS[size]} max-h-[90vh] flex flex-col shadow-2xl overflow-hidden`}
      >
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {badge}
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-none">
                  {title}
                </h2>
              </div>
              {subtitle && (
                <p
                  className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate"
                  title={subtitle}
                >
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl text-xs flex items-center space-x-2 flex-shrink-0">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {children}
      </div>
    </div>
  );
};
