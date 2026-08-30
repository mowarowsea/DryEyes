import React, { useEffect, useState } from 'react';
import { X, History, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { WatchModel, WatchHistoryItem } from '../types';
import { api } from '../api';

interface HistoryModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ watch, isOpen, onClose }) => {
  const [history, setHistory] = useState<WatchHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !watch) return;

    const fetchHistory = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getHistory(watch.id);
        setHistory(data);
      } catch (err: any) {
        setError(err.message || '履歴の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [isOpen, watch]);

  if (!isOpen || !watch) return null;

  const formatDate = (ts: number) => {
    return new Date(ts * 1000).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <History className="w-5 h-5 text-indigo-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-none">変更履歴</h2>
              <p className="text-xs text-slate-500 mt-1 truncate max-w-xs">{watch.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm flex flex-col items-center">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
              <span>履歴を読み込み中...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              <Clock className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              <p>まだ変更履歴のスナップショットはありません。</p>
            </div>
          ) : (
            <div className="relative pl-6 border-l-2 border-indigo-100 space-y-6 my-2">
              {history.map((item, idx) => (
                <div key={item.timestamp} className="relative group">
                  {/* タイムラインドット */}
                  <div className="absolute -left-[31px] top-0.5 w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 group-hover:scale-125 transition-transform" />

                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-900 flex items-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mr-1" />
                        スナップショット #{history.length - idx}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {formatDate(item.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      ID: {item.snapshotId}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition shadow-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
