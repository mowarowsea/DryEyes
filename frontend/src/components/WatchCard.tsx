import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Globe,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import { WatchModel } from '../types';

interface WatchCardProps {
  watch: WatchModel;
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onOpenDiff: (watch: WatchModel) => void;
  onEdit: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
  onShare: (watch: WatchModel) => void;
  /** 設定を保存した時刻。変わるとファビコンをブラウザキャッシュから読まずに取り直す。 */
  faviconVersion?: number;
}

// 監視対象サイトのファビコン。
// /favicon.ico を直接読むと、そこに置いていないサイトや UA を見て弾くサイトで取れないため、
// BFF に <link rel="icon"> まで見て取ってきてもらう（外部のファビコンサービスは使わない）。
const faviconUrlOf = (url: string): string | null => {
  try {
    new URL(url);
  } catch {
    return null;
  }
  return `/api/proxy/favicon?url=${encodeURIComponent(url)}`;
};

// 時刻フォーマット
const formatTime = (ts: number | null) => {
  if (!ts) return '未チェック';
  const date = new Date(ts * 1000);
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);

  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  return date.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const WatchCard: React.FC<WatchCardProps> = ({
  watch,
  onTriggerCheck,
  onTogglePause,
  onOpenDiff,
  onEdit,
  onDelete,
  onShare,
  faviconVersion,
}) => {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // URL を差し替えた直後は、同じアイコンURLでもブラウザのキャッシュを避けて取り直す
  const faviconUrl = useMemo(() => {
    const base = faviconUrlOf(watch.url);
    if (!base) return null;
    return faviconVersion ? `${base}?v=${faviconVersion}` : base;
  }, [watch.url, faviconVersion]);
  useEffect(() => setFaviconFailed(false), [faviconUrl]);

  // メニュー外のタップで閉じる
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handleCheck = async () => {
    setMenuOpen(false);
    try {
      setChecking(true);
      await onTriggerCheck(watch.id);
    } finally {
      setTimeout(() => setChecking(false), 800);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm(`「${watch.title}」の監視を削除しますか？`)) return;
    setDeleting(true);
    try {
      await onDelete(watch.id);
    } finally {
      setDeleting(false);
    }
  };

  // isOwner を持たない古いレスポンスは自分の監視しか含まれていなかったので所有者扱いにする
  const isOwner = watch.isOwner ?? true;

  // 未読判定は BFF が返す hasUnviewed を使う。
  // 古いレスポンス等で欠けている場合のみ、直近の変更検知にフォールバックする。
  const hasUnviewed =
    watch.hasUnviewed ??
    Boolean(watch.lastChanged && watch.lastChecked && watch.lastChanged >= watch.lastChecked - 60);

  // 最後に差分を見てから何回更新されたか。件数を持たない古い BFF では未読の有無だけ分かる。
  const unviewedCount = watch.unviewedCount ?? (hasUnviewed ? 1 : 0);
  const highlight = unviewedCount > 0 && !watch.paused;

  // ステータス（停止中・エラーのときだけ出し、通常時は行を使わない）
  let statusBadge: React.ReactNode = null;
  if (watch.paused) {
    statusBadge = (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
        <Pause className="w-2.5 h-2.5 mr-0.5" />
        停止中
      </span>
    );
  } else if (watch.hasError) {
    statusBadge = (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200/60 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
        エラー
      </span>
    );
  }

  // 自分が所有していない（共有されているだけの）監視だと分かるようにする
  const sharedBadge = !isOwner ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-200/60 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30">
      <Users className="w-2.5 h-2.5 mr-0.5" />
      共有中
    </span>
  ) : null;

  // カード本体のタップで差分モーダルを開く。メニュー内の操作には伝播させない。
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  const menuItemClass =
    'w-full px-3 py-2.5 text-left text-xs font-medium flex items-center gap-2 transition disabled:opacity-40';

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${watch.title} の変更点を見る`}
      onClick={() => {
        // メニュー操作の取りこぼしで差分が開かないよう、開いている間は閉じるだけにする
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        onOpenDiff(watch);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (menuOpen) {
            setMenuOpen(false);
            return;
          }
          onOpenDiff(watch);
        }
      }}
      // メニューを開いている間は active:scale を外す。押している間 transform が入ると
      // カードが新しいスタッキングコンテキストになり、メニューの z-20 がカード内部に閉じて
      // 下のカードの裏に回ってしまう（mouseup が下のカードに当たり、操作が効かなくなる）。
      // 合わせてカード自体を z-30 まで持ち上げ、後続のカードより確実に前に出す。
      className={`relative text-left bg-white dark:bg-slate-900 border rounded-xl px-3 py-2.5 shadow-sm hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer transition ${
        menuOpen ? 'z-30' : 'active:scale-[0.995]'
      } ${
        highlight
          ? 'border-amber-300 dark:border-amber-500/50'
          : 'border-slate-200/80 dark:border-slate-800'
      } ${deleting ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="flex items-center gap-2">
        {/* ファビコン（取得できないサイトは地球アイコンで代用） */}
        <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
          {faviconUrl && !faviconFailed ? (
            <img
              src={faviconUrl}
              alt=""
              loading="lazy"
              onError={() => setFaviconFailed(true)}
              className="w-4 h-4 object-contain"
            />
          ) : (
            <Globe className="w-3 h-3 text-slate-400 dark:text-slate-500" />
          )}
        </span>

        <h3
          className="flex-1 min-w-0 font-semibold text-slate-900 dark:text-slate-100 text-sm leading-tight truncate"
          title={watch.title}
        >
          {watch.title}
        </h3>

        {/* 最後に見てからの更新回数を目立たせる */}
        {unviewedCount > 0 && (
          <span
            className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums shadow-sm ${
              watch.paused
                ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                : 'bg-amber-500 text-white dark:bg-amber-400 dark:text-slate-900'
            }`}
            title={`前回確認してから ${unviewedCount} 回更新されています`}
          >
            {unviewedCount}回更新
          </span>
        )}

        {/* 操作メニュー */}
        <div className="relative flex-shrink-0" ref={menuRef} onClick={stopPropagation}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="操作メニュー"
            aria-expanded={menuOpen}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 active:scale-95 rounded-lg transition"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl shadow-slate-300/50 dark:shadow-black/50 overflow-hidden animate-fadeIn">
              <button
                onClick={handleCheck}
                disabled={checking || watch.paused}
                className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin text-indigo-600' : 'text-slate-400'}`} />
                今すぐチェック
              </button>

              {isOwner && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onTogglePause(watch.id, !watch.paused);
                  }}
                  className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
                >
                  {watch.paused ? (
                    <Play className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Pause className="w-3.5 h-3.5 text-slate-400" />
                  )}
                  {watch.paused ? '監視を再開' : '監視を停止'}
                </button>
              )}

              {isOwner && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit(watch);
                  }}
                  className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
                >
                  <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                  設定を変更
                </button>
              )}

              {isOwner && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onShare(watch);
                  }}
                  className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-400" />
                  別ユーザへ共有
                </button>
              )}

              {isOwner && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className={`${menuItemClass} text-rose-600 dark:text-rose-400 border-t border-slate-100 dark:border-slate-800 hover:bg-rose-50 dark:hover:bg-rose-500/10`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  削除
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 pl-7 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
        {statusBadge}
        {sharedBadge}
        <span>
          更新: <span className="text-slate-700 dark:text-slate-300 font-medium">{watch.lastChanged ? formatTime(watch.lastChanged) : 'なし'}</span>
        </span>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span>確認: {formatTime(watch.lastChecked)}</span>
      </div>

      {watch.lastError && (
        <div className="mt-1.5 ml-7 text-[11px] bg-rose-50 border border-rose-100 text-rose-600 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300 rounded-lg px-2 py-1 leading-relaxed line-clamp-2">
          {watch.lastError}
        </div>
      )}
    </div>
  );
};
