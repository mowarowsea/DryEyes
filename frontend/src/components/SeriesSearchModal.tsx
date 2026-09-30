import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, MousePointerClick, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { Modal } from './Modal';
import { FindIntent } from '../deepLink';
import { guessSeriesQuery } from '../seriesQuery';
import { SiteTemplate, suggestSiteTemplate } from '../siteTemplate';
import { workKeyOf } from '../watchGroup';
import { FeedConfig, SearchSite, SiteSearchResult, WatchModel } from '../types';
import { cancelButtonClass, inputClass, monoInputClass, submitButtonClass } from '../ui';

// pinax の「続きを探す」から開く。台帳のアップロードサイトを作品名で横断検索し、
// 選んだ作品ページをまとめて監視に登録する。
//
// 見張る場所と投入設定は、同じサイトの既存の監視 (見本) から引き継ぐ。
// 見本がまだ無いサイトは要素ピッカーで 1 件登録してもらう — それが次からの見本になる。

interface SeriesSearchModalProps {
  intent: FindIntent | null;
  isOpen: boolean;
  watches: WatchModel[];
  onClose: () => void;
  /** 見本の無いサイトを、URL 入りの登録モーダル (要素ピッカー) で開く */
  onOpenCreate: (url: string) => void;
  /** 登録が済んだら一覧を取り直す */
  onRegistered: () => void;
  onNotify: (message: string) => void;
}

type HitKind = 'main' | 'related';

interface HitRow {
  url: string;
  text: string;
  siteLabel: string;
  kind: HitKind;
  watchedId: string | null;
  template: SiteTemplate | null;
}

/** 題名がそのまま一致するものが本編。題名を含むだけのもの (外伝・画集・アンソロジー) は関連 */
function kindOf(hitText: string, query: string): HitKind {
  return workKeyOf(guessSeriesQuery(hitText)) === workKeyOf(query) ? 'main' : 'related';
}

const rowsOf = (results: SiteSearchResult[], query: string, watches: WatchModel[]): HitRow[] =>
  results.flatMap((r) =>
    r.hits.map((hit) => ({
      url: hit.url,
      text: hit.text,
      siteLabel: r.label,
      kind: kindOf(hit.text, query),
      watchedId: hit.watchedId,
      template: suggestSiteTemplate(hit.url, watches),
    }))
  );

export const SeriesSearchModal: React.FC<SeriesSearchModalProps> = ({
  intent,
  isOpen,
  watches,
  onClose,
  onOpenCreate,
  onRegistered,
  onNotify,
}) => {
  const [query, setQuery] = useState('');
  // 検索したときの作品名。欄を書き換えても、結果の本編/関連の分け方は検索した名前で決める
  const [searchedQuery, setSearchedQuery] = useState('');
  const [results, setResults] = useState<SiteSearchResult[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const author = intent?.author ?? null;

  const rows = useMemo(
    () => (results ? rowsOf(results, searchedQuery, watches) : []),
    [results, searchedQuery, watches]
  );

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setError('作品名を入れてください');
        return;
      }
      setSearching(true);
      setError(null);
      try {
        const found = await api.searchSeriesSites(trimmed);
        setResults(found);
        setSearchedQuery(trimmed);
        // 本編で、見本があって、まだ監視していないものだけ最初から選んでおく。
        // 関連は人が選ぶ (欲しい外伝もあれば、要らない画集もある)
        setChecked(
          new Set(
            rowsOf(found, trimmed, watches)
              .filter((r) => r.kind === 'main' && !r.watchedId && r.template)
              .map((r) => r.url)
          )
        );
      } catch (err: any) {
        setError(err.message || '検索に失敗しました');
      } finally {
        setSearching(false);
      }
    },
    [watches]
  );

  // pinax から開かれたら、その作品名ですぐ検索する
  useEffect(() => {
    if (!isOpen || !intent) return;
    setQuery(intent.title);
    setResults(null);
    runSearch(intent.title);
    // watches が 30 秒ごとに更新されるたびに検索し直さないよう、開いた時だけ走らせる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, intent]);

  const toggle = (url: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  const register = async () => {
    const targets = rows.filter((r) => checked.has(r.url) && r.template && !r.watchedId);
    if (targets.length === 0) return;

    setError(null);
    const sampleFeeds = new Map<string, FeedConfig>();
    let registered = 0;
    let collected = 0;
    try {
      for (const row of targets) {
        setProgress(`${registered + 1} / ${targets.length} 件目を登録中...`);
        const template = row.template!;
        const sample = template.sample;

        const created = await api.createWatch({
          url: row.url,
          title: row.text,
          fetchBackend: sample.fetchBackend,
          checkIntervalMinutes: sample.checkIntervalMinutes,
          includeFilters: template.includeFilters,
          subtractedFilters: template.subtractedFilters,
          tag: sample.tag,
        });

        let sampleFeed = sampleFeeds.get(sample.id);
        if (!sampleFeed) {
          sampleFeed = await api.getFeedConfig(sample.id);
          sampleFeeds.set(sample.id, sampleFeed);
        }
        await api.saveFeedConfig(created.id, {
          userId: sampleFeed.userId,
          destDir: sampleFeed.destDir,
          itemPattern: sampleFeed.itemPattern,
          // 最初の洗い出しは人が見る。何を持っていて何を落とすかを決めてから任せる
          autoSend: false,
          // 落ちたファイルの名前になる。外伝は外伝の名前、本編は棚の綴り
          title: row.kind === 'main' ? searchedQuery : guessSeriesQuery(row.text),
          author: row.kind === 'main' ? author : null,
          // 一覧では外伝も本編のカードに入れる
          group: searchedQuery,
        });
        registered++;

        // 登録した時点でページに並んでいる巻を候補にする。持っている巻は PowerDowner が棚を見て弾く
        if (sampleFeed.userId !== null) {
          setProgress(`${registered} / ${targets.length} 件目の巻を洗い出し中...`);
          try {
            collected += (await api.scanFeed(created.id, true)).added;
          } catch {
            // 洗い出しに失敗しても監視は登録できている。カードの投入画面からやり直せる
          }
        }
      }
      onNotify(
        collected > 0
          ? `${registered} 件を監視しました。候補 ${collected} 件をカードの投入から確認してください`
          : `${registered} 件を監視しました`
      );
      onRegistered();
      onClose();
    } catch (err: any) {
      setError(`${registered} 件まで登録しました。${err.message || '登録に失敗しました'}`);
      onRegistered();
    } finally {
      setProgress(null);
    }
  };

  const selectable = rows.filter((r) => checked.has(r.url) && r.template && !r.watchedId).length;
  const busy = searching || progress !== null;

  const renderRow = (row: HitRow) => (
    <li key={row.url} className="flex items-center gap-2.5 py-2 border-t border-slate-100 dark:border-slate-800">
      {row.watchedId ? (
        <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <input
          type="checkbox"
          checked={checked.has(row.url)}
          disabled={!row.template || busy}
          onChange={() => toggle(row.url)}
          className="w-4 h-4 accent-indigo-600 flex-shrink-0"
          aria-label={`${row.siteLabel} ${row.text}`}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{row.siteLabel}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 break-all">{row.text}</div>
      </div>
      {row.watchedId ? (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex-shrink-0">
          監視中
        </span>
      ) : !row.template ? (
        // 見本が無いサイトは XPath が決まらない。ピッカーで 1 件登録すれば、次からそれが見本になる
        <button
          type="button"
          onClick={() => onOpenCreate(row.url)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex-shrink-0"
        >
          <MousePointerClick className="w-3.5 h-3.5" />
          見本を登録
        </button>
      ) : null}
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex-shrink-0"
        aria-label="ページを開く"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </li>
  );

  const mains = rows.filter((r) => r.kind === 'main');
  const related = rows.filter((r) => r.kind === 'related');
  const misses = (results ?? []).filter((r) => r.hits.length === 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="続きを探す" subtitle={author ?? undefined} error={error} size="md">
      <div className="p-5 space-y-4 overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass}
            placeholder="作品名"
            aria-label="作品名"
          />
          <button type="submit" disabled={busy} className={`${cancelButtonClass} flex items-center gap-1 !py-2`}>
            {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            検索
          </button>
        </form>

        {searching && !results && <p className="text-xs text-slate-400">アップロードサイトを検索中...</p>}

        {results && (
          <div className="space-y-3">
            <section>
              <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">本編</h3>
              {mains.length > 0 ? (
                <ul>{mains.map(renderRow)}</ul>
              ) : (
                <p className="text-xs text-slate-400 py-1">見つかりませんでした</p>
              )}
            </section>
            {related.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                  関連 (外伝・アンソロジー・画集など)
                </h3>
                <ul>{related.map(renderRow)}</ul>
              </section>
            )}
            {misses.length > 0 && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {misses.map((r) => `${r.label}: ${r.error ? `検索に失敗 (${r.error})` : '見つからず'}`).join(' ・ ')}
              </p>
            )}
          </div>
        )}

        <SiteLedger />

        <div className="pt-1 flex items-center justify-end gap-2">
          {progress && <span className="text-[11px] text-slate-500 mr-auto">{progress}</span>}
          <button type="button" onClick={onClose} disabled={progress !== null} className={cancelButtonClass}>
            閉じる
          </button>
          <button type="button" onClick={register} disabled={busy || selectable === 0} className={submitButtonClass}>
            {progress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {selectable} 件を監視する
          </button>
        </div>
      </div>
    </Modal>
  );
};

/**
 * 検索するサイトの台帳。サイトはよく潰れるので、失敗が続いたら赤で出して人が外す。
 * 見張る場所は同じサイトの既存の監視から引き継ぐので、ここに書くのは検索 URL だけ。
 */
const SiteLedger: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<SearchSite[] | null>(null);
  const [label, setLabel] = useState('');
  const [searchUrl, setSearchUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.listSearchSites().then(setSites, (err) => setError(err.message));
  }, [open]);

  const replace = (site: SearchSite) => setSites((prev) => prev?.map((s) => (s.id === site.id ? site : s)) ?? null);

  const toggle = async (site: SearchSite) => {
    try {
      replace(await api.updateSearchSite(site.id, { enabled: !site.enabled }));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const remove = async (site: SearchSite) => {
    if (!window.confirm(`${site.label} を台帳から消しますか？`)) return;
    try {
      await api.removeSearchSite(site.id);
      setSites((prev) => prev?.filter((s) => s.id !== site.id) ?? null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await api.addSearchSite(label.trim(), searchUrl.trim());
      setSites((prev) => [...(prev ?? []), created]);
      setLabel('');
      setSearchUrl('');
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2"
    >
      <summary className="text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">検索するサイト</summary>
      {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
      <ul className="mt-2">
        {(sites ?? []).map((site) => (
          <li key={site.id} className="flex items-center gap-2 py-2 border-t border-slate-100 dark:border-slate-800">
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-semibold ${site.enabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400'}`}>
                {site.label}
              </div>
              <div className="text-[11px] text-slate-400 font-mono break-all">{site.searchUrl}</div>
              {site.failStreak > 0 ? (
                <div className="text-[11px] text-red-500">
                  検索が {site.failStreak} 回続けて失敗 ({site.lastError})
                </div>
              ) : site.lastHitAt ? (
                <div className="text-[11px] text-slate-400">
                  最終ヒット {new Date(site.lastHitAt).toLocaleDateString()}
                </div>
              ) : null}
            </div>
            <label className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 flex-shrink-0">
              <input
                type="checkbox"
                checked={site.enabled}
                onChange={() => toggle(site)}
                className="w-3.5 h-3.5 accent-indigo-600"
              />
              使用する
            </label>
            <button
              type="button"
              onClick={() => remove(site)}
              className="p-1 text-slate-400 hover:text-red-500 flex-shrink-0"
              aria-label={`${site.label} を消す`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} placeholder="サイト名" />
        <input
          value={searchUrl}
          onChange={(e) => setSearchUrl(e.target.value)}
          className={monoInputClass}
          placeholder="https://example.com/?s={q}"
        />
        <button type="submit" className={`${cancelButtonClass} !py-1.5 text-xs`}>
          サイトを足す
        </button>
      </form>
    </details>
  );
};
