import React, { useEffect, useState } from 'react';
import {
  Clock,
  Target,
  FileText,
  Bell,
  Save,
  Link2,
  MousePointerClick,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';
import { WatchModel } from '../types';
import { VisualElementPickerModal } from './VisualElementPickerModal';
import { Modal } from './Modal';
import { IntervalSelect } from './IntervalPicker';
import { cancelButtonClass, inputClass, monoInputClass, submitButtonClass } from '../ui';

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
  // XPath と通知トピックは手で直すことがほとんど無いので、既定では畳んでおく
  const [showDetails, setShowDetails] = useState(false);
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
    setShowDetails(false);
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

  const urlChanged = url.trim() !== watch.url;

  // 詳細を畳んだままでも、いま何を見ている設定なのかは分かるようにしておく
  const includeCount = toLines(includeFilters).length;
  const subtractedCount = toLines(subtractedFilters).length;
  const detailSummary = [
    includeCount ? `監視する要素 ${includeCount}件` : 'ページ全体',
    subtractedCount ? `除外 ${subtractedCount}件` : null,
    topicSuffix.trim() ? `通知先 -${topicSuffix.trim()}` : null,
  ]
    .filter(Boolean)
    .join(' ・ ');

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="設定を変更" subtitle={watch.title} error={error}>
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
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

          {/* 監視する場所の選び直し。ここが一番よく使う操作なので目立たせる */}
          <div>
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              disabled={!url.trim()}
              className="w-full px-4 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100 transition rounded-xl shadow-sm shadow-indigo-200 dark:shadow-none flex items-center justify-center gap-1.5"
            >
              <MousePointerClick className="w-4 h-4" />
              画面から選ぶ
            </button>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 text-center">
              ページを開いて、監視したい部分をタップで選び直せます
            </p>
          </div>

          {/* チェック間隔 */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
              チェック間隔
            </label>
            <IntervalSelect value={intervalMinutes} onChange={setIntervalMinutes} />
          </div>

          {/* 詳細（XPath / 別トピック）。ふだんは畳んでおく */}
          <div className="border border-slate-200/80 dark:border-slate-700 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              aria-expanded={showDetails}
              className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
            >
              <ChevronRight
                className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform ${
                  showDetails ? 'rotate-90' : ''
                }`}
              />
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex-shrink-0">
                詳細
              </span>
              {!showDetails && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate ml-auto">
                  {detailSummary}
                </span>
              )}
            </button>

            {showDetails && (
              <div className="px-3 pb-3 pt-3 space-y-3 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1 flex items-center">
                    <Target className="w-3.5 h-3.5 mr-1 text-slate-400" />
                    監視する要素（XPath / CSS Selector・改行区切り）
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
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    除外する要素（改行区切り）
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
                  <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1 flex items-center">
                    <Bell className="w-3.5 h-3.5 mr-1 text-slate-400" />
                    この監視だけ別トピックに分ける（任意）
                  </label>
                  <input
                    type="text"
                    placeholder="空欄なら自分専用トピックにまとめて通知"
                    value={topicSuffix}
                    onChange={(e) => setTopicSuffix(e.target.value)}
                    className={monoInputClass}
                  />
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 truncate">
                    通知先: {topicSuffix.trim() ? `${userTopic}-${topicSuffix.trim()}` : userTopic}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* フッター */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className={cancelButtonClass}>
              キャンセル
            </button>
            <button type="submit" disabled={submitting} className={submitButtonClass}>
              <Save className="w-4 h-4" />
              <span>{submitting ? '保存中...' : '変更を保存する'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* 要素の選び直し（登録時と同じピッカー） */}
      <VisualElementPickerModal
        isOpen={isPickerOpen}
        targetUrl={url.trim()}
        onClose={() => setIsPickerOpen(false)}
        onSelectXPath={handlePickerSelect}
      />
    </>
  );
};
