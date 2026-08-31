import React, { useEffect, useState } from 'react';
import { X, Copy, ShieldAlert, Loader2 } from 'lucide-react';
import { WatchModel } from '../types';

interface CopyWatchModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, username: string) => Promise<void>;
}

export const CopyWatchModal: React.FC<CopyWatchModalProps> = ({ watch, isOpen, onClose, onSubmit }) => {
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに入力状態をリセットする
  useEffect(() => {
    if (!isOpen) return;
    setUsername('');
    setError(null);
  }, [isOpen, watch]);

  if (!isOpen || !watch) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name) {
      setError('コピー先のユーザー名を入力してください');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(watch.id, name);
      onClose();
    } catch (err: any) {
      setError(err.message || 'コピーの作成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-none">コピーを作成</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate" title={watch.title}>
              {watch.title}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 rounded-lg transition flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300 rounded-xl text-xs flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            同じURL・チェック間隔・監視/除外設定のまま、指定したユーザーの所有物として新しい監視を作成します。
            通知は先方専用のトピックへ届き、以後は互いに独立して管理されます。
          </p>
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1 block">
              コピー先のユーザー名
            </label>
            <input
              type="text"
              autoFocus
              placeholder="ユーザー名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-xl shadow-sm shadow-indigo-200 dark:shadow-none flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
              {submitting ? '作成中...' : 'コピーを作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
