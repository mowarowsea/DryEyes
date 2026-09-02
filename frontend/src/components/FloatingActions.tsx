import React from 'react';
import { Plus } from 'lucide-react';
import { AuthUser } from '../types';

// 画面の隅に浮かせるボタンの置き場所。画面の端ではなく一覧と同じ max-w-3xl の右端に寄せるので、
// 広い画面でもカードの角の延長線上に並び、狭い画面ではそのまま画面の隅に来る。
// 枠自体はクリックを通し（pointer-events-none）、中のボタンだけが反応する。
const FloatingSlot: React.FC<{ className: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div className={`fixed inset-x-0 z-40 pointer-events-none ${className}`}>
    <div className="max-w-3xl mx-auto px-4 flex justify-end">{children}</div>
  </div>
);

// 画面右上。固定ヘッダの右端に空けた余白にぴたりと収まる位置。
export const AccountFab: React.FC<{ user: AuthUser; onClick: () => void }> = ({
  user,
  onClick,
}) => (
  <FloatingSlot className="top-3">
    <button
      onClick={onClick}
      title={`${user.username} としてログイン中`}
      aria-label="アカウント"
      className="pointer-events-auto w-9 h-9 rounded-full bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 active:scale-95 transition-all text-white text-xs font-bold flex items-center justify-center uppercase shadow-md"
    >
      {user.username.slice(0, 2)}
    </button>
  </FloatingSlot>
);

// 画面右下。片手で持ったときの親指の届く範囲に新規登録を置く。
export const CreateFab: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <FloatingSlot className="bottom-6">
    <button
      onClick={onClick}
      title="新規監視を登録"
      aria-label="新規監視を登録"
      className="pointer-events-auto w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white flex items-center justify-center shadow-lg shadow-indigo-500/30"
    >
      <Plus className="w-7 h-7" />
    </button>
  </FloatingSlot>
);
