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

// 指定スナップショットまでを既読にする。
// snapshotCount（その時点の総スナップショット数）も一緒に持たせておくと、
// 次に一覧を出すときに履歴を引き直さなくても未読の更新回数を数えられる。
export function markViewed(
  userId: string,
  watchId: string,
  snapshotTimestamp: number,
  snapshotCount = 0
): WatchViewState {
  const state: WatchViewState = {
    snapshotTimestamp: Math.max(0, Math.floor(snapshotTimestamp) || 0),
    viewedAt: new Date().toISOString(),
    snapshotCount: Math.max(0, Math.floor(snapshotCount) || 0),
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

// 最後に確認してから何回更新が記録されたか。
// スナップショットは変更が検知されたときだけ増えるので、その増加分が更新回数になる。
export function countUnviewedChanges(
  userId: string,
  watchId: string,
  snapshotCount: number | undefined,
  lastChanged: number | null
): number {
  const total = Math.max(0, Math.floor(Number(snapshotCount)) || 0);
  const state = getViewState(userId, watchId);

  // 一度も確認していない監視は、初回スナップショット以降に増えた分がすべて未読
  if (!state) return Math.max(0, total - 1);

  // snapshotCount を持たない古い既読状態は正確に数えられないため、
  // 未読があるかどうかだけを 1 / 0 で返す
  if (typeof state.snapshotCount !== 'number') {
    return hasUnviewedChange(userId, watchId, lastChanged) ? 1 : 0;
  }

  return Math.max(0, total - state.snapshotCount);
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
