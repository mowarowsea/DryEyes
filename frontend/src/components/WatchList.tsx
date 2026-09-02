import React, { useEffect, useState, useMemo } from 'react';
import { EyeOff, Layers } from 'lucide-react';
import { WatchModel } from '../types';
import { WatchCard } from './WatchCard';
import { FilterTab, ListToolbar } from './ListToolbar';
import { isUnviewed } from '../watchStatus';
import { SortOrder, getStoredSort, sortWatches, storeSort } from '../listSort';

interface WatchListProps {
  watches: WatchModel[];
  // 初回の取得が終わったか。終わるまでは「1 件も無い」と決めつけない。
  loaded: boolean;
  // 検索語。入力欄は固定ヘッダ側にあるので、値だけを受け取る。
  search: string;
  // 登録直後に目立たせる監視。数秒だけ入り、その後 null に戻る。
  highlightedId?: string | null;
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onOpenDiff: (watch: WatchModel) => void;
  onEdit: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
  onCopyTo: (watch: WatchModel) => void;
  onReviewRedirect: (watch: WatchModel) => void;
  onOpenCreateModal: () => void;
}

export const WatchList: React.FC<WatchListProps> = ({
  watches,
  loaded,
  search,
  highlightedId = null,
  onTriggerCheck,
  onTogglePause,
  onOpenDiff,
  onEdit,
  onDelete,
  onCopyTo,
  onReviewRedirect,
  onOpenCreateModal,
}) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [sort, setSort] = useState<SortOrder>(() => getStoredSort());

  const handleChangeSort = (next: SortOrder) => {
    setSort(next);
    storeSort(next);
  };

  // 登録直後の監視は未読でもエラーでもないため、絞り込み中だと一覧に出てこない。
  // せっかく目立たせても隠れていては意味がないので、そのときだけ「すべて」に戻す。
  useEffect(() => {
    if (highlightedId) setActiveTab('all');
  }, [highlightedId]);

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

    // 既定は更新日付の降順。まだ変更が無い監視は最後にまとまる。
    // 確認日時での並び替えも選べるようにはしたが、既定にはしない。裏のチェックが走るたびに
    // 動く値なので、見ている最中にカードの順番が勝手に入れ替わってしまう。
    return sortWatches(matched, sort);
  }, [watches, search, activeTab, sort]);

  const countOf = (tab: FilterTab) => {
    if (tab === 'changed') return watches.filter(isUnviewed).length;
    if (tab === 'error') return watches.filter((w) => w.hasError).length;
    if (tab === 'paused') return watches.filter((w) => w.paused).length;
    return watches.length;
  };

  return (
    <div className="space-y-4">
      {/* 絞り込み + 並び替え */}
      <ListToolbar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        countOf={countOf}
        sort={sort}
        onChangeSort={handleChangeSort}
      />

      {/* 一覧 */}
      {!loaded ? (
        // 読み込み中に空の一覧を描くと「まだ監視対象がありません」が一瞬出てしまう。
        // 画面が読み込み直された直後にこれが出ると、登録が消えたように見える。
        <div className="py-20 flex justify-center" role="status" aria-label="読み込み中">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredWatches.length === 0 ? (
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
              highlighted={watch.id === highlightedId}
              onTriggerCheck={onTriggerCheck}
              onTogglePause={onTogglePause}
              onOpenDiff={onOpenDiff}
              onEdit={onEdit}
              onDelete={onDelete}
              onCopyTo={onCopyTo}
              onReviewRedirect={onReviewRedirect}
            />
          ))}
        </div>
      )}
    </div>
  );
};
