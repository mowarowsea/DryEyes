import React, { useEffect, useState } from 'react';
import { Copy, Loader2, UserRound } from 'lucide-react';
import { WatchModel, PublicUser } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { cancelButtonClass, choiceButtonClass, submitButtonClass } from '../ui';

interface CopyWatchModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (id: string, userId: string) => Promise<void>;
}

export const CopyWatchModal: React.FC<CopyWatchModalProps> = ({ watch, isOpen, onClose, onSubmit }) => {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに、コピー先に選べるユーザー一覧を取得し直す
  useEffect(() => {
    if (!isOpen) return;
    setSelectedUserId('');
    setError(null);
    setLoadingUsers(true);
    api
      .getUsers()
      .then(setUsers)
      .catch((err: any) => setError(err.message || 'ユーザー一覧の取得に失敗しました'))
      .finally(() => setLoadingUsers(false));
  }, [isOpen, watch]);

  if (!isOpen || !watch) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) {
      setError('コピー先のユーザーを選択してください');
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(watch.id, selectedUserId);
      onClose();
    } catch (err: any) {
      setError(err.message || 'コピーの作成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="コピーを作成"
      subtitle={watch.title}
      error={error}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-3 overflow-y-auto">
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          同じURL・チェック間隔・監視/除外設定のまま、選んだユーザーの所有物として新しい監視を作成します。
          通知は先方専用のトピックへ届き、以後は互いに独立して管理されます。
        </p>

        <div>
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5 block">
            コピー先のユーザー
          </label>

          {loadingUsers ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 py-2">読み込み中...</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 py-2">コピーできるユーザーがいません</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={`${choiceButtonClass(selectedUserId === u.id)} px-3 flex items-center gap-1.5`}
                >
                  <UserRound className="w-3.5 h-3.5" />
                  {u.username}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className={cancelButtonClass}>
            キャンセル
          </button>
          <button type="submit" disabled={submitting || !selectedUserId} className={submitButtonClass}>
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
            {submitting ? '作成中...' : 'コピーを作成'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
