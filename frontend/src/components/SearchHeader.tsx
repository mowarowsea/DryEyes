import React from 'react';
import { Search, X } from 'lucide-react';
import { AppMark } from './AppMark';

interface SearchHeaderProps {
  value: string;
  onChange: (value: string) => void;
}

// 画面上部に貼り付く唯一のヘッダ。検索は一覧をたどっている最中にいちばん使うので、
// スクロールしても消えない位置に置いている。
// 右端は画面右上のアカウントボタン（フロート）のための余白として空けてある。
export const SearchHeader: React.FC<SearchHeaderProps> = ({ value, onChange }) => (
  <header className="sticky top-0 z-30 bg-slate-100/90 dark:bg-slate-950/90 backdrop-blur border-b border-slate-200 dark:border-slate-800">
    <div className="max-w-3xl mx-auto px-4 py-3 pr-16 flex items-center gap-2.5">
      <AppMark className="w-9 h-9 rounded-xl shadow-md shadow-indigo-100 dark:shadow-none flex-shrink-0" />

      <div className="relative flex-1 min-w-0">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <input
          type="text"
          placeholder="タイトルやURLで検索..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-9 pr-9 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-sm"
        />
        {/* 入力中だけ出す消去ボタン。スマホでは文字を消すのに何度も削除キーを押すことになるため。 */}
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="検索条件をクリア"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  </header>
);
