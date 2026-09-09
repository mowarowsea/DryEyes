import React from 'react';
import { Download, Globe } from 'lucide-react';
import { ListMode } from '../watchGroup';

interface ListModeTabsProps {
  mode: ListMode;
  onChange: (mode: ListMode) => void;
  countOf: (mode: ListMode) => number;
}

const TABS: { key: ListMode; label: string; Icon: typeof Globe }[] = [
  { key: 'web', label: 'Web 監視', Icon: Globe },
  { key: 'download', label: 'ダウンロード監視', Icon: Download },
];

/**
 * 一覧そのものの切り替え。
 *
 * 未読・エラーなどの絞り込み (ListToolbar) とは軸が違う。あちらは「同じ一覧の中で減らす」、
 * こちらは「別の一覧に行く」なので、見た目もタブとして上に離して置く。
 */
export const ListModeTabs: React.FC<ListModeTabsProps> = ({ mode, onChange, countOf }) => (
  <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
    {TABS.map(({ key, label, Icon }) => {
      const active = mode === key;
      return (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={active}
          className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-xs font-semibold whitespace-nowrap transition ${
            active
              ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
          <span className={active ? 'text-indigo-400 dark:text-indigo-500' : 'text-slate-400 dark:text-slate-500'}>
            {countOf(key)}
          </span>
        </button>
      );
    })}
  </div>
);
