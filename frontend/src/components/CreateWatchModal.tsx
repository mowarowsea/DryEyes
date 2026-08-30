import React, { useState } from 'react';
import { X, ChevronDown, ChevronUp, Clock, Target, ShieldAlert, Bell, MousePointerClick } from 'lucide-react';
import { CreateWatchDto } from '../types';
import { VisualElementPickerModal } from './VisualElementPickerModal';

interface CreateWatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateWatchDto) => Promise<void>;
  defaultTopic: string;
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
  defaultTopic,
}) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(10);
  const [notificationTopic, setNotificationTopic] = useState(defaultTopic);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [includeFilters, setIncludeFilters] = useState('');
  const [subtractedFilters, setSubtractedFilters] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      setError('URLを入力してください');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        url: url.trim(),
        title: title.trim() || undefined,
        fetchBackend: 'html_playwright',
        checkIntervalMinutes: intervalMinutes,
        notificationTopic: notificationTopic.trim() || defaultTopic,
        includeFilters: includeFilters.split('\n').map((s) => s.trim()).filter(Boolean),
        subtractedFilters: subtractedFilters.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      // 成功時リセットして閉じる
      setUrl('');
      setTitle('');
      setIncludeFilters('');
      setSubtractedFilters('');
      setShowAdvanced(false);
      onClose();
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
          <h2 className="text-base font-bold text-slate-900">新しい監視対象を登録</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* URL */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">
                監視対象のURL <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                disabled={!url}
                onClick={() => setIsPickerOpen(true)}
                className="inline-flex items-center text-xs text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-40 transition"
              >
                <MousePointerClick className="w-3.5 h-3.5 mr-1" />
                画面から要素をタップ選択
              </button>
            </div>
            <input
              type="url"
              required
              placeholder="https://example.com/item/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
            />
          </div>

          {/* タイトル */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              表示名（任意）
            </label>
            <input
              type="text"
              placeholder="例: ○○商品の在庫状況"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
            />
          </div>

          {/* 監視頻度 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
              チェック頻度
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

          {/* 通知トピック */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center">
              <Bell className="w-3.5 h-3.5 mr-1 text-slate-400" />
              ntfy 通知トピック
            </label>
            <input
              type="text"
              placeholder="dryeyes"
              value={notificationTopic}
              onChange={(e) => setNotificationTopic(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              スマートフォン等のntfyアプリで購読するトピック名です。
            </p>
          </div>

          {/* 詳細設定アコーディオン */}
          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-xs font-medium text-slate-600 hover:text-slate-900 py-1"
            >
              <span className="flex items-center">
                <Target className="w-3.5 h-3.5 mr-1 text-slate-400" />
                特定要素の監視・除外設定（高度な設定）
              </span>
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showAdvanced && (
              <div className="space-y-3 mt-3 p-3 bg-slate-50 border border-slate-200/80 rounded-xl animate-fadeIn">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    監視する要素（CSS Selector または XPath、改行区切り）
                  </label>
                  <textarea
                    rows={2}
                    placeholder=".price, #in-stock"
                    value={includeFilters}
                    onChange={(e) => setIncludeFilters(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    指定した要素の中身だけを監視します（空欄の場合はページ全体）。
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    除外する要素（広告・タイムスタンプなど、改行区切り）
                  </label>
                  <textarea
                    rows={2}
                    placeholder=".advertisement, .timestamp, footer"
                    value={subtractedFilters}
                    onChange={(e) => setSubtractedFilters(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    差分検出から除外したい要素を指定します。
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* フッター */}
          <div className="pt-2 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-xl shadow-sm shadow-indigo-200"
            >
              {submitting ? '登録中...' : '監視を開始する'}
            </button>
          </div>
        </form>
      </div>

      {/* ビジュアル要素ピッカーモーダル */}
      <VisualElementPickerModal
        isOpen={isPickerOpen}
        targetUrl={url}
        onClose={() => setIsPickerOpen(false)}
        onSelectXPath={(xpath, isExclude) => {
          setShowAdvanced(true);
          if (isExclude) {
            setSubtractedFilters((prev) => (prev ? `${prev}\n${xpath}` : xpath));
          } else {
            setIncludeFilters((prev) => (prev ? `${prev}\n${xpath}` : xpath));
          }
        }}
      />
    </div>
  );
};
