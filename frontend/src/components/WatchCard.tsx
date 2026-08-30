import React, { useState } from 'react';
import {
  ExternalLink,
  Play,
  History,
  Trash2,
  AlertTriangle,
  CheckCircle,
  Clock,
  Pause,
} from 'lucide-react';
import { WatchModel } from '../types';

interface WatchCardProps {
  watch: WatchModel;
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onViewHistory: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
}

export const WatchCard: React.FC<WatchCardProps> = ({
  watch,
  onTriggerCheck,
  onTogglePause,
  onViewHistory,
  onDelete,
}) => {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCheck = async () => {
    try {
      setChecking(true);
      await onTriggerCheck(watch.id);
    } finally {
      setTimeout(() => setChecking(false), 800);
    }
  };

  const handleDelete = async () => {
    if (window.confirm(`「${watch.title}」の監視を削除しますか？`)) {
      setDeleting(true);
      try {
        await onDelete(watch.id);
      } finally {
        setDeleting(false);
      }
    }
  };

  // 時刻フォーマット
  const formatTime = (ts: number | null) => {
    if (!ts) return '未チェック';
    const date = new Date(ts * 1000);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSec < 60) return 'たった今';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // ステータス判定
  let statusBadge = (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
      <CheckCircle className="w-3 h-3 mr-1 text-emerald-500" />
      正常
    </span>
  );

  if (watch.paused) {
    statusBadge = (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
        <Pause className="w-3 h-3 mr-1 text-slate-400" />
        停止中
      </span>
    );
  } else if (watch.hasError) {
    statusBadge = (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200/60">
        <AlertTriangle className="w-3 h-3 mr-1 text-rose-500" />
        エラー
      </span>
    );
  } else if (watch.lastChanged && watch.lastChecked && watch.lastChanged >= watch.lastChecked - 60) {
    statusBadge = (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse" />
        更新検知
      </span>
    );
  }

  return (
    <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            {statusBadge}
            <span className="inline-flex items-center text-[11px] text-slate-400">
              <Clock className="w-3 h-3 mr-0.5" />
              {watch.checkIntervalMinutes}分毎
            </span>
          </div>

          <h3 className="font-semibold text-slate-900 text-base leading-tight truncate" title={watch.title}>
            {watch.title}
          </h3>

          <a
            href={watch.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs text-slate-500 hover:text-indigo-600 truncate max-w-full mt-1 group"
          >
            <span className="truncate">{watch.url}</span>
            <ExternalLink className="w-3 h-3 ml-1 flex-shrink-0 opacity-60 group-hover:opacity-100" />
          </a>
        </div>
      </div>

      {watch.lastError && (
        <div className="mt-2 text-xs bg-rose-50 border border-rose-100 text-rose-600 rounded-lg p-2 leading-relaxed">
          {watch.lastError}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex flex-col">
          <span>
            最終確認: <strong className="text-slate-700 font-medium">{formatTime(watch.lastChecked)}</strong>
          </span>
          {watch.lastChanged && (
            <span className="text-[11px] text-slate-400">
              最終変更: {formatTime(watch.lastChanged)}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={handleCheck}
            disabled={checking || watch.paused}
            className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 active:scale-95 disabled:opacity-40 transition rounded-lg"
            title="今すぐチェック"
          >
            <Play className={`w-4 h-4 ${checking ? 'animate-spin text-indigo-600' : ''}`} />
          </button>

          <button
            onClick={() => onTogglePause(watch.id, !watch.paused)}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition rounded-lg"
            title={watch.paused ? '再開する' : '一時停止する'}
          >
            <Pause className={`w-4 h-4 ${watch.paused ? 'text-amber-600' : ''}`} />
          </button>

          <button
            onClick={() => onViewHistory(watch)}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition rounded-lg"
            title="変更履歴"
          >
            <History className="w-4 h-4" />
          </button>

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:scale-95 disabled:opacity-40 transition rounded-lg"
            title="削除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
