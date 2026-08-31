import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  FileText,
  MousePointerClick,
  Sparkles,
  Layers,
  Bell,
  ClipboardPaste,
  Globe,
} from 'lucide-react';
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

export const CreateWatchModal: React.FC<CreateWatchModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  userTopic,
  initialUrl,
}) => {
  // ステップ管理: 1 = URL入力, 2 = ピッカー (モーダル), 3 = 登録オプション
  const [step, setStep] = useState<1 | 3>(1);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // フォームデータ
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(60); // デフォルト1時間
  const [extractedTexts, setExtractedTexts] = useState<string[]>([]);
  const [includeFilters, setIncludeFilters] = useState('');
  const [subtractedFilters, setSubtractedFilters] = useState('');
  // 空なら自分専用トピックへまとめて通知する（通常はこれでよい）
  const [notificationTopic, setNotificationTopic] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false); // デフォルトでアコーディオンを閉じる

  const [loadingInfo, setLoadingInfo] = useState<'picker' | 'whole' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 共有シートから渡された URL は、モーダルを開いた時点で入力済みにする。
  // スマホでの「アプリを開く → URL を打ち直す」という一番面倒な往復をなくすのが狙い。
  useEffect(() => {
    if (isOpen && initialUrl) setUrl(initialUrl);
  }, [isOpen, initialUrl]);

  if (!isOpen) return null;

  // モーダルを閉じてリセット
  const handleClose = () => {
    setStep(1);
    setIsPickerOpen(false);
    setUrl('');
    setTitle('');
    setIntervalMinutes(60);
    setExtractedTexts([]);
    setIncludeFilters('');
    setSubtractedFilters('');
    setNotificationTopic('');
    setShowAdvanced(false);
    setError(null);
    onClose();
  };

  // Step 1: URL を確定して次へ進む。
  // mode='picker' なら要素ピッカーへ、mode='whole' ならページ全体を対象にして登録画面へ直行する。
  // スマホでは小さな画面から要素を選ぶのが一番つらいので、後から絞り込めるよう素通しの道を残す。
  const proceed = async (mode: 'picker' | 'whole') => {
    if (!url.trim()) {
      setError('URLを入力してください');
      return;
    }

    try {
      setLoadingInfo(mode);
      setError(null);
      // ページの <title> を取得
      const info = await api.getPageInfo(url.trim());
      if (info && info.title) {
        setTitle(info.title);
      }
    } catch {
      /* タイトルが取れなくても登録は続行できる（表示名は URL のまま） */
    } finally {
      setLoadingInfo(null);
    }

    if (mode === 'picker') {
      setIsPickerOpen(true);
    } else {
      // フィルタなし = ページ全体を監視
      setStep(3);
    }
  };

  const handleProceedToPicker = (e: React.FormEvent) => {
    e.preventDefault();
    void proceed('picker');
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

  // Step 2: ピッカーで要素を選択した後の処理
  const handlePickerSelect = (xpath: string, texts: string[], isExclude: boolean) => {
    setIsPickerOpen(false);
    if (xpath) {
      if (isExclude) {
        setSubtractedFilters((prev) => (prev ? `${prev}\n${xpath}` : xpath));
      } else {
        setIncludeFilters(xpath);
      }
      if (texts && texts.length > 0) {
        setExtractedTexts(texts);
      }
    }
    // アコーディオンは閉じたまま維持
    setShowAdvanced(false);
    // Step 3（登録オプション画面）へ進む
    setStep(3);
  };

  // Step 3: 最終登録実行
  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError('URLを入力してください');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const chosenTitle = title.trim() || url.trim();
      await onSubmit({
        url: url.trim(),
        title: chosenTitle,
        fetchBackend: 'html_webdriver',
        checkIntervalMinutes: intervalMinutes,
        // 未指定なら BFF 側でログインユーザー専用トピックが使われる。
        // 指定した場合もそのユーザーのトピック配下に閉じ込められる。
        notificationTopic: notificationTopic.trim() || undefined,
        includeFilters: includeFilters.split('\n').map((s) => s.trim()).filter(Boolean),
        subtractedFilters: subtractedFilters.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      handleClose();
    } catch (err: any) {
      setError(err.message || '登録に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const stepBadge = (
    <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-full flex-shrink-0">
      {step === 1 ? 'Step 1/3' : 'Step 3/3'}
    </span>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={step === 1 ? '監視対象URLの入力' : '登録オプションの設定'}
        badge={stepBadge}
        error={error}
      >
        {/* ---------------------------------------------------- */}
        {/* Step 1: URL入力画面 */}
        {/* ---------------------------------------------------- */}
        {step === 1 && (
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
                  ? '共有されたURLを読み込みました。このまま次へ進めます。'
                  : 'スマホのブラウザから「共有 → DryEyes」でもここに入ります。'}
              </p>
            </div>

            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={loadingInfo !== null || !url}
                className={`${submitButtonClass} w-full justify-center py-3`}
              >
                {loadingInfo === 'picker' ? (
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

              {/* 要素選びはスマホだと重いので、ページ全体で先に登録してしまう道も用意する */}
              <button
                type="button"
                onClick={() => void proceed('whole')}
                disabled={loadingInfo !== null || !url}
                className="w-full py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 rounded-xl transition"
              >
                {loadingInfo === 'whole' ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    <span>読み込み中...</span>
                  </>
                ) : (
                  <>
                    <Globe className="w-4 h-4" />
                    <span>ページ全体を見張る（要素選択をとばす）</span>
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
        )}

        {/* ---------------------------------------------------- */}
        {/* Step 3: 登録オプション入力画面 */}
        {/* ---------------------------------------------------- */}
        {step === 3 && (
          <form onSubmit={handleFinalSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
            {/* 表示名 */}
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center">
                <FileText className="w-3.5 h-3.5 mr-1 text-slate-400 dark:text-slate-500" />
                表示名（デフォルト: 対象ページのタイトル）
              </label>
              <input
                type="text"
                required
                placeholder="監視名を入力..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={largeInputClass}
              />
            </div>

            {/* 監視対象から抽出した文字列（初期バージョン・全件表示） */}
            {extractedTexts.length > 0 && (
              <div className="p-3 bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/30 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-900 dark:text-indigo-200">
                  <span className="flex items-center">
                    {extractedTexts.length > 1 ? (
                      <Layers className="w-3.5 h-3.5 mr-1 text-purple-600 dark:text-purple-400" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-600 dark:text-indigo-400" />
                    )}
                    {extractedTexts.length > 1
                      ? `監視対象の要素一覧（全 ${extractedTexts.length} 件）`
                      : '監視対象の要素テキスト（初期状態）'}
                  </span>
                  {extractedTexts.length > 1 && (
                    <span className="text-[10px] bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full font-bold">
                      類似一括監視
                    </span>
                  )}
                </div>

                {/* 全件スクロールリスト */}
                <div className="max-h-36 overflow-y-auto space-y-1 bg-white/90 dark:bg-slate-900/90 p-2 rounded-lg border border-indigo-100/80 dark:border-indigo-500/30">
                  {extractedTexts.map((txt, idx) => (
                    <div
                      key={idx}
                      className="text-xs font-mono text-slate-700 dark:text-slate-200 truncate bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded border border-slate-200/60 dark:border-slate-700"
                      title={txt}
                    >
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans mr-1.5">#{idx + 1}</span>
                      {txt}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* オプション（通知先・チェック間隔・XPath詳細、デフォルト閉じのアコーディオン） */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 py-1"
              >
                <span className="flex items-center">
                  <Target className="w-3.5 h-3.5 mr-1 text-slate-400 dark:text-slate-500" />
                  オプション（通知先・チェック間隔・監視要素の詳細）
                </span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvanced && (
                <div className="space-y-3 mt-3 p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-xl animate-fadeIn">
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
                      placeholder="//*[@id='...']"
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
                      通知先: {notificationTopic.trim() ? `${userTopic}-${notificationTopic.trim()}` : userTopic}（他のユーザーには届きません）
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* フッター */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                className="px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                <span>{includeFilters ? '要素を選び直す' : '監視する要素をしぼり込む'}</span>
              </button>

              <div className="flex items-center space-x-2">
                <button type="button" onClick={handleClose} disabled={submitting} className={cancelButtonClass}>
                  キャンセル
                </button>
                <button type="submit" disabled={submitting} className={submitButtonClass}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submitting ? '登録中...' : '監視を登録する（OK）'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Step 2: ビジュアル要素ピッカーモーダル */}
      <VisualElementPickerModal
        isOpen={isPickerOpen}
        targetUrl={url}
        onClose={() => setIsPickerOpen(false)}
        onSelectXPath={handlePickerSelect}
      />
    </>
  );
};
