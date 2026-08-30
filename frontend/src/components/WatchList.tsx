import React, { useState, useMemo } from 'react';
import { Search, EyeOff, Layers } from 'lucide-react';
import { WatchModel } from '../types';
import { WatchCard } from './WatchCard';

interface WatchListProps {
  watches: WatchModel[];
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onViewHistory: (watch: WatchModel) => void;
  onOpenDiff: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
  onOpenCreateModal: () => void;
}

type FilterTab = 'all' | 'changed' | 'error' | 'paused';

export const WatchList: React.FC<WatchListProps> = ({
  watches,
  onTriggerCheck,
  onTogglePause,
  onViewHistory,
  onOpenDiff,
  onDelete,
  onOpenCreateModal,
}) => {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredWatches = useMemo(() => {
    return watches.filter((w) => {
      const matchSearch =
        w.title.toLowerCase().includes(search.toLowerCase()) ||
        w.url.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;

      if (activeTab === 'changed') {
        // BFF が付与する未読フラグを優先し、無い場合のみ直近の変更検知で判定する
        return (
          w.hasUnviewed ?? Boolean(w.lastChanged && w.lastChecked && w.lastChanged >= w.lastChecked - 60)
        );
      }
      if (activeTab === 'error') {
        return w.hasError;
      }
      if (activeTab === 'paused') {
        return w.paused;
      }
      return true;
    });
  }, [watches, search, activeTab]);

  return (
    <div className="space-y-4">
      {/* 検索 & フィルタ */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="タイトルやURLで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-sm"
          />
        </div>

        {/* タブ */}
        <div className="flex items-center space-x-1 bg-slate-200/60 p-1 rounded-xl text-xs font-medium self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            すべて ({watches.length})
          </button>
          <button
            onClick={() => setActiveTab('changed')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'changed'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            未読
          </button>
          <button
            onClick={() => setActiveTab('error')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'error'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            エラー
          </button>
          <button
            onClick={() => setActiveTab('paused')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === 'paused'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            停止中
          </button>
        </div>
      </div>

      {/* 一覧 */}
      {filteredWatches.length === 0 ? (
        <div className="text-center py-16 bg-white border border-dashed border-slate-200 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            {search || activeTab !== 'all' ? <EyeOff className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
          </div>
          <h3 className="font-semibold text-slate-800 text-base mb-1">
            {search || activeTab !== 'all' ? '該当する監視対象が見つかりません' : 'まだ監視対象がありません'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
            {search || activeTab !== 'all'
              ? '検索条件やフィルタを変更してみてください。'
              : '監視したいWebページのURLを入力して、DryEyesに定期チェックを任せましょう。'}
          </p>
          {!search && activeTab === 'all' && (
            <button
              onClick={onOpenCreateModal}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition active:scale-95 shadow-sm shadow-indigo-200"
            >
              最初のページを登録する
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredWatches.map((watch) => (
            <WatchCard
              key={watch.id}
              watch={watch}
              onTriggerCheck={onTriggerCheck}
              onTogglePause={onTogglePause}
              onViewHistory={onViewHistory}
              onOpenDiff={onOpenDiff}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};
