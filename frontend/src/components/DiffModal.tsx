import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  GitCompare,
  AlertCircle,
  ExternalLink,
  Check,
  Plus,
  Minus,
  Clock,
} from 'lucide-react';
import { WatchModel, WatchDiff } from '../types';
import { api } from '../api';

interface DiffModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
  /** 既読にしたあと一覧を更新してもらうためのコールバック */
  onViewed: () => void;
}

const formatDateTime = (ts: number | null) => {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const DiffModal: React.FC<DiffModalProps> = ({ watch, isOpen, onClose, onViewed }) => {
  const [diff, setDiff] = useState<WatchDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    if (!isOpen || !watch) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setDiff(null);
        const data = await api.getDiff(watch.id);
        if (!cancelled) setDiff(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || '差分の取得に失敗しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, watch]);

  // 既読にする。開いただけでは既読にせず、明示的な操作でのみ記録する。
  const markViewed = useCallback(async () => {
    if (!watch) return;
    try {
      setMarking(true);
      await api.markViewed(watch.id);
      onViewed();
    } catch {
      /* 既読の記録に失敗しても閲覧やサイト遷移は妨げない */
    } finally {
      setMarking(false);
    }
  }, [watch, onViewed]);

  if (!isOpen || !watch) return null;

  const hasChanges = !!diff && diff.lines.length > 0;
  const isInitialOnly = !!diff && diff.snapshotCount <= 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-start justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            <GitCompare className="w-5 h-5 text-indigo-600 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 leading-none">変更点</h2>
              <p className="text-xs text-slate-500 mt-1 truncate" title={watch.title}>
                {watch.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition flex-shrink-0"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 比較範囲のサマリー */}
        {diff && !loading && (
          <div className="px-4 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center text-[11px] text-slate-500">
              <Clock className="w-3 h-3 mr-1 text-slate-400" />
              {diff.from ? (
                <>
                  <strong className="text-slate-700 font-medium">{formatDateTime(diff.from)}</strong>
                  <span className="mx-1.5 text-slate-300">→</span>
                  <strong className="text-slate-700 font-medium">{formatDateTime(diff.to)}</strong>
                </>
              ) : (
                <span>{formatDateTime(diff.to)} 時点</span>
              )}
            </span>

            {hasChanges && (
              <span className="flex items-center space-x-1.5">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                  <Plus className="w-3 h-3 mr-0.5" />
                  {diff.added}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60">
                  <Minus className="w-3 h-3 mr-0.5" />
                  {diff.removed}
                </span>
              </span>
            )}
          </div>
        )}

        {/* 差分本体 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-14 text-center text-slate-400 text-sm flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
              <span>変更点を読み込み中...</span>
            </div>
          ) : error ? (
            <div className="m-4 sm:m-5 p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : isInitialOnly ? (
            <div className="p-4 sm:p-5">
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                まだ最初のスナップショットしかないため、比較できる変更はありません。
                現在監視している内容は次のとおりです。
              </p>
              <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-xl p-3 whitespace-pre-wrap break-all leading-relaxed text-slate-600 max-h-72 overflow-y-auto">
                {(diff?.currentPreview || []).join('\n') || '（内容が取得できませんでした）'}
              </pre>
            </div>
          ) : !hasChanges ? (
            <div className="py-14 text-center text-slate-400 text-sm px-6">
              <Check className="w-8 h-8 mx-auto mb-2 text-emerald-400" />
              <p>この期間に変わった箇所はありません。</p>
            </div>
          ) : (
            <div className="px-2 sm:px-3 py-3">
              {!diff!.hasUnviewed && (
                <p className="mx-1.5 mb-2 text-[11px] text-slate-400">
                  未読の変更はありません。直近の変更内容を表示しています。
                </p>
              )}

              <div className="font-mono text-[11px] sm:text-xs leading-relaxed">
                {diff!.lines.map((line, idx) => {
                  if (line.type === 'gap') {
                    return (
                      <div
                        key={idx}
                        className="my-1 py-1 text-center text-[10px] text-slate-400 bg-slate-50/80 border-y border-dashed border-slate-200"
                      >
                        変更なし {line.count} 行
                      </div>
                    );
                  }

                  const style =
                    line.type === 'added'
                      ? 'bg-emerald-50 text-emerald-800 border-l-2 border-emerald-400'
                      : line.type === 'removed'
                        ? 'bg-rose-50 text-rose-800 border-l-2 border-rose-400'
                        : 'text-slate-500 border-l-2 border-transparent';
                  const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

                  return (
                    <div key={idx} className={`flex px-1.5 py-0.5 rounded-r ${style}`}>
                      <span className="w-3 flex-shrink-0 select-none opacity-70">{marker}</span>
                      <span className="flex-1 whitespace-pre-wrap break-all">{line.text}</span>
                    </div>
                  );
                })}
              </div>

              {diff!.truncated && (
                <p className="mt-2 mx-1.5 text-[10px] text-amber-600">
                  変更が多いため、途中までを表示しています。
                </p>
              )}
            </div>
          )}
        </div>

        {/* フッター: 差分を確認したうえで監視対象サイトへ */}
        <div className="px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
          <button
            onClick={async () => {
              await markViewed();
              onClose();
            }}
            disabled={marking}
            className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 disabled:opacity-40 rounded-xl transition inline-flex items-center"
          >
            <Check className="w-3.5 h-3.5 mr-1" />
            既読にする
          </button>

          <a
            href={watch.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              // 差分を確認したうえでサイトへ移動する動線。移動と同時に既読にする。
              void markViewed();
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all text-white text-xs font-semibold rounded-xl shadow-sm shadow-indigo-200 inline-flex items-center"
          >
            サイトを開く
            <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
