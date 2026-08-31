import React, { useEffect, useState } from 'react';
import {
  X,
  Clock,
  Target,
  ShieldAlert,
  FileText,
  Bell,
  Save,
  Link2,
  MousePointerClick,
} from 'lucide-react';
import { WatchModel } from '../types';
import { VisualElementPickerModal } from './VisualElementPickerModal';

/** 保存時にそのまま再チェックまで走らせるかどうか */
export interface EditWatchOptions {
  recheck: boolean;
}

interface EditWatchModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  /** ログイン中ユーザー専用の ntfy トピック。この配下にしか通知先を作れない。 */
  userTopic: string;
  onClose: () => void;
  onSubmit: (id: string, data: Partial<WatchModel>, options: EditWatchOptions) => Promise<void>;
}

const INTERVAL_PRESETS = [
  { label: '5分', value: 5 },
  { label: '10分', value: 10 },
  { label: '30分', value: 30 },
  { label: '1時間', value: 60 },
  { label: '6時間', value: 360 },
  { label: '24時間', value: 1440 },
];

// 保存されている通知トピックは `<ユーザートピック>-<この監視の識別子>` の形。
// 画面では登録時と同じく後ろの識別子だけを扱う。
const suffixOf = (topic: string, userTopic: string) =>
  userTopic && topic.startsWith(`${userTopic}-`) ? topic.slice(userTopic.length + 1) : '';

const toLines = (value: string) =>
  value.split('\n').map((s) => s.trim()).filter(Boolean);

const sameLines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((line, i) => line === b[i]);

export const EditWatchModal: React.FC<EditWatchModalProps> = ({
  watch,
  isOpen,
  userTopic,
  onClose,
  onSubmit,
}) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [includeFilters, setIncludeFilters] = useState('');
  const [subtractedFilters, setSubtractedFilters] = useState('');
  const [topicSuffix, setTopicSuffix] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに、その監視の現在の設定値を読み込む
  useEffect(() => {
    if (!isOpen || !watch) return;
    setUrl(watch.url);
    setTitle(watch.title);
    setIntervalMinutes(watch.checkIntervalMinutes || 60);
    setIncludeFilters(watch.includeFilters.join('\n'));
    setSubtractedFilters(watch.subtractedFilters.join('\n'));
    setTopicSuffix(suffixOf(watch.notificationTopic || '', userTopic));
    setIsPickerOpen(false);
    setError(null);
  }, [isOpen, watch, userTopic]);

  if (!isOpen || !watch) return null;

  // 登録時と同じ要領で、監視する／除外する要素を画面から選び直す
  const handlePickerSelect = (xpath: string, _texts: string[], isExclude: boolean) => {
    setIsPickerOpen(false);
    if (!xpath) return;
    if (isExclude) {
      setSubtractedFilters((prev) => (prev ? `${prev}\n${xpath}` : xpath));
    } else {
      setIncludeFilters(xpath);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const nextUrl = url.trim();
    if (!nextUrl) {
      setError('URLを入力してください');
      return;
    }
    if (!title.trim()) {
      setError('表示名を入力してください');
      return;
    }

    const nextInclude = toLines(includeFilters);
    const nextSubtracted = toLines(subtractedFilters);

    // 取得内容が変わりうる設定を触ったときは、保存後にそのまま取り直す。
    // 履歴は残るので、新しい設定での取得結果は前回スナップショットとの差分として出る。
    // （偶然まったく同じ内容だった場合はスナップショットが増えず、差分なしになる）
    const recheck =
      nextUrl !== watch.url ||
      !sameLines(nextInclude, watch.includeFilters) ||
      !sameLines(nextSubtracted, watch.subtractedFilters);

    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(
        watch.id,
        {
          url: nextUrl,
          title: title.trim(),
          checkIntervalMinutes: Math.max(1, Math.floor(intervalMinutes) || 0),
          includeFilters: nextInclude,
          subtractedFilters: nextSubtracted,
          // ユーザートピックが取れていないときは通知先に触らない（空トピックにしないため）
          ...(userTopic ? { notificationTopic: topicSuffix.trim() || userTopic } : {}),
        },
        { recheck }
      );
      onClose();
    } catch (err: any) {
      setError(err.message || '設定の更新に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  const urlChanged = url.trim() !== watch.url;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* ヘッダー */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-none">設定を変更</h2>
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

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* 監視対象URL */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center">
              <Link2 className="w-3.5 h-3.5 mr-1 text-slate-400" />
              監視対象のURL
            </label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass}
            />
            {urlChanged && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 leading-relaxed">
                保存すると新しいURLで取り直します。これまでの履歴は残るので、内容が変わっていれば
                その差分が未読として表示されます（同じ内容なら差分なしになります）。
              </p>
            )}
          </div>

          {/* 表示名 */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center">
              <FileText className="w-3.5 h-3.5 mr-1 text-slate-400" />
              表示名
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* チェック間隔 */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
              チェック間隔
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
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="w-24 flex-shrink-0">
                <input
                  type="number"
                  min={1}
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                分ごとにチェック
              </span>
            </div>
          </div>

          {/* 監視・除外セレクタ */}
          <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 rounded-xl">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 flex items-center">
                <Target className="w-3.5 h-3.5 mr-1 text-slate-400" />
                特定要素の監視・除外設定（XPath / CSS Selector）
              </p>
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                disabled={!url.trim()}
                className="px-2.5 py-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 disabled:opacity-40 rounded-lg transition flex items-center gap-1 flex-shrink-0"
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                画面から選ぶ
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                監視する要素（改行区切り）
              </label>
              <textarea
                rows={2}
                placeholder="//*[@id='...']"
                value={includeFilters}
                onChange={(e) => setIncludeFilters(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                除外する要素（改行区切り）
              </label>
              <textarea
                rows={2}
                placeholder=".advertisement, .timestamp"
                value={subtractedFilters}
                onChange={(e) => setSubtractedFilters(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>

          {/* 通知先 */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1 flex items-center">
              <Bell className="w-3.5 h-3.5 mr-1 text-indigo-500" />
              この監視だけ別トピックに分ける（任意）
            </label>
            <input
              type="text"
              placeholder="空欄なら自分専用トピックにまとめて通知"
              value={topicSuffix}
              onChange={(e) => setTopicSuffix(e.target.value)}
              className={`${inputClass} font-mono`}
            />
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
              通知先: {topicSuffix.trim() ? `${userTopic}-${topicSuffix.trim()}` : userTopic}
            </p>
          </div>

          {/* フッター */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
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
              className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-xl shadow-sm shadow-indigo-200 dark:shadow-none flex items-center space-x-1.5"
            >
              <Save className="w-4 h-4" />
              <span>{submitting ? '保存中...' : '変更を保存する'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* 要素の選び直し（登録時と同じピッカー） */}
      <VisualElementPickerModal
        isOpen={isPickerOpen}
        targetUrl={url.trim()}
        onClose={() => setIsPickerOpen(false)}
        onSelectXPath={handlePickerSelect}
      />
    </div>
  );
};
