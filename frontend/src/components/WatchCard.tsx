import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Globe,
  History,
  Image as ImageIcon,
  MoreVertical,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  Signpost,
  Trash2,
  Download,
} from 'lucide-react';
import { WatchModel } from '../types';
import { unviewedCountOf } from '../watchStatus';
import { useClickOutside } from '../hooks/useClickOutside';
import { useCardImage } from '../hooks/useCardImage';
import { CARD_IMAGE_MASK, CARD_IMAGE_WIDTH, cropBackgroundStyle } from '../cardImage';
import { apiUrl } from '../api';

interface WatchCardProps {
  watch: WatchModel;
  // 登録直後の数秒だけ true。どれが増えたのか一目で分かるようにする。
  highlighted?: boolean;
  // 背景に絵を敷くか（アカウント画面の表示設定）
  showImage?: boolean;
  onTriggerCheck: (id: string) => Promise<void>;
  onTogglePause: (id: string, paused: boolean) => Promise<void>;
  onOpenDiff: (watch: WatchModel) => void;
  // 変更履歴（いつ何が変わったか）を開く
  onOpenHistory: (watch: WatchModel) => void;
  // 見つけた新着を PowerDowner へ投入する画面を開く
  onOpenFeed: (watch: WatchModel) => void;
  onEdit: (watch: WatchModel) => void;
  onDelete: (id: string) => Promise<void>;
  onCopyTo: (watch: WatchModel) => void;
  // 監視先が別 URL へ転送されていたときの確認を開く
  onReviewRedirect: (watch: WatchModel) => void;
  // 背景に敷く絵を選び直す
  onChangeImage: (watch: WatchModel) => void;
}

// 転送先の見分けはホストで付くので、帯にはそこだけ出す
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// 監視対象サイトのファビコン。
// /favicon.ico を直接読むと、そこに置いていないサイトや UA を見て弾くサイトで取れないため、
// BFF に <link rel="icon"> まで見て取ってきてもらう（外部のファビコンサービスは使わない）。
const faviconUrlOf = (url: string): string | null => {
  try {
    new URL(url);
  } catch {
    return null;
  }
  return apiUrl(`/proxy/favicon?url=${encodeURIComponent(url)}`);
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
  highlighted = false,
  showImage = true,
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
}) => {
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const imageLayerRef = useRef<HTMLDivElement>(null);
  // 切り抜きを当てるには、絵を敷く箱の実寸が要る（割合で持っている指定を px へ戻すため）
  const [imageBox, setImageBox] = useState<{ width: number; height: number } | null>(null);

  // 並び順によっては登録した監視が画面の外に入る（既定の更新日時順では末尾に付く）。
  // 光らせるだけでは気づけないので、その位置まで一緒に運ぶ。
  useEffect(() => {
    if (!highlighted) return;
    cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [highlighted]);

  // URL を差し替えると ?url= の中身も変わるので、ブラウザは自動で新しいアイコンを取りに行く
  const faviconUrl = faviconUrlOf(watch.url);
  useEffect(() => setFaviconFailed(false), [faviconUrl]);

  // そのページらしい絵。決められなかった監視では null になり、従来どおりの見た目になる。
  const cardImage = useCardImage(watch.id, showImage);

  // 箱の大きさは画面幅でもカードの中身（エラー帯や移転の確認）でも変わるので、見張って追う。
  // 切り抜きを指定していない監視では要らない計算なので、そのときは測らない。
  useEffect(() => {
    const layer = imageLayerRef.current;
    if (!layer || !cardImage?.crop) return;

    const measure = () => setImageBox({ width: layer.clientWidth, height: layer.clientHeight });
    measure();
    // jsdom など ResizeObserver が無い環境では、初回に測った値のまま使う
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [cardImage]);

  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));

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

  // 未読の判定・件数は一覧のフィルタと同じ関数を使う（食い違うと件数とバッジがずれる）
  const unviewedCount = unviewedCountOf(watch);
  // 未読ありの強調（highlighted は登録直後の強調で、別物）
  const emphasizeUnviewed = unviewedCount > 0 && !watch.paused;

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

  // カード本体のタップで差分モーダルを開く。メニュー内の操作には伝播させない。
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  const menuItemClass =
    'w-full px-3 py-2.5 text-left text-xs font-medium flex items-center gap-2 transition disabled:opacity-40';

  // 切り抜きの指定があり、箱の大きさも測れているときだけ当てる。
  // 測る前は今までどおり cover / center で敷いておく（読み込み中に絵が飛ばない）。
  const cropStyle =
    cardImage?.crop && imageBox && imageBox.width > 0 && imageBox.height > 0
      ? cropBackgroundStyle(cardImage.crop, imageBox.width, imageBox.height)
      : null;

  return (
    <div
      ref={cardRef}
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
        highlighted
          ? 'border-indigo-400 dark:border-indigo-400/70 animate-justAdded'
          : emphasizeUnviewed
            ? 'border-amber-300 dark:border-amber-500/50'
            : 'border-slate-200/80 dark:border-slate-800'
      } ${deleting ? 'opacity-50 pointer-events-none' : ''}`}
    >
      {/* そのページらしい絵。中身の下に敷くので、以降の要素は z-10 で上に載せる。 */}
      {cardImage && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 rounded-xl overflow-hidden"
        >
          <div
            ref={imageLayerRef}
            className="absolute inset-y-0 right-0 bg-cover bg-center opacity-80 dark:opacity-60"
            style={{
              width: CARD_IMAGE_WIDTH,
              backgroundImage: `url(${cardImage.url})`,
              maskImage: CARD_IMAGE_MASK,
              WebkitMaskImage: CARD_IMAGE_MASK,
              ...cropStyle,
            }}
          />
        </div>
      )}

      {/* この行は position + z-index でスタッキングコンテキストを作るので、メニューの z-20 は
          この中に閉じ込められる。同じ z-10 で後から描かれる下の帯（転送の確認や失敗の表示）に
          負けてメニューの上に重なってしまうため、開いている間だけこの行ごと持ち上げる。 */}
      <div className={`relative ${menuOpen ? 'z-20' : 'z-10'} flex items-center gap-2`}>
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
          {/* 背景に絵が入ると、この位置は絵がいちばんはっきり出るところ。半透明＋ぼかしの
              下敷きを付けて、明るい絵でも暗い絵でもアイコンが沈まないようにする。 */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="操作メニュー"
            aria-expanded={menuOpen}
            className={`p-1.5 active:scale-95 rounded-lg transition ${
              cardImage
                ? 'text-slate-800 bg-white/75 ring-1 ring-slate-900/10 backdrop-blur-sm hover:bg-white dark:text-slate-100 dark:bg-slate-900/70 dark:ring-white/15 dark:hover:bg-slate-900'
                : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800'
            }`}
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

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenHistory(watch);
                }}
                className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
              >
                <History className="w-3.5 h-3.5 text-slate-400" />
                変更履歴
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenFeed(watch);
                }}
                className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                ダウンロード投入
              </button>

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

              {/* 背景の絵は機械が推測したもので、当たらないこともある。
                  絵を出していない設定のときは変えても見えないので、そのときは出さない。 */}
              {showImage && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onChangeImage(watch);
                  }}
                  className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
                >
                  <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                  背景画像を変更
                </button>
              )}

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onCopyTo(watch);
                }}
                className={`${menuItemClass} text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800`}
              >
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                別ユーザへコピー
              </button>

              <button
                onClick={handleDelete}
                disabled={deleting}
                className={`${menuItemClass} text-rose-600 dark:text-rose-400 border-t border-slate-100 dark:border-slate-800 hover:bg-rose-50 dark:hover:bg-rose-500/10`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                削除
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-1 pl-7 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
        {statusBadge}
        <span>
          更新: <span className="text-slate-700 dark:text-slate-300 font-medium">{watch.lastChanged ? formatTime(watch.lastChanged) : 'なし'}</span>
        </span>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span>確認: {formatTime(watch.lastChecked)}</span>
      </div>

      {/* 監視先の移転は、承認するまで反映されない。気づける場所に置いて確認へ誘導する。 */}
      {watch.pendingRedirect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReviewRedirect(watch);
          }}
          className="relative z-10 mt-1.5 ml-7 w-[calc(100%-1.75rem)] text-left text-[11px] bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-200 rounded-lg px-2 py-1 leading-relaxed flex items-center gap-1.5 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition"
        >
          <Signpost className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 min-w-0 truncate">
            {hostOf(watch.pendingRedirect.toUrl)} へ転送されています
          </span>
          <span className="flex-shrink-0 font-bold underline">確認</span>
        </button>
      )}

      {watch.lastError && (
        <div className="relative z-10 mt-1.5 ml-7 text-[11px] bg-rose-50 border border-rose-100 text-rose-600 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-300 rounded-lg px-2 py-1 leading-relaxed line-clamp-2">
          {watch.lastError}
        </div>
      )}
    </div>
  );
};
