import React, { useState } from 'react';
import {
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  Target,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  FileText,
  MousePointerClick,
  Sparkles,
  Layers,
  Bell,
} from 'lucide-react';
import { CreateWatchDto } from '../types';
import { VisualElementPickerModal } from './VisualElementPickerModal';
import { api } from '../api';

interface CreateWatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateWatchDto) => Promise<void>;
  /** ログイン中ユーザー専用の ntfy トピック。既定ではここへ通知が飛ぶ。 */
  userTopic: string;
}

const INTERVAL_PRESETS = [
  { label: '5分', value: 5 },
  { label: '10分', value: 10 },
  { label: '30分', value: 30 },
  { label: '1時間', value: 60 },
  { label: '6時間', value: 360 },
  { label: '24時間', value: 1440 },
];

export const CreateWatchModal: React.FC<CreateWatchModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  userTopic,
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

  const [loadingInfo, setLoadingInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Step 1: URL入力からピッカーへ進む
  const handleProceedToPicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError('URLを入力してください');
      return;
    }

    try {
      setLoadingInfo(true);
      setError(null);
      // ページの <title> を取得
      const info = await api.getPageInfo(url.trim());
      if (info && info.title) {
        setTitle(info.title);
      }
      setIsPickerOpen(true);
    } catch {
      setIsPickerOpen(true);
    } finally {
      setLoadingInfo(false);
    }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-bold rounded-full">
              {step === 1 ? 'Step 1/3' : 'Step 3/3'}
            </span>
            <h2 className="text-base font-bold text-slate-900">
              {step === 1 ? '監視対象URLの入力' : '登録オプションの設定'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* Step 1: URL入力画面 */}
        {/* ---------------------------------------------------- */}
        {step === 1 && (
          <form onSubmit={handleProceedToPicker} className="p-5 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                監視したいWebページのURL <span className="text-rose-500">*</span>
              </label>
              <input
                type="url"
                required
                autoFocus
                placeholder="https://example.com/comics/123"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-sm"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                次のステップで、このページのどの要素（話数や価格など）を見張るか画面上で選択します。
              </p>
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={loadingInfo || !url}
                className="px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-xl shadow-md shadow-indigo-200 flex items-center space-x-1.5"
              >
                {loadingInfo ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
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
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center">
                <FileText className="w-3.5 h-3.5 mr-1 text-slate-400" />
                表示名（デフォルト: 対象ページのタイトル）
              </label>
              <input
                type="text"
                required
                placeholder="監視名を入力..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
              />
            </div>

            {/* 通知先（ユーザー専用トピック） */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <p className="text-[11px] font-semibold text-slate-700 flex items-center mb-1">
                <Bell className="w-3.5 h-3.5 mr-1 text-indigo-500" />
                通知先
              </p>
              <code className="block text-[11px] font-mono text-slate-600 truncate" title={notificationTopic.trim() || userTopic}>
                {notificationTopic.trim() ? `${userTopic}-${notificationTopic.trim()}` : userTopic}
              </code>
              <p className="text-[10px] text-slate-400 mt-1">
                あなた専用のトピックです。他のユーザーには届きません。
              </p>
            </div>

            {/* 監視対象から抽出した文字列（初期バージョン・全件表示） */}
            {extractedTexts.length > 0 && (
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-indigo-900">
                  <span className="flex items-center">
                    {extractedTexts.length > 1 ? (
                      <Layers className="w-3.5 h-3.5 mr-1 text-purple-600" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-600" />
                    )}
                    {extractedTexts.length > 1
                      ? `監視対象の要素一覧（全 ${extractedTexts.length} 件）`
                      : '監視対象の要素テキスト（初期状態）'}
                  </span>
                  {extractedTexts.length > 1 && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">
                      類似一括監視
                    </span>
                  )}
                </div>

                {/* 全件スクロールリスト */}
                <div className="max-h-36 overflow-y-auto space-y-1 bg-white/90 p-2 rounded-lg border border-indigo-100/80">
                  {extractedTexts.map((txt, idx) => (
                    <div
                      key={idx}
                      className="text-xs font-mono text-slate-700 truncate bg-slate-50 px-2 py-1 rounded border border-slate-200/60"
                      title={txt}
                    >
                      <span className="text-[10px] text-slate-400 font-sans mr-1.5">#{idx + 1}</span>
                      {txt}
                    </div>
                  ))}
                </div>

                <p className="text-[10px] text-indigo-500">
                  ※このリストに新しい話数や要素が追加・変化した際に、自動で更新検知・通知されます。
                </p>
              </div>
            )}

            {/* チェック間隔（デフォルト: 1時間） */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center">
                <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                チェック間隔（デフォルト: 1時間）
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {INTERVAL_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setIntervalMinutes(p.value)}
                    className={`py-2 text-xs font-medium rounded-lg border transition ${
                      intervalMinutes === p.value
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 特定要素の監視・除外設定（デフォルト閉じのアコーディオン） */}
            <div className="border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center justify-between w-full text-xs font-medium text-slate-600 hover:text-slate-900 py-1"
              >
                <span className="flex items-center">
                  <Target className="w-3.5 h-3.5 mr-1 text-slate-400" />
                  特定要素の監視・除外設定（XPath / セレクタ詳細）
                </span>
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showAdvanced && (
                <div className="space-y-3 mt-3 p-3 bg-slate-50 border border-slate-200/80 rounded-xl animate-fadeIn">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      監視する要素（XPath / CSS Selector、改行区切り）
                    </label>
                    <textarea
                      rows={2}
                      placeholder="//*[@id='...']"
                      value={includeFilters}
                      onChange={(e) => setIncludeFilters(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      除外する要素（広告・タイムスタンプなど、改行区切り）
                    </label>
                    <textarea
                      rows={2}
                      placeholder=".advertisement, .timestamp"
                      value={subtractedFilters}
                      onChange={(e) => setSubtractedFilters(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      この監視だけ別トピックに分ける（任意）
                    </label>
                    <input
                      type="text"
                      placeholder="空欄なら自分専用トピックにまとめて通知"
                      value={notificationTopic}
                      onChange={(e) => setNotificationTopic(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      指定しても「{userTopic}-」の配下になるため、他のユーザーの通知とは混ざりません。
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* フッター */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                <span>要素を選び直す</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-xl shadow-sm shadow-indigo-200 flex items-center space-x-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submitting ? '登録中...' : '監視を登録する（OK）'}</span>
                </button>
              </div>
            </div>
          </form>
        )}
      </div>

      {/* Step 2: ビジュアル要素ピッカーモーダル */}
      <VisualElementPickerModal
        isOpen={isPickerOpen}
        targetUrl={url}
        onClose={() => setIsPickerOpen(false)}
        onSelectXPath={handlePickerSelect}
      />
    </div>
  );
};
