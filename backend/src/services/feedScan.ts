import { diffSnapshots } from './diff.js';
import { addedLinesOf, applyPattern, selectAddedItems, type ExtractedItem } from './feedMatch.js';
import { addCandidates, getFeedConfig, getPointer, setPointer } from './feedStore.js';
import { extractItems } from './itemExtract.js';
import { SnapshotSource } from './historyDiff.js';
import { changedetectionClient } from './changedetection.js';
import { FeedScanResult, WatchModel } from '../types/index.js';

/**
 * 監視の増分から投入候補を作る。
 *
 *   差分 (テキスト) で「何が増えたか」を知り、
 *   実ページ (DOM) から「そのリンクは何か」を取り、
 *   突き合わせて候補にする。
 *
 * スナップショットには href が残らないので、この二段構えが要る (ARCHITECTURE.md 5 章)。
 */

/** リンクを持たない要素は投入しようがないので落とす */
function toEntries(items: ExtractedItem[], itemPattern: string | null) {
  return items
    .filter((item) => item.urls.length > 0)
    .map((item) => ({
      text: item.text,
      urls: item.urls,
      meta: applyPattern(item.text, itemPattern),
    }));
}

export interface FeedScanDeps {
  source: SnapshotSource;
  extract: (url: string, selectors: string[]) => Promise<ExtractedItem[]>;
}

const defaultDeps: FeedScanDeps = {
  source: changedetectionClient,
  extract: extractItems,
};

export interface FeedScanOptions {
  /**
   * 'all' は差分を見ずにページ全体を候補にする。
   * 監視を登録した直後の洗い出し用 — 何が既にあって何を落とすかを、
   * 増分を待たずに一度で決めたいときに使う。
   */
  mode?: 'increment' | 'all';
}

export async function scanWatchForFeed(
  watch: WatchModel,
  deps: FeedScanDeps = defaultDeps,
  options: FeedScanOptions = {}
): Promise<FeedScanResult> {
  const config = getFeedConfig(watch.id);
  if (!config.enabled) return { watchId: watch.id, status: 'disabled', added: 0 };

  const selectors = watch.includeFilters.filter(Boolean);
  if (selectors.length === 0) return { watchId: watch.id, status: 'no-selector', added: 0 };

  const history = await deps.source.getHistory(watch.id);
  const latest = history[0];
  if (!latest) return { watchId: watch.id, status: 'unchanged', added: 0 };

  // 全件モードは差分を見ない。ページに並んでいるものを丸ごと候補にして、
  // どれが既にあるか・どれを落とすかを人に選ばせる
  if (options.mode === 'all') {
    const items = await deps.extract(watch.url, selectors);
    const added = addCandidates(watch.id, toEntries(items, config.itemPattern));
    setPointer(watch.id, latest.timestamp);
    return {
      watchId: watch.id,
      status: 'collected',
      added: added.length,
      extracted: items.length,
    };
  }

  const pointer = getPointer(watch.id);

  // 初回は候補を作らない。登録した時点でページに並んでいるものは「新着」ではないので、
  // ここで全部を候補にすると、既に持っている巻がまとめて出てくる
  // (洗い出したいときは上の全件モードを使う)
  if (!pointer) {
    setPointer(watch.id, latest.timestamp);
    return { watchId: watch.id, status: 'initialized', added: 0 };
  }
  if (pointer.snapshotTimestamp >= latest.timestamp) {
    return { watchId: watch.id, status: 'unchanged', added: 0 };
  }

  const [before, after] = await Promise.all([
    deps.source.getSnapshot(watch.id, pointer.snapshotTimestamp),
    deps.source.getSnapshot(watch.id, latest.timestamp),
  ]);
  const addedLines = addedLinesOf(diffSnapshots(before, after).lines);

  if (addedLines.length === 0) {
    setPointer(watch.id, latest.timestamp);
    return { watchId: watch.id, status: 'scanned', added: 0, addedLines: 0, extracted: 0 };
  }

  // ここで初めてページを開く。差分が無いときに毎回開かないよう、順番を逆にしないこと
  const items = await deps.extract(watch.url, selectors);
  const matched = selectAddedItems(items, addedLines);

  const added = addCandidates(watch.id, toEntries(matched, config.itemPattern));

  setPointer(watch.id, latest.timestamp);
  return {
    watchId: watch.id,
    status: 'scanned',
    added: added.length,
    addedLines: addedLines.length,
    extracted: items.length,
  };
}
