import { JsonStore } from './store.js';
import { ShareStoreData } from '../types/index.js';

// 所有者は変えずに、別ユーザーへ閲覧・操作の権限だけを追加で渡す仕組み。
// changedetection.io は共有という概念を持たないため ownership.ts と同様に DryEyes 側で保持する。
const store = new JsonStore<ShareStoreData>('watch-shares.json', { shares: {} });

export function getSharedUserIds(watchId: string): string[] {
  return store.get().shares[watchId] || [];
}

export function isSharedWith(watchId: string, userId: string): boolean {
  return getSharedUserIds(watchId).includes(userId);
}

export function shareWatch(watchId: string, userId: string): void {
  store.update((data) => {
    const list = data.shares[watchId] || (data.shares[watchId] = []);
    if (!list.includes(userId)) list.push(userId);
  });
}

export function unshareWatch(watchId: string, userId: string): void {
  store.update((data) => {
    const list = data.shares[watchId];
    if (!list) return;
    data.shares[watchId] = list.filter((id) => id !== userId);
  });
}

// 監視を削除したときに、共有情報も一緒に消す
export function clearShares(watchId: string): void {
  store.update((data) => {
    delete data.shares[watchId];
  });
}

// changedetection.io 側で直接消された監視の共有情報を掃除する
export function pruneMissing(existingIds: string[]): void {
  const alive = new Set(existingIds);
  store.update((data) => {
    for (const id of Object.keys(data.shares)) {
      if (!alive.has(id)) delete data.shares[id];
    }
  });
}
