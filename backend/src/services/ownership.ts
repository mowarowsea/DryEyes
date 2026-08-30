import { JsonStore } from './store.js';
import { OwnershipStoreData } from '../types/index.js';

// changedetection.io は監視の所有者という概念を持たないため、
// 「どの監視が誰のものか」は DryEyes 側で保持する（request.md 16章の責務分担に沿う）。
const store = new JsonStore<OwnershipStoreData>('watch-owners.json', { owners: {} });

export function assignOwner(watchId: string, userId: string): void {
  store.update((data) => {
    data.owners[watchId] = userId;
  });
}

export function getOwner(watchId: string): string | null {
  return store.get().owners[watchId] || null;
}

export function isOwnedBy(watchId: string, userId: string): boolean {
  return getOwner(watchId) === userId;
}

export function releaseOwner(watchId: string): void {
  store.update((data) => {
    delete data.owners[watchId];
  });
}

// 所有者未設定の監視をまとめて引き取る。
// ログイン機能を後付けしたため、導入前に作られた監視が宙に浮くのを防ぐ用途。
export function claimUnowned(watchIds: string[], userId: string): string[] {
  const claimed: string[] = [];
  store.update((data) => {
    for (const id of watchIds) {
      if (!data.owners[id]) {
        data.owners[id] = userId;
        claimed.push(id);
      }
    }
  });
  return claimed;
}

// 削除済み監視の所有者情報が残り続けないよう掃除する
export function pruneMissing(existingIds: string[]): void {
  const alive = new Set(existingIds);
  store.update((data) => {
    for (const id of Object.keys(data.owners)) {
      if (!alive.has(id)) delete data.owners[id];
    }
  });
}
