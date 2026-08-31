import React, { useEffect, useRef, useState } from 'react';
import { Clock, ArrowRight, FileText, MousePointerClick, Bell, ClipboardPaste } from 'lucide-react';
import { CreateWatchDto } from '../types';
import { VisualElementPickerModal } from './VisualElementPickerModal';
import { Modal } from './Modal';
import { IntervalPicker } from './IntervalPicker';
import { api } from '../api';
import { canReadClipboard, readTextFromClipboard } from '../clipboard';
import { cancelButtonClass, largeInputClass, monoInputClass, submitButtonClass } from '../ui';

interface CreateWatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateWatchDto) => Promise<void>;
  /** ログイン中ユーザー専用の ntfy トピック。既定ではここへ通知が飛ぶ。 */
  userTopic: string;
  /** 共有シートなどから渡された URL。開いた時点で入力欄に入れておく。 */
  initialUrl?: string | null;
}

// 登録は 2 ステップ。
//   Step 1: URL の入力
//   Step 2: 要素ピッカー。表示名やチェック間隔などの設定もこの画面に畳んであり、
//           別画面に送らずそのまま登録まで終わる。
export const CreateWatchModal: React.FC<CreateWatchModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  userTopic,
  initialUrl,
}) => {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // フォームデータ
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(60); // デフォルト1時間
  const [includeFilters, setIncludeFilters] = useState('');
  const [subtractedFilters, setSubtractedFilters] = useState('');
  // 空なら自分専用トピックへまとめて通知する（通常はこれでよい）
  const [notificationTopic, setNotificationTopic] = useState('');

  const [loadingInfo, setLoadingInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 共有シートから渡された URL は、入力済みにしたうえでそのまま要素ピッカーまで進める。
  // スマホでの「アプリを開く → URL を打ち直す → 次へ」という往復をまるごと省くのが狙い。
  // ピッカーを閉じたときに開き直さないよう、自動で進めるのは URL ごとに 1 回だけにする。
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen || !initialUrl) return;

    setUrl(initialUrl);
    if (autoOpenedFor.current === initialUrl) return;
    autoOpenedFor.current = initialUrl;
    void proceedToPicker(initialUrl);
  }, [isOpen, initialUrl]);

  if (!isOpen) return null;

  // モーダルを閉じてリセット
  const handleClose = () => {
    setIsPickerOpen(false);
    setUrl('');
    setTitle('');
    setIntervalMinutes(60);
    setIncludeFilters('');
    setSubtractedFilters('');
    setNotificationTopic('');
    setError(null);
    onClose();
  };

  // Step 1 → Step 2。ページの <title> を取ってから要素ピッカーを開く。
  const proceedToPicker = async (urlOverride?: string) => {
    const target = (urlOverride ?? url).trim();
    if (!target) {
      setError('URLを入力してください');
      return;
    }

    try {
      setLoadingInfo(true);
      setError(null);
      const info = await api.getPageInfo(target);
      if (info && info.title) {
        setTitle(info.title);
      }
    } catch {
      /* タイトルが取れなくても登録は続行できる（表示名は URL のまま） */
    } finally {
      setLoadingInfo(false);
    }

    setIsPickerOpen(true);
  };

  const handleProceedToPicker = (e: React.FormEvent) => {
    e.preventDefault();
    void proceedToPicker();
  };

  // クリップボードにコピー済みの URL を 1 タップで入れる（secure context のみ）
  const handlePaste = async () => {
    const text = await readTextFromClipboard();
    if (!text) {
      setError('クリップボードから読み取れませんでした');
      return;
    }
    // 「記事タイトル https://…」のようにテキストが混ざっていても URL だけ拾う
    const match = text.match(/https?:\/\/\S+/i);
    setError(null);
    setUrl(match ? match[0] : text);
  };

  const linesOf = (value: string): string[] =>
    value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  // ピッカーからの確定。除外はその場で足して選び続け、監視対象を決めたら登録まで進む。
  const handlePickerConfirm = (xpath: string, _texts: string[], isExclude: boolean) => {
    if (isExclude) {
      if (xpath) setSubtractedFilters((prev) => (prev ? `${prev}\n${xpath}` : xpath));
      return;
    }

    // 要素を選ばずに確定した場合はページ全体が対象。
    // オプションで XPath を直接書いていればそちらを使う。
    void submitWatch(xpath ? [xpath] : linesOf(includeFilters));
  };

  const submitWatch = async (include: string[]) => {
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        url: url.trim(),
        title: title.trim() || url.trim(),
        fetchBackend: 'html_webdriver',
        checkIntervalMinutes: intervalMinutes,
        // 未指定なら BFF 側でログインユーザー専用トピックが使われる。
        // 指定した場合もそのユーザーのトピック配下に閉じ込められる。
        notificationTopic: notificationTopic.trim() || undefined,
        includeFilters: include,
        subtractedFilters: linesOf(subtractedFilters),
      });
      handleClose();
    } catch (err: any) {
      setError(err.message || '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 2 の画面に畳んで置く登録オプション
  const optionsPanel = (
    <>
      <div>
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center">
          <FileText className="w-3.5 h-3.5 mr-1 text-slate-400 dark:text-slate-500" />
          表示名（デフォルト: 対象ページのタイトル）
        </label>
        <input
          type="text"
          placeholder="監視名を入力..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={largeInputClass}
        />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center">
          <Clock className="w-3.5 h-3.5 mr-1 text-slate-400 dark:text-slate-500" />
          チェック間隔（デフォルト: 1時間）
        </label>
        <IntervalPicker value={intervalMinutes} onChange={setIntervalMinutes} />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
          監視する要素（XPath / CSS Selector、改行区切り）
        </label>
        <textarea
          rows={2}
          placeholder="画面で選んだ要素が使われます"
          value={includeFilters}
          onChange={(e) => setIncludeFilters(e.target.value)}
          className={monoInputClass}
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
          除外する要素（広告・タイムスタンプなど、改行区切り）
        </label>
        <textarea
          rows={2}
          placeholder=".advertisement, .timestamp"
          value={subtractedFilters}
          onChange={(e) => setSubtractedFilters(e.target.value)}
          className={monoInputClass}
        />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center">
          <Bell className="w-3.5 h-3.5 mr-1 text-indigo-500 dark:text-indigo-400" />
          通知先（この監視だけ別トピックに分ける・任意）
        </label>
        <input
          type="text"
          placeholder="空欄なら自分専用トピックにまとめて通知"
          value={notificationTopic}
          onChange={(e) => setNotificationTopic(e.target.value)}
          className={monoInputClass}
        />
        <p
          className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate"
          title={notificationTopic.trim() ? `${userTopic}-${notificationTopic.trim()}` : userTopic}
        >
          通知先: {notificationTopic.trim() ? `${userTopic}-${notificationTopic.trim()}` : userTopic}
          （他のユーザーには届きません）
        </p>
      </div>
    </>
  );

  const stepBadge = (
    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-full flex-shrink-0">
      Step 1/2
    </span>
  );

  return (
    <>
      {/* Step 1: URL入力画面 */}
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="監視対象URLの入力"
        badge={stepBadge}
        error={isPickerOpen ? null : error}
      >
        <form onSubmit={handleProceedToPicker} className="p-5 space-y-5 overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
              監視したいWebページのURL <span className="text-rose-500">*</span>
            </label>
            <div className="flex items-stretch gap-2">
              <input
                type="url"
                required
                autoFocus={!initialUrl}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://example.com/comics/123"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={`${largeInputClass} flex-1 min-w-0`}
              />
              {canReadClipboard() && (
                <button
                  type="button"
                  onClick={handlePaste}
                  aria-label="クリップボードから貼り付け"
                  className="px-3 flex-shrink-0 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl transition"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  <span>貼り付け</span>
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
              {initialUrl
                ? '共有されたURLを読み込みました。続けて要素の選択に進みます。'
                : 'スマホのブラウザから「共有 → DryEyes」でもここに入ります。'}
            </p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={loadingInfo || !url}
              className={`${submitButtonClass} w-full justify-center py-3`}
            >
              {loadingInfo ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>読み込み中...</span>
                </>
              ) : (
                <>
                  <MousePointerClick className="w-4 h-4" />
                  <span>次へ（要素を選択）</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClose}
              className={`${cancelButtonClass} w-full block text-center`}
            >
              キャンセル
            </button>
          </div>
        </form>
      </Modal>

      {/* Step 2: 要素ピッカー（登録オプションと登録ボタンも同じ画面に置く） */}
      <VisualElementPickerModal
        isOpen={isPickerOpen}
        badge="Step 2/2"
        confirmLabel="監視を登録する"
        allowEmptySelection
        submitting={submitting}
        error={error}
        options={optionsPanel}
        targetUrl={url}
        onClose={() => setIsPickerOpen(false)}
        onSelectXPath={handlePickerConfirm}
      />
    </>
  );
};
