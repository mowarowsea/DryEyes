import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Clock, History } from 'lucide-react';
import { HistoryDiff, WatchHistoryItem, WatchModel } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { DiffLines } from './DiffLines';

interface HistoryModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
}

const formatDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const formatRelative = (ts: number): string => {
  const diffSec = Math.floor(Date.now() / 1000 - ts);
  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  return `${Math.floor(diffSec / 86400)}日前`;
};

// 更新の間隔のならし。次はいつ頃来そうかの目安になる（週刊なのか月刊なのか）。
// 3 回に満たなければ言えることが無いので出さない。
export const describePace = (timestamps: number[]): string | null => {
  if (timestamps.length < 3) return null;
  const sorted = [...timestamps].sort((a, b) => a - b);
  const average = (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1);
  if (average < 3600) return `およそ ${Math.max(1, Math.round(average / 60))} 分おき`;
  if (average < 86400) return `およそ ${Math.round(average / 3600)} 時間おき`;
  return `およそ ${Math.round(average / 86400)} 日おき`;
};

// 履歴 1 件ぶんの差分の読み込み状態
type LoadedDiff =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; diff: HistoryDiff };

// 監視ごとの変更履歴。いつ更新されたかを新しい順に並べ、開いた回だけ差分を取りに行く。
// 全部の差分を先に取ると、スナップショットの数だけ本文を 2 つずつ引くことになるため。
export const HistoryModal: React.FC<HistoryModalProps> = ({ watch, isOpen, onClose }) => {
  const [history, setHistory] = useState<WatchHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [diffs, setDiffs] = useState<Record<number, LoadedDiff>>({});
  // 開いている監視。別の監視に切り替えたあとに届いた古い返事を捨てるために持つ。
  const currentWatchId = useRef<string | null>(null);

  const loadDiff = (watchId: string, timestamp: number) => {
    setDiffs((prev) => ({ ...prev, [timestamp]: { status: 'loading' } }));
    api
      .getHistoryDiff(watchId, timestamp)
      .then((diff) => {
        if (currentWatchId.current !== watchId) return;
        setDiffs((prev) => ({ ...prev, [timestamp]: { status: 'ready', diff } }));
      })
      .catch((err: any) => {
        if (currentWatchId.current !== watchId) return;
        setDiffs((prev) => ({
          ...prev,
          [timestamp]: { status: 'error', message: err?.message || '差分の取得に失敗しました' },
        }));
      });
  };

  useEffect(() => {
    if (!isOpen || !watch) {
      currentWatchId.current = null;
      return;
    }
    const watchId = watch.id;
    currentWatchId.current = watchId;
    setHistory(null);
    setError(null);
    setExpanded(new Set());
    setDiffs({});

    api
      .getHistory(watchId)
      .then((items) => {
        if (currentWatchId.current !== watchId) return;
        setHistory(items);
        // 最新の 1 件は開いた状態で見せる。たいてい知りたいのはこれ。
        if (items.length > 0) {
          setExpanded(new Set([items[0].timestamp]));
          loadDiff(watchId, items[0].timestamp);
        }
      })
      .catch((err: any) => {
        if (currentWatchId.current !== watchId) return;
        setError(err?.message || '履歴の取得に失敗しました');
      });
  }, [isOpen, watch]);

  if (!isOpen || !watch) return null;

  const toggle = (timestamp: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(timestamp)) next.delete(timestamp);
      else next.add(timestamp);
      return next;
    });
    if (!diffs[timestamp]) loadDiff(watch.id, timestamp);
  };

  // 最初の 1 件は登録時の取得で、変更ではない
  const changeCount = history ? Math.max(0, history.length - 1) : 0;
  const pace = history ? describePace(history.map((item) => item.timestamp)) : null;

  const badgeClass =
    'inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold border';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="変更履歴"
      subtitle={watch.title}
      icon={<History className="w-5 h-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0" />}
      error={error}
      size="lg"
    >
      {history && (
        <div className="px-4 sm:px-5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3 flex-wrap text-[11px] text-slate-500 dark:text-slate-400 flex-shrink-0">
          <span className="inline-flex items-center" aria-label={`更新 ${changeCount} 回`}>
            <Clock className="w-3 h-3 mr-1 text-slate-400 dark:text-slate-500" />
            更新
            <strong className="mx-1 text-slate-700 dark:text-slate-200 font-semibold tabular-nums">
              {changeCount}
            </strong>
            回
          </span>
          {pace && <span>{pace}</span>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!history ? (
          error ? null : (
            <div className="py-14 text-center text-slate-400 dark:text-slate-500 text-sm flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
              <span>履歴を読み込み中...</span>
            </div>
          )
        ) : history.length === 0 ? (
          <div className="py-14 text-center text-slate-400 dark:text-slate-500 text-sm px-6">
            <p>まだ一度も取得していません。</p>
          </div>
        ) : (
          <ol className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map((item, index) => {
              const isLatest = index === 0;
              const isFirst = index === history.length - 1;
              const open = expanded.has(item.timestamp);
              const loaded = diffs[item.timestamp];

              return (
                <li key={item.timestamp}>
                  <button
                    type="button"
                    onClick={() => toggle(item.timestamp)}
                    aria-expanded={open}
                    className="w-full px-4 sm:px-5 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        isLatest ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                    <span className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-100 tabular-nums">
                        {formatDateTime(item.timestamp)}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {formatRelative(item.timestamp)}
                      </span>
                      {isLatest && (
                        <span
                          className={`${badgeClass} bg-indigo-50 text-indigo-700 border-indigo-200/60 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30`}
                        >
                          最新
                        </span>
                      )}
                      {isFirst && (
                        <span
                          className={`${badgeClass} bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700`}
                        >
                          初回取得
                        </span>
                      )}
                    </span>

                    {loaded?.status === 'ready' && loaded.diff.from !== null && (
                      <span className="flex items-center gap-1 text-[11px] font-semibold tabular-nums flex-shrink-0">
                        <span className="text-emerald-600 dark:text-emerald-400">+{loaded.diff.added}</span>
                        <span className="text-rose-600 dark:text-rose-400">-{loaded.diff.removed}</span>
                      </span>
                    )}
                    {open ? (
                      <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                  </button>

                  {open && (
                    <div className="pb-2 bg-white dark:bg-slate-900">
                      {!loaded || loaded.status === 'loading' ? (
                        <div className="py-4 flex justify-center">
                          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : loaded.status === 'error' ? (
                        <p className="px-4 sm:px-5 py-2 text-xs text-rose-600 dark:text-rose-400">
                          {loaded.message}
                        </p>
                      ) : loaded.diff.from === null ? (
                        <div className="px-4 sm:px-5 py-1">
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                            登録して最初に取得した内容です。
                          </p>
                          <pre className="text-[11px] font-mono bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-3 whitespace-pre-wrap break-all leading-relaxed text-slate-600 dark:text-slate-300 max-h-60 overflow-y-auto">
                            {(loaded.diff.snapshotPreview || []).join('\n') || '（内容が取得できませんでした）'}
                          </pre>
                        </div>
                      ) : loaded.diff.lines.length === 0 ? (
                        <p className="px-4 sm:px-5 py-2 text-xs text-slate-400 dark:text-slate-500">
                          変わった行は見つかりませんでした（空白だけの変更など）。
                        </p>
                      ) : (
                        <DiffLines lines={loaded.diff.lines} truncated={loaded.diff.truncated} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Modal>
  );
};
