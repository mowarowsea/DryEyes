import React, { useState, useMemo } from 'react';
import { Search, EyeOff, Layers } from 'lucide-react';
import { WatchModel } from '../types';
import { WatchCard } from './WatchCard';

interface WatchListProps {
  watches: WatchModel[];
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onOpenDiff: (watch: WatchModel) => void;
  onEdit: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
  onOpenCreateModal: () => void;
  /** 監視ID -> 設定を保存した時刻。ファビコンのキャッシュを破棄するのに使う。 */
  faviconVersions?: Record<string, number>;
}

type FilterTab = 'all' | 'changed' | 'error' | 'paused';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'changed', label: '未読' },
  { key: 'error', label: 'エラー' },
  { key: 'paused', label: '停止中' },
];

// BFF が付与する未読フラグを優先し、無い場合のみ直近の変更検知で判定する
const isUnviewed = (w: WatchModel) =>
  w.hasUnviewed ?? Boolean(w.lastChanged && w.lastChecked && w.lastChanged >= w.lastChecked - 60);

export const WatchList: React.FC<WatchListProps> = ({
  watches,
  onTriggerCheck,
  onTogglePause,
  onOpenDiff,
  onEdit,
  onDelete,
  onOpenCreateModal,
  faviconVersions,
}) => {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredWatches = useMemo(() => {
    const matched = watches.filter((w) => {
      const matchSearch =
        w.title.toLowerCase().includes(search.toLowerCase()) ||
        w.url.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;

      if (activeTab === 'changed') return isUnviewed(w);
      if (activeTab === 'error') return w.hasError;
      if (activeTab === 'paused') return w.paused;
      return true;
    });

    // 更新日付の降順。まだ変更が無い監視は最後に、最終確認の新しい順で並べる。
    return matched.sort(
      (a, b) =>
        (b.lastChanged ?? 0) - (a.lastChanged ?? 0) || (b.lastChecked ?? 0) - (a.lastChecked ?? 0)
    );
  }, [watches, search, activeTab]);

  const countOf = (tab: FilterTab) => {
    if (tab === 'changed') return watches.filter(isUnviewed).length;
    if (tab === 'error') return watches.filter((w) => w.hasError).length;
    if (tab === 'paused') return watches.filter((w) => w.paused).length;
    return watches.length;
  };

  return (
    <div className="space-y-4">
      {/* 検索 & フィルタ */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="タイトルやURLで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-sm"
          />
        </div>

        {/* タブ */}
        <div className="flex items-center space-x-1 bg-slate-200/60 dark:bg-slate-800 p-1 rounded-xl text-xs font-medium self-start sm:self-auto">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 rounded-lg transition ${
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

      {/* 一覧 */}
      {filteredWatches.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto mb-3">
            {search || activeTab !== 'all' ? <EyeOff className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
          </div>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">
            {search || activeTab !== 'all' ? '該当する監視対象が見つかりません' : 'まだ監視対象がありません'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
            {search || activeTab !== 'all'
              ? '検索条件やフィルタを変更してみてください。'
              : '監視したいWebページのURLを入力して、DryEyesに定期チェックを任せましょう。'}
          </p>
          {!search && activeTab === 'all' && (
            <button
              onClick={onOpenCreateModal}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition active:scale-95 shadow-sm shadow-indigo-200 dark:shadow-none"
            >
              最初のページを登録する
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filteredWatches.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              onTriggerCheck={onTriggerCheck}
              onTogglePause={onTogglePause}
              onOpenDiff={onOpenDiff}
              onEdit={onEdit}
              onDelete={onDelete}
              faviconVersion={faviconVersions?.[watch.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
};
