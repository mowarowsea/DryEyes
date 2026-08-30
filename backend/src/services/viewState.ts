import { JsonStore } from './store.js';
import { ViewStateStoreData, WatchViewState } from '../types/index.js';

// 「どのユーザーが、その監視のどの時点まで内容を確認したか」を持つ。
// changedetection.io にも viewed フラグはあるが、ユーザーの概念が無く全員で共有されて
// しまうため、DryEyes 側でユーザー×監視の単位として保持する。
const store = new JsonStore<ViewStateStoreData>('watch-views.json', { views: {} });

const keyOf = (userId: string, watchId: string) => `${userId}:${watchId}`;

export function getViewState(userId: string, watchId: string): WatchViewState | null {
  return store.get().views[keyOf(userId, watchId)] || null;
}

// 指定スナップショットまでを既読にする
export function markViewed(userId: string, watchId: string, snapshotTimestamp: number): WatchViewState {
  const state: WatchViewState = {
    snapshotTimestamp: Math.max(0, Math.floor(snapshotTimestamp) || 0),
    viewedAt: new Date().toISOString(),
  };
  store.update((data) => {
    data.views[keyOf(userId, watchId)] = state;
  });
  return state;
}

// 最終変更時刻が既読スナップショットより新しければ未読扱い。
// 一度も確認していない監視は、変更が記録されていれば未読とする。
export function hasUnviewedChange(userId: string, watchId: string, lastChanged: number | null): boolean {
  if (!lastChanged) return false;
  const state = getViewState(userId, watchId);
  if (!state) return true;
  return lastChanged > state.snapshotTimestamp;
}

// 監視を削除したときに、全ユーザー分の既読状態を消す
export function clearViewStates(watchId: string): void {
  store.update((data) => {
    for (const key of Object.keys(data.views)) {
      if (key.endsWith(`:${watchId}`)) delete data.views[key];
    }
  });
}

// changedetection.io 側で直接消された監視の既読状態を掃除する
export function pruneViewStates(existingWatchIds: string[]): void {
  const alive = new Set(existingWatchIds);
  store.update((data) => {
    for (const key of Object.keys(data.views)) {
      const watchId = key.slice(key.indexOf(':') + 1);
      if (!alive.has(watchId)) delete data.views[key];
    }
  });
}
