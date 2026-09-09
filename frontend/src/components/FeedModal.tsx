import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Link2, Loader2, RefreshCw, Send, Undo2, X } from 'lucide-react';
import {
  FeedCandidateWithState,
  FeedConfig,
  FeedScanResult,
  PowerdownerUser,
  WatchModel,
} from '../types';
import { api } from '../api';
import { Modal } from './Modal';
import { inputClass, selectClass, submitButtonClass } from '../ui';

// 監視の増分から作った投入候補を確認して、PowerDowner へ送る画面。
//
// 想定している流れは 2 段構え:
//   1. 登録直後は「全件を洗い出す」でページに並んでいるものを丸ごと出し、
//      対象と対象外に振り分ける
//   2. 決まったら「確認なしで投入する」を立てて任せる
//
// 区分けは対象／対象外の 2 つだけ。「今は落とさないが後で落とすかもしれない」は
// 実際にはほぼ起きないので、中間状態を置いて迷いどころを増やさない。
// 振り分けを間違えても、対象外からいつでも戻せる。

interface FeedModalProps {
  watch: WatchModel | null;
  isOpen: boolean;
  onClose: () => void;
}

const SCAN_MESSAGE: Record<FeedScanResult['status'], string> = {
  'no-selector': '監視する要素が指定されていないため、どこを 1 件とみなすか決められません。',
  initialized: '初回なので増分はありません。「全件を洗い出す」でいま並んでいるものを出せます。',
  unchanged: '前回の取り込みから増分はありません。',
  scanned: '',
  collected: '',
};

/** PowerDowner の台帳から見た状態。既に手元にあるものを投入対象から外すために使う */
const STATE_BADGE: Record<'skip' | 'merge', { label: string; className: string }> = {
  skip: { label: '所持済み', className: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  merge: { label: '取得中', className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300' },
};

/** PowerDowner が元の文字列から読み取った巻数 */
const volumeLabel = (candidate: FeedCandidateWithState): string | null => {
  const pd = candidate.powerdowner;
  if (!pd || pd.volumeFrom === null) return null;
  return pd.volumeFrom === pd.volumeTo ? `第${pd.volumeFrom}巻` : `第${pd.volumeFrom}-${pd.volumeTo}巻`;
};

export const FeedModal: React.FC<FeedModalProps> = ({ watch, isOpen, onClose }) => {
  const [config, setConfig] = useState<FeedConfig | null>(null);
  const [users, setUsers] = useState<PowerdownerUser[]>([]);
  const [candidates, setCandidates] = useState<FeedCandidateWithState[]>([]);
  const [excluded, setExcluded] = useState<FeedCandidateWithState[]>([]);
  const [busy, setBusy] = useState<'load' | 'save' | 'scan' | 'send' | 'exclude' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [excludedOpen, setExcludedOpen] = useState(false);
  // 候補が 0 件だったときに、何が取れていたのかを見せるための控え
  const [samples, setSamples] = useState<FeedScanResult['samples']>(undefined);

  /**
   * initial はモーダルを開いた最初の 1 回だけ true。
   * ここで設定の開閉を決めているので、毎回の読み直しで上書きすると
   * 下のボタンを押しただけで設定が開いてしまう。
   */
  const load = useCallback(async (watchId: string, initial = false) => {
    setBusy('load');
    setError(null);
    try {
      const [loadedConfig, pending, dismissed] = await Promise.all([
        api.getFeedConfig(watchId),
        api.listFeedCandidates('pending', watchId),
        api.listFeedCandidates('dismissed', watchId),
      ]);
      setConfig(loadedConfig);
      setCandidates(pending);
      setExcluded(dismissed);
      // 投入先が決まっていない間は設定を開いておく
      if (initial) setSettingsOpen(loadedConfig.userId === null);
    } catch (err: any) {
      setError(err.message || '読み込みに失敗しました');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !watch) return;
    setNotice(null);
    setSamples(undefined);
    setExcludedOpen(false);
    load(watch.id, true);
    // PowerDowner が止まっていても画面は使えるようにする (手入力に落とす)
    api.listPowerdownerUsers().then(setUsers).catch(() => setUsers([]));
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
  const working = busy !== null;
  const currentUser = users.find((u) => u.id === config.userId) ?? null;

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

  const handleScan = async (all: boolean) => {
    setBusy('scan');
    setError(null);
    setNotice(null);
    try {
      const result = await api.scanFeed(watch.id, all);
      // 「増えた行」と「取れた要素」を添えるのは、候補が 0 件だったときに
      // 差分が無かったのかセレクタが外れているのかを切り分けるため
      setNotice(
        result.status === 'scanned'
          ? `${result.added} 件を追加 (増えた行 ${result.addedLines ?? 0} / 取れた要素 ${result.extracted ?? 0})`
          : result.status === 'collected'
            ? `ページ全体から ${result.added} 件を候補にしました (取れた要素 ${result.extracted ?? 0})`
            : SCAN_MESSAGE[result.status]
      );
      setSamples(result.samples);
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
      // 対象に残っているものを全部送る。落としたくないものは × で対象外にしておく
      const summary = await api.sendFeedCandidates(candidates.map((c) => c.id));
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

  const handleExclude = async (ids: string[]) => {
    setBusy('exclude');
    setError(null);
    setNotice(null);
    try {
      const result = await api.excludeFeedCandidates(ids);
      // 巻数を読めないものは台帳の重なり判定に参加できないので登録されない。
      // 黙って消えると「登録したのに次も出てくる」に見えるため件数を出す
      const parts = [`${result.excluded} 件を対象外にしました`];
      if (result.skipped > 0) parts.push(`${result.skipped} 件は巻数を読めず所持登録できませんでした`);
      setNotice(parts.join('。'));
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '対象外にできませんでした');
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (id: string) => {
    setBusy('restore');
    setError(null);
    try {
      await api.restoreFeedCandidate(id);
      await load(watch.id);
    } catch (err: any) {
      setError(err.message || '戻せませんでした');
    } finally {
      setBusy(null);
    }
  };

  const labelClass = 'block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1';
  const subButton =
    'px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition disabled:opacity-40';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="ダウンロード投入" subtitle={watch.title} error={error}>
      <div className="p-5 pt-4 space-y-3 overflow-y-auto">
        {/* --- 設定 (普段は畳んでおく) --- */}
        <section className="border border-slate-200 dark:border-slate-700 rounded-lg">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${settingsOpen ? '' : '-rotate-90'}`}
            />
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">投入設定</span>
            <span className="ml-auto text-[11px] text-slate-400 truncate">
              {currentUser?.name ?? (config.userId === null ? '投入先が未設定' : `ID ${config.userId}`)}
              {config.autoSend ? ' · 自動' : ''}
            </span>
          </button>

          {settingsOpen && (
            <div className="px-3 pb-3 space-y-2.5 border-t border-slate-100 dark:border-slate-800 pt-2.5">
              <div>
                <label className={labelClass}>投入先 (PowerDowner のユーザー)</label>
                {users.length > 0 ? (
                  <select
                    value={config.userId ?? ''}
                    onChange={(e) => patch({ userId: e.target.value === '' ? null : Number(e.target.value) })}
                    className={selectClass}
                  >
                    <option value="">選択してください</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                        {user.defaultDir ? ` (${user.defaultDir})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  // PowerDowner が止まっていると一覧を取れない。手入力に落とす
                  <input
                    type="number"
                    value={config.userId ?? ''}
                    onChange={(e) => patch({ userId: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="ユーザー ID (一覧を取得できませんでした)"
                    className={inputClass}
                  />
                )}
              </div>

              {/* 監視 1 件 = 1 作品。行に載っているのは巻数だけというサイトが多いので、
                  作者とタイトルはここで 1 回決めてしまう */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>作者</label>
                  <input
                    type="text"
                    value={config.author ?? ''}
                    onChange={(e) => patch({ author: e.target.value || null })}
                    placeholder="ファイル名に付ける作者名"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>作品タイトル</label>
                  <input
                    type="text"
                    value={config.title ?? ''}
                    onChange={(e) => patch({ title: e.target.value || null })}
                    placeholder={watch.title}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>保存先 (空なら投入先ユーザーの既定)</label>
                <input
                  type="text"
                  value={config.destDir ?? ''}
                  onChange={(e) => patch({ destDir: e.target.value || null })}
                  placeholder={currentUser?.defaultDir ?? '空欄で既定'}
                  className={inputClass}
                />
              </div>

              {/* 取り込み自体は監視のチェックに付いて自動で走るので、スイッチは無い。
                  ここで決めるのは「人が見るか、そのまま送るか」だけ */}
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={config.autoSend}
                  onChange={(e) => patch({ autoSend: e.target.checked })}
                  className="w-3.5 h-3.5 rounded accent-indigo-600"
                />
                次の更新分からは確認なしで投入する
              </label>

              <div className="flex justify-end">
                <button type="button" onClick={handleSave} disabled={working} className={subButton}>
                  {busy === 'save' ? '保存中...' : '設定を保存'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* --- 取り込み --- */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => handleScan(true)} disabled={working} className={subButton}>
            全件を洗い出す
          </button>
          <button
            type="button"
            onClick={() => handleScan(false)}
            disabled={working}
            className={`${subButton} flex items-center gap-1`}
          >
            <RefreshCw className={`w-3 h-3 ${busy === 'scan' ? 'animate-spin' : ''}`} />
            増分を取り込む
          </button>
          {notice && (
            <p className="flex-1 min-w-0 text-[11px] text-indigo-600 dark:text-indigo-400 leading-tight">
              {notice}
            </p>
          )}
        </div>

        {/* --- 対象 --- */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              ダウンロード対象 ({candidates.length})
            </h3>
            {candidates.length > 0 && (
              <span className="text-[11px] text-slate-400">× で対象外へ</span>
            )}
          </div>

          {candidates.length === 0 ? (
            samples && samples.length > 0 ? (
              // 要素は取れているのに候補にならなかったとき。
              // セレクタが外れているのか、リンクが取れていないのかをここで切り分ける
              <div className="space-y-1">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  取れた要素にリンクがありませんでした。選んだ範囲に <code>&lt;a href&gt;</code> が
                  入っていないか、リンクが別の場所にあります。
                </p>
                {samples.map((sample, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-1.5 bg-slate-50 dark:bg-slate-800/60 rounded text-[11px]"
                  >
                    <span
                      className={`flex-shrink-0 px-1.5 rounded font-medium ${
                        sample.urls > 0
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300'
                      }`}
                    >
                      {sample.urls}
                    </span>
                    <span className="min-w-0 break-all text-slate-600 dark:text-slate-300">
                      {sample.text || '(テキストなし)'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-5 text-center text-[11px] text-slate-400">
                「全件を洗い出す」を押すと、いまページにあるものが並びます。
              </p>
            )
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {candidates.map((candidate) => {
                const pd = candidate.powerdowner;
                const badge = pd && pd.state !== 'new' ? STATE_BADGE[pd.state] : null;
                const volume = volumeLabel(candidate);
                // 巻数を読めていないと「もう持っているか」の判定に参加できないので目立たせる
                const unreadableVolume = !!pd && pd.volumeFrom === null;
                return (
                  <li
                    key={candidate.id}
                    className="flex items-start gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800/60 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-tight text-slate-800 dark:text-slate-100 break-all">
                        {candidate.meta.title ?? candidate.meta.rawText}
                      </p>
                      <p className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="flex items-center gap-0.5">
                          <Link2 className="w-2.5 h-2.5" />
                          {candidate.urls.length}
                        </span>
                        {volume && <span>{volume}</span>}
                        {unreadableVolume && (
                          <span
                            className="text-rose-500 dark:text-rose-400"
                            title="巻数を読み取れないと、既に持っているかの判定に参加できません"
                          >
                            巻数不明
                          </span>
                        )}
                        {candidate.meta.author && <span className="truncate">{candidate.meta.author}</span>}
                      </p>
                    </div>
                    {badge && (
                      <span
                        className={`flex-shrink-0 mt-0.5 px-1.5 text-[10px] font-medium rounded ${badge.className}`}
                        title={pd?.reason ?? undefined}
                      >
                        {badge.label}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleExclude([candidate.id])}
                      disabled={working}
                      aria-label="対象外にする"
                      title="対象外にする (あとで戻せます)"
                      className="flex-shrink-0 p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded transition disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* --- 対象外 (振り分けを間違えたら戻せる) --- */}
        {excluded.length > 0 && (
          <section className="border-t border-slate-100 dark:border-slate-800 pt-2">
            <button
              type="button"
              onClick={() => setExcludedOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 text-left"
            >
              <ChevronDown
                className={`w-3 h-3 text-slate-400 transition-transform ${excludedOpen ? '' : '-rotate-90'}`}
              />
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                対象外 ({excluded.length})
              </span>
            </button>

            {excludedOpen && (
              <ul className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
                {excluded.map((candidate) => (
                  <li
                    key={candidate.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-800/60 rounded"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400 break-all">
                        {candidate.meta.title ?? candidate.meta.rawText}
                      </p>
                      {volumeLabel(candidate) && (
                        <p className="text-[10px] text-slate-400">{volumeLabel(candidate)}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(candidate.id)}
                      disabled={working}
                      className={`${subButton} flex items-center gap-1 flex-shrink-0`}
                    >
                      <Undo2 className="w-3 h-3" />
                      戻す
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${subButton} mr-auto`}>
            閉じる
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={working || candidates.length === 0}
            className={`${submitButtonClass} !px-3 !py-1.5 !text-xs`}
          >
            {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {candidates.length} 件を投入
          </button>
        </div>
      </div>
    </Modal>
  );
};
