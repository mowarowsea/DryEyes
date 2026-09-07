import { JsonStore } from './store.js';
import { baseHost } from './urlSafety.js';
import {
  RedirectDecisions,
  RedirectHostPair,
  RedirectProposal,
  RedirectStoreData,
} from '../types/index.js';

// リダイレクトの「提案」と、それに対するユーザーの判断を持つ。
//
// 監視先を勝手に書き換えると、一時的なメンテページやパーキングページを掴んだまま
// 元の URL を失う。そこで検知した移転はいったんここに積み、承認されたときだけ反映する。
//
// 判断は「転送元ホスト → 転送先ホスト」の組で、ユーザーごとに覚える。
// サイト丸ごとの移転（example.com → example.new）では、そのユーザーの監視が何十件も
// 同じ組で引っかかる。監視 1 件ずつ覚えていたのでは、同じ答えを何十回も聞くことになる。
// 一方でユーザーをまたいでは共有しない。別ドメインへ付いて行くかは、その監視の持ち主が決めること。

const store = new JsonStore<RedirectStoreData>('watch-redirects.json', {
  pending: {},
  decisions: {},
});

const EMPTY_DECISIONS: RedirectDecisions = { allowed: [], denied: [] };

// 以前は監視 1 件ごとに行き先ホストだけを覚えていた（allowedHosts / deniedHosts）。
// 転送元が残っていないので組へは直せず、読み込み時に捨てる（次に検知したら聞き直す）。
function dropLegacyDecisions(): void {
  const legacy = Object.entries(store.get().decisions).filter(
    ([, d]) => !Array.isArray((d as any)?.allowed) || !Array.isArray((d as any)?.denied)
  );
  if (legacy.length === 0) return;
  store.update((data) => {
    for (const [key] of legacy) delete data.decisions[key];
  });
}
dropLegacyDecisions();

// ---------------------------------------------------------------------------
// 確認待ちの提案
// ---------------------------------------------------------------------------

export function getPendingRedirect(watchId: string): RedirectProposal | null {
  return store.get().pending[watchId] || null;
}

export function setPendingRedirect(watchId: string, proposal: RedirectProposal): void {
  store.update((data) => {
    data.pending[watchId] = proposal;
  });
}

export function clearPendingRedirect(watchId: string): void {
  store.update((data) => {
    delete data.pending[watchId];
  });
}

// 確認待ちをすべて返す。同じ組の提案をまとめて処理するときに使う。
export function listPendingRedirects(): { watchId: string; proposal: RedirectProposal }[] {
  return Object.entries(store.get().pending).map(([watchId, proposal]) => ({ watchId, proposal }));
}

// ---------------------------------------------------------------------------
// ホストの組
// ---------------------------------------------------------------------------

// 判断はホストの組で覚える。同じ移転先へのパス違いで何度も聞かないため。
// www の有無だけの違いは同じホストとして扱う。
export function hostPairOf(fromUrl: string, toUrl: string): RedirectHostPair | null {
  try {
    return {
      from: baseHost(new URL(fromUrl).hostname),
      to: baseHost(new URL(toUrl).hostname),
    };
  } catch {
    return null;
  }
}

export const sameHostPair = (a: RedirectHostPair, b: RedirectHostPair): boolean =>
  a.from === b.from && a.to === b.to;

// ---------------------------------------------------------------------------
// ユーザーごとの判断
// ---------------------------------------------------------------------------

export function getDecisions(userId: string): RedirectDecisions {
  const saved = store.get().decisions[userId];
  if (!saved) return EMPTY_DECISIONS;
  return {
    allowed: saved.allowed || [],
    denied: saved.denied || [],
  };
}

function recordDecision(userId: string, fromUrl: string, toUrl: string, allow: boolean): void {
  const pair = hostPairOf(fromUrl, toUrl);
  if (!pair) return;

  store.update((data) => {
    const current = data.decisions[userId] || { allowed: [], denied: [] };
    const without = (pairs: RedirectHostPair[]) => pairs.filter((p) => !sameHostPair(p, pair));

    // 判断を変えたときに前の記録が残っていると、承認と却下の両方に載ってしまう
    data.decisions[userId] = allow
      ? { allowed: [...without(current.allowed || []), pair], denied: without(current.denied || []) }
      : { allowed: without(current.allowed || []), denied: [...without(current.denied || []), pair] };
  });
}

export function allowRedirect(userId: string, fromUrl: string, toUrl: string): void {
  recordDecision(userId, fromUrl, toUrl, true);
}

export function denyRedirect(userId: string, fromUrl: string, toUrl: string): void {
  recordDecision(userId, fromUrl, toUrl, false);
}

function hasPair(pairs: RedirectHostPair[], fromUrl: string, toUrl: string): boolean {
  const pair = hostPairOf(fromUrl, toUrl);
  return pair !== null && pairs.some((p) => sameHostPair(p, pair));
}

// 「今後たずねない」で承認された組か。そのユーザーの監視なら黙って追従してよい。
export function isAllowedRedirect(userId: string, fromUrl: string, toUrl: string): boolean {
  return hasPair(getDecisions(userId).allowed, fromUrl, toUrl);
}

// 「今後たずねない」で却下された組か。そのユーザーの監視には二度と提案しない。
export function isDeniedRedirect(userId: string, fromUrl: string, toUrl: string): boolean {
  return hasPair(getDecisions(userId).denied, fromUrl, toUrl);
}

// ---------------------------------------------------------------------------
// 掃除
// ---------------------------------------------------------------------------

// 監視を削除したときに、その提案を捨てる。判断はユーザーのものなので残す。
export function clearRedirectState(watchId: string): void {
  clearPendingRedirect(watchId);
}

// changedetection.io 側で直接消された監視の提案を掃除する
export function pruneRedirectState(existingWatchIds: string[]): void {
  const alive = new Set(existingWatchIds);
  store.update((data) => {
    for (const id of Object.keys(data.pending)) {
      if (!alive.has(id)) delete data.pending[id];
    }
  });
}
