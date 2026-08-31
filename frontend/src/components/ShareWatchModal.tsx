import React, { useEffect, useState } from 'react';
import { X, Share2, ShieldAlert, UserPlus, UserMinus, Loader2 } from 'lucide-react';
import { WatchModel, SharedUser } from '../types';
import { api } from '../api';

interface ShareWatchModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareWatchModal: React.FC<ShareWatchModalProps> = ({ watch, isOpen, onClose }) => {
  const [username, setUsername] = useState('');
  const [shares, setShares] = useState<SharedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに、現在この監視を共有しているユーザーを取得し直す
  useEffect(() => {
    if (!isOpen || !watch) return;
    setUsername('');
    setError(null);
    setLoading(true);
    api
      .getShares(watch.id)
      .then(setShares)
      .catch((err: any) => setError(err.message || '共有先の取得に失敗しました'))
      .finally(() => setLoading(false));
  }, [isOpen, watch]);

  if (!isOpen || !watch) return null;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name) {
      setError('共有したいユーザー名を入力してください');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const updated = await api.shareWatch(watch.id, name);
      setShares(updated);
      setUsername('');
    } catch (err: any) {
      setError(err.message || '共有に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      setRemovingId(userId);
      setError(null);
      await api.unshareWatch(watch.id, userId);
      setShares((prev) => prev.filter((u) => u.id !== userId));
    } catch (err: any) {
      setError(err.message || '共有の解除に失敗しました');
    } finally {
      setRemovingId(null);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-none">別ユーザへ共有</h2>
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

        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            共有した相手はこの監視を自分の一覧から確認・チェックできます。設定変更や削除、共有の管理は
            あなただけが行えます。
          </p>

          {/* 共有追加フォーム */}
          <form onSubmit={handleAdd} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="共有したいユーザー名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputClass}
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-lg shadow-sm shadow-indigo-200 dark:shadow-none flex items-center gap-1 flex-shrink-0"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              共有
            </button>
          </form>

          {/* 共有中のユーザー一覧 */}
          <div>
            <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center">
              <Share2 className="w-3.5 h-3.5 mr-1 text-slate-400" />
              共有中のユーザー
            </p>
            {loading ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 py-2">読み込み中...</p>
            ) : shares.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 py-2">まだ誰にも共有していません</p>
            ) : (
              <ul className="space-y-1.5">
                {shares.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-lg"
                  >
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                      {u.username}
                    </span>
                    <button
                      onClick={() => handleRemove(u.id)}
                      disabled={removingId === u.id}
                      aria-label={`${u.username} への共有を解除`}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-500/10 rounded-md transition disabled:opacity-40 flex-shrink-0"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* フッター */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
