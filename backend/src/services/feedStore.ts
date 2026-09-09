import crypto from 'node:crypto';
import { JsonStore } from './store.js';
import { FeedCandidate, FeedConfig, FeedPointer, FeedStoreData } from '../types/index.js';
import { ItemMeta, sourceKeyOf } from './feedMatch.js';

// 監視の増分から作った「PowerDowner へ投入する候補」と、その周辺の状態。
//
// 当面は自動投入しない。ここに溜めて画面で確認し、押されたものだけを送る。
// 抽出ルール (URL・作者・巻数) の当たり外れを見てから自動へ切り替える
// (ARCHITECTURE.md 5 章「承認フローと投入ポインタ」)。

const store = new JsonStore<FeedStoreData>('watch-feed.json', {
  candidates: {},
  configs: {},
  pointers: {},
});

const DEFAULT_CONFIG: FeedConfig = {
  // 登録しただけの監視が勝手に候補を溜めないよう、既定は無効にしておく
  enabled: false,
  itemPattern: null,
  userId: null,
  destDir: null,
};

export function getFeedConfig(watchId: string): FeedConfig {
  return { ...DEFAULT_CONFIG, ...(store.get().configs[watchId] ?? {}) };
}

export function setFeedConfig(watchId: string, patch: Partial<FeedConfig>): FeedConfig {
  const next: FeedConfig = { ...getFeedConfig(watchId), ...patch };
  store.update((data) => {
    data.configs[watchId] = next;
  });
  return next;
}

/**
 * どのスナップショットまで候補化したか。
 * 既読 (viewState) と混ぜないこと — 同じフラグにすると「候補に積んだら既読になって
 * 人が気づかない」「人が先に見たら候補に積まれない」のどちらかで必ず事故る。
 */
export function getPointer(watchId: string): FeedPointer | null {
  return store.get().pointers[watchId] ?? null;
}

export function setPointer(watchId: string, snapshotTimestamp: number): FeedPointer {
  const pointer: FeedPointer = {
    snapshotTimestamp: Math.max(0, Math.floor(snapshotTimestamp) || 0),
    scannedAt: new Date().toISOString(),
  };
  store.update((data) => {
    data.pointers[watchId] = pointer;
  });
  return pointer;
}

export function listCandidates(
  opts: { watchId?: string; status?: FeedCandidate['status'] } = {}
): FeedCandidate[] {
  return Object.values(store.get().candidates)
    .filter((c) => (opts.watchId ? c.watchId === opts.watchId : true))
    .filter((c) => (opts.status ? c.status === opts.status : true))
    .sort((a, b) => (a.foundAt === b.foundAt ? 0 : a.foundAt < b.foundAt ? 1 : -1));
}

export function getCandidate(id: string): FeedCandidate | null {
  return store.get().candidates[id] ?? null;
}

/**
 * 候補を積む。同じ行から作った候補が既にあれば飛ばす。
 * 一度見送ったものが次のスキャンで復活しないよう、状態を問わず弾く。
 */
export function addCandidates(
  watchId: string,
  items: { text: string; urls: string[]; meta: ItemMeta }[]
): FeedCandidate[] {
  const known = new Set(Object.values(store.get().candidates).map((c) => c.sourceKey));
  const added: FeedCandidate[] = [];
  const foundAt = new Date().toISOString();

  for (const item of items) {
    const sourceKey = sourceKeyOf(watchId, item.text);
    if (known.has(sourceKey)) continue;
    known.add(sourceKey);
    added.push({
      id: crypto.randomUUID(),
      watchId,
      sourceKey,
      text: item.meta.rawText,
      urls: item.urls,
      meta: item.meta,
      foundAt,
      status: 'pending',
      sentAt: null,
      resultNote: null,
    });
  }

  if (added.length > 0) {
    store.update((data) => {
      for (const candidate of added) data.candidates[candidate.id] = candidate;
    });
  }
  return added;
}

/** 投入できたものを済みにする。PowerDowner の返答 (スキップ・合流も含む) を添えて残す */
export function markSent(id: string, note: string | null): FeedCandidate | null {
  const current = getCandidate(id);
  if (!current) return null;
  const next: FeedCandidate = {
    ...current,
    status: 'sent',
    sentAt: new Date().toISOString(),
    resultNote: note,
  };
  store.update((data) => {
    data.candidates[id] = next;
  });
  return next;
}

/** 見送る。sourceKey は残るので、同じ行が次のスキャンで復活することはない */
export function dismissCandidate(id: string): FeedCandidate | null {
  const current = getCandidate(id);
  if (!current) return null;
  const next: FeedCandidate = { ...current, status: 'dismissed' };
  store.update((data) => {
    data.candidates[id] = next;
  });
  return next;
}

/** 監視を削除したときの後始末 */
export function clearFeedState(watchId: string): void {
  store.update((data) => {
    for (const [id, candidate] of Object.entries(data.candidates)) {
      if (candidate.watchId === watchId) delete data.candidates[id];
    }
    delete data.configs[watchId];
    delete data.pointers[watchId];
  });
}

/** changedetection.io 側で直接消された監視の状態を掃除する */
export function pruneFeedState(existingWatchIds: string[]): void {
  const alive = new Set(existingWatchIds);
  store.update((data) => {
    for (const [id, candidate] of Object.entries(data.candidates)) {
      if (!alive.has(candidate.watchId)) delete data.candidates[id];
    }
    for (const watchId of Object.keys(data.configs)) {
      if (!alive.has(watchId)) delete data.configs[watchId];
    }
    for (const watchId of Object.keys(data.pointers)) {
      if (!alive.has(watchId)) delete data.pointers[watchId];
    }
  });
}
