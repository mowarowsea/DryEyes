import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import { SORT_OPTIONS, SortOrder, sortOptionOf } from '../listSort';

export type FilterTab = 'all' | 'changed' | 'error' | 'paused';

export const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'changed', label: '未読' },
  { key: 'error', label: 'エラー' },
  { key: 'paused', label: '停止中' },
];

interface ListToolbarProps {
  activeTab: FilterTab;
  onChangeTab: (tab: FilterTab) => void;
  countOf: (tab: FilterTab) => number;
  sort: SortOrder;
  onChangeSort: (sort: SortOrder) => void;
}

// 絞り込みと並び替えを 1 行にまとめた一覧の操作列。
// 絞り込みは押した結果がすぐ分かるようタブのまま前に出し、並び替えは
// 選ぶ機会が少ないぶん右端のボタン + ドロップダウンに畳んでいる。
export const ListToolbar: React.FC<ListToolbarProps> = ({
  activeTab,
  onChangeTab,
  countOf,
  sort,
  onChangeSort,
}) => {
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  useClickOutside(sortRef, sortMenuOpen, () => setSortMenuOpen(false));

  const current = sortOptionOf(sort.key);
  const DirectionIcon = sort.direction === 'desc' ? ArrowDown : ArrowUp;

  // 並び順を変えたらメニューは閉じる。結果が出るのは後ろの一覧なので、
  // 開いたままだとどう並び替わったのかが見えない。
  // 項目を選び直したときの向きは、その項目にとって自然なほうから始める
  // （未読を「少ない順」から見たい人はいない）。
  const applySort = (next: SortOrder) => {
    onChangeSort(next);
    setSortMenuOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* 絞り込み。項目が増えても行が折り返さないよう、はみ出したぶんは横スクロールさせる */}
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="inline-flex items-center space-x-1 bg-slate-200/60 dark:bg-slate-800 p-1 rounded-xl text-xs font-medium">
          {FILTER_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onChangeTab(key)}
              aria-pressed={activeTab === key}
              className={`whitespace-nowrap px-3 py-1.5 rounded-lg transition ${
                activeTab === key
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label} ({countOf(key)})
            </button>
          ))}
        </div>
      </div>

      {/* 並び替え */}
      <div className="relative flex-shrink-0" ref={sortRef}>
        <button
          onClick={() => setSortMenuOpen((v) => !v)}
          aria-label={`並び替え: ${current.label} ${sort.direction === 'desc' ? current.desc : current.asc}`}
          aria-expanded={sortMenuOpen}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 active:scale-95 transition shadow-sm"
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          <span className="hidden sm:inline whitespace-nowrap">{current.label}</span>
          <DirectionIcon className="w-3 h-3" />
        </button>

        {sortMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl shadow-slate-300/50 dark:shadow-black/50 overflow-hidden animate-fadeIn">
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              並び替え
            </div>
            {SORT_OPTIONS.map((option) => {
              const selected = option.key === sort.key;
              return (
                <button
                  key={option.key}
                  onClick={() => applySort({ key: option.key, direction: option.defaultDirection })}
                  aria-pressed={selected}
                  className={`w-full px-3 py-2.5 text-left text-xs font-medium flex items-center gap-2 transition ${
                    selected
                      ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {selected ? (
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  ) : (
                    <span className="w-3.5 flex-shrink-0" />
                  )}
                  {option.label}
                </button>
              );
            })}

            {/* 向きの切り替え。「降順・昇順」ではなく、選んでいる項目での実際の並びで示す。 */}
            <div className="flex gap-1 p-1.5 border-t border-slate-100 dark:border-slate-800">
              {(['desc', 'asc'] as const).map((direction) => (
                <button
                  key={direction}
                  onClick={() => applySort({ key: sort.key, direction })}
                  aria-pressed={sort.direction === direction}
                  className={`flex-1 inline-flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium rounded-lg border transition ${
                    sort.direction === direction
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {direction === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
                  {direction === 'desc' ? current.desc : current.asc}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
