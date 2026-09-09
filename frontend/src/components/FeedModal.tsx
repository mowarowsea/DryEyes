import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { FeedCandidate, FeedConfig, FeedScanResult, WatchModel } from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { cancelButtonClass, inputClass, monoInputClass, submitButtonClass } from '../ui';

// 監視の増分から作った投入候補を確認して、PowerDowner へ送る画面。
//
// 設定・取り込み・候補を 1 つのモーダルに並べているのは、抽出ルール (正規表現) の
// 当たり外れを見ながらその場で直せるようにするため。当面は自動投入しないので、
// ここが「人が確認する」場所になる (ARCHITECTURE.md 5 章)。

interface FeedModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
}

// 名前付きキャプチャがそのまま PowerDowner へ渡るフィールドになる
const PATTERN_EXAMPLE = String.raw`^\[(?<author>[^\]]+)\]\s*(?<title>.+?)\s*第(?<volume>\d+)巻`;

const SCAN_MESSAGE: Record<FeedScanResult['status'], string> = {
  disabled: 'この監視は投入が無効です。上の「候補を作る」を有効にしてください。',
  'no-selector': '監視する要素が指定されていないため、どこを 1 件とみなすか決められません。',
  initialized: '初回なので、いま並んでいるものは候補にしませんでした。次の更新分から拾います。',
  unchanged: '前回の取り込みから増分はありません。',
  scanned: '',
};

export const FeedModal: React.FC<FeedModalProps> = ({ watch, isOpen, onClose }) => {
  const [config, setConfig] = useState<FeedConfig | null>(null);
  const [candidates, setCandidates] = useState<FeedCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'load' | 'save' | 'scan' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (watchId: string) => {
    setBusy('load');
    setError(null);
    try {
      const [loadedConfig, loadedCandidates] = await Promise.all([
        api.getFeedConfig(watchId),
        api.listFeedCandidates('pending', watchId),
      ]);
      setConfig(loadedConfig);
      setCandidates(loadedCandidates);
      setSelected(new Set(loadedCandidates.map((c) => c.id)));
    } catch (err: any) {
      setError(err.message || '読み込みに失敗しました');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !watch) return;
    setNotice(null);
    load(watch.id);
  }, [isOpen, watch, load]);

  if (!isOpen || !watch || !config) {
    return (
      <Modal isOpen={isOpen && !!watch} onClose={onClose} title="ダウンロード投入" subtitle={watch?.title}>
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      </Modal>
    );
  }

  const patch = (next: Partial<FeedConfig>) => setConfig({ ...config, ...next });

  const handleSave = async () => {
    setBusy('save');
    setError(null);
    try {
      setConfig(await api.saveFeedConfig(watch.id, config));
      setNotice('設定を保存しました');
    } catch (err: any) {
      setError(err.message || '設定の保存に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleScan = async () => {
    setBusy('scan');
    setError(null);
    setNotice(null);
    try {
      const result = await api.scanFeed(watch.id);
      // 「増えた行」と「取れた要素」を添えるのは、候補が 0 件だったときに
      // 差分が無かったのか、セレクタが外れているのかを切り分けるため
      setNotice(
        result.status === 'scanned'
          ? `${result.added} 件の候補を追加しました (増えた行 ${result.addedLines ?? 0} / 取れた要素 ${result.extracted ?? 0})`
          : SCAN_MESSAGE[result.status]
      );
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '候補の作成に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    setBusy('send');
    setError(null);
    setNotice(null);
    try {
      const summary = await api.sendFeedCandidates([...selected]);
      const parts = [`${summary.sent} 件を投入しました`];
      if (summary.ignored.length > 0) parts.push(`${summary.ignored.length} 件は送りませんでした`);
      if (summary.errors.length > 0) parts.push(summary.errors.map((e) => e.message).join(' / '));
      setNotice(parts.join('。'));
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '投入に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await api.dismissFeedCandidate(id);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      setError(err.message || '見送りに失敗しました');
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const labelClass = 'block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1';
  const working = busy !== null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ダウンロード投入" subtitle={watch.title} error={error}>
      <div className="space-y-5">
        {/* --- 投入設定 --- */}
        <section className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            候補を作る
          </label>

          <div>
            <label className={labelClass}>PowerDowner のユーザー ID</label>
            <input
              type="number"
              value={config.userId ?? ''}
              onChange={(e) => patch({ userId: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="投入先のユーザー"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>保存先 (空なら PowerDowner のユーザー既定)</label>
            <input
              type="text"
              value={config.destDir ?? ''}
              onChange={(e) => patch({ destDir: e.target.value || null })}
              placeholder={'D:\\manga'}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>作者・タイトル・巻数の取り出し方 (正規表現・省略可)</label>
            <input
              type="text"
              value={config.itemPattern ?? ''}
              onChange={(e) => patch({ itemPattern: e.target.value || null })}
              placeholder={PATTERN_EXAMPLE}
              className={monoInputClass}
            />
            <p className="mt-1 text-[11px] text-slate-400 leading-relaxed">
              名前付きキャプチャ <code>(?&lt;author&gt;)</code> <code>(?&lt;title&gt;)</code>{' '}
              <code>(?&lt;volume&gt;)</code> がそのまま渡ります。外れても元の文字列は送るので、
              あとから直せます。
            </p>
          </div>

          <div className="flex justify-end">
            <button onClick={handleSave} disabled={working} className={cancelButtonClass}>
              {busy === 'save' ? '保存中...' : '設定を保存'}
            </button>
          </div>
        </section>

        {/* --- 取り込み --- */}
        <section className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              増えた行を拾い、ページを開いてリンクを取り出します。
            </p>
            <button
              onClick={handleScan}
              disabled={working}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'scan' ? 'animate-spin' : ''}`} />
              増分を取り込む
            </button>
          </div>
          {notice && (
            <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-400 leading-relaxed">{notice}</p>
          )}
        </section>

        {/* --- 候補 --- */}
        <section className="pt-4 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
            投入待ち ({candidates.length})
          </h3>

          {candidates.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">
              候補はありません。更新が検知されてから「増分を取り込む」を押してください。
            </p>
          ) : (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex items-start gap-2 p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    className="mt-0.5 w-4 h-4 rounded accent-indigo-600 flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-800 dark:text-slate-100 break-all">
                      {candidate.meta.title ?? candidate.meta.rawText}
                    </p>
                    {/* 抽出できた項目を出す。ここが空なら正規表現が外れている */}
                    {(candidate.meta.author || candidate.meta.volume) && (
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {[candidate.meta.author, candidate.meta.volume && `第${candidate.meta.volume}巻`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                      <Link2 className="w-3 h-3" />
                      ミラー {candidate.urls.length} 件
                    </p>
                  </div>
                  <button
                    onClick={() => handleDismiss(candidate.id)}
                    aria-label="見送る"
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded transition flex-shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={cancelButtonClass}>
            閉じる
          </button>
          <button
            onClick={handleSend}
            disabled={working || selected.size === 0}
            className={submitButtonClass}
          >
            {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {selected.size} 件を投入
          </button>
        </div>
      </div>
    </Modal>
  );
};
