import React, { useEffect, useState, useMemo } from 'react';
import { EyeOff, Layers } from 'lucide-react';
import { WatchModel } from '../types';
import { WatchCard } from './WatchCard';
import { FilterTab, ListToolbar } from './ListToolbar';
import { ListModeTabs } from './ListModeTabs';
import { WorkGroupCard } from './WorkGroupCard';
import { isUnviewed } from '../watchStatus';
import { SortOrder, getStoredSort, sortWatches, storeSort } from '../listSort';
import { ListMode, getStoredMode, groupByWork, modeOf, storeMode } from '../watchGroup';

interface WatchListProps {
  watches: WatchModel[];
  // 初回の取得が終わったか。終わるまでは「1 件も無い」と決めつけない。
  loaded: boolean;
  // 検索語。入力欄は固定ヘッダ側にあるので、値だけを受け取る。
  search: string;
  // 登録直後に目立たせる監視。数秒だけ入り、その後 null に戻る。
  highlightedId?: string | null;
  // カード背景に絵を敷くか（アカウント画面の表示設定）
  showCardImages?: boolean;
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onOpenDiff: (watch: WatchModel) => void;
  // 変更履歴（いつ何が変わったか）を開く
  onOpenHistory: (watch: WatchModel) => void;
  onOpenFeed: (watch: WatchModel) => void;
  onEdit: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
  onCopyTo: (watch: WatchModel) => void;
  onReviewRedirect: (watch: WatchModel) => void;
  // 背景に敷く絵を選び直す
  onChangeImage: (watch: WatchModel) => void;
  onOpenCreateModal: () => void;
}

export const WatchList: React.FC<WatchListProps> = ({
  watches,
  loaded,
  search,
  highlightedId = null,
  showCardImages = true,
  onTriggerCheck,
  onTogglePause,
  onOpenDiff,
  onOpenHistory,
  onOpenFeed,
  onEdit,
  onDelete,
  onCopyTo,
  onReviewRedirect,
  onChangeImage,
  onOpenCreateModal,
}) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [mode, setMode] = useState<ListMode>(() => getStoredMode());
  const [sort, setSort] = useState<SortOrder>(() => getStoredSort());

  const handleChangeSort = (next: SortOrder) => {
    setSort(next);
    storeSort(next);
  };

  const handleChangeMode = (next: ListMode) => {
    setMode(next);
    storeMode(next);
  };

  // 登録直後の監視は未読でもエラーでもないため、絞り込み中だと一覧に出てこない。
  // せっかく目立たせても隠れていては意味がないので、そのときだけ「すべて」に戻す。
  // 一覧そのものが別だと輪をかけて見えないので、その監視が居るほうへ切り替える。
  useEffect(() => {
    if (!highlightedId) return;
    setActiveTab('all');
    const target = watches.find((w) => w.id === highlightedId);
    if (target) setMode(modeOf(target));
    // watches は毎回の取得で作り直されるため、依存に入れると切り替えるたびに戻ってしまう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightedId]);

  // 一覧の切り替えが先。絞り込みのカウントも、今見ている一覧の中の数にする
  const watchesInMode = useMemo(() => watches.filter((w) => modeOf(w) === mode), [watches, mode]);

  const filteredWatches = useMemo(() => {
    const matched = watchesInMode.filter((w) => {
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
  }, [watchesInMode, search, activeTab, sort]);

  // 同じ作品を複数サイトで追いかけるのはダウンロード監視だけなので、そちらでのみまとめる
  const groups = useMemo(
    () => (mode === 'download' ? groupByWork(filteredWatches) : null),
    [mode, filteredWatches]
  );

  const countOf = (tab: FilterTab) => {
    if (tab === 'changed') return watchesInMode.filter(isUnviewed).length;
    if (tab === 'error') return watchesInMode.filter((w) => w.hasError).length;
    if (tab === 'paused') return watchesInMode.filter((w) => w.paused).length;
    return watchesInMode.length;
  };

  const countOfMode = (target: ListMode) => watches.filter((w) => modeOf(w) === target).length;

  return (
    <div className="space-y-4">
      {/* Web 監視 / ダウンロード監視 */}
      <ListModeTabs mode={mode} onChange={handleChangeMode} countOf={countOfMode} />

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
            {search || activeTab !== 'all'
              ? '該当する監視対象が見つかりません'
              : mode === 'download'
                ? 'まだダウンロード監視がありません'
                : 'まだ監視対象がありません'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
            {search || activeTab !== 'all'
              ? '検索条件やフィルタを変更してみてください。'
              : mode === 'download'
                ? // ここは「登録」ではなく「既にある監視を繋ぐ」導線。作るのは Web 監視から
                  'Web 監視のカードから投入設定を開き、投入先の PowerDowner ユーザーを選ぶと、この一覧に移ります。'
                : '監視したいWebページのURLを入力して、DryEyesに定期チェックを任せましょう。'}
          </p>
          {!search && activeTab === 'all' && mode === 'web' && (
            <button
              onClick={onOpenCreateModal}
              className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition active:scale-95 shadow-sm shadow-indigo-200 dark:shadow-none"
            >
              最初のページを登録する
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {(groups ?? [{ key: 'flat', title: '', author: null, watches: filteredWatches }]).map((group) => {
            const cards = group.watches.map((watch) => (
              <WatchCard
                key={watch.id}
                watch={watch}
                highlighted={watch.id === highlightedId}
                showImage={showCardImages}
                onTriggerCheck={onTriggerCheck}
                onTogglePause={onTogglePause}
                onOpenDiff={onOpenDiff}
                onOpenHistory={onOpenHistory}
                onOpenFeed={onOpenFeed}
                onEdit={onEdit}
                onDelete={onDelete}
                onCopyTo={onCopyTo}
                onReviewRedirect={onReviewRedirect}
                onChangeImage={onChangeImage}
              />
            ));

            // 1 サイトしか無い作品に見出しを付けると、まとまっていること自体が見えなくなる
            if (!groups || group.watches.length < 2) return <React.Fragment key={group.key}>{cards}</React.Fragment>;
            return (
              <WorkGroupCard key={group.key} group={group}>
                {cards}
              </WorkGroupCard>
            );
          })}
        </div>
      )}
    </div>
  );
};
