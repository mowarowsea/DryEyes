import { JsonStore } from './store.js';
import { baseHost } from './urlSafety.js';
import { RedirectDecisions, RedirectProposal, RedirectStoreData } from '../types/index.js';

// リダイレクトの「提案」と、それに対するユーザーの判断を持つ。
//
// 監視先を勝手に書き換えると、一時的なメンテページやパーキングページを掴んだまま
// 元の URL を失う。そこで検知した移転はいったんここに積み、承認されたときだけ反映する。
// 一方で、行ったり来たりするミラーサイトのたびに聞かれても困るので、
// 一度承認／却下したホストは覚えておき、次からは黙って処理する。

const store = new JsonStore<RedirectStoreData>('watch-redirects.json', {
  pending: {},
  decisions: {},
});

const EMPTY_DECISIONS: RedirectDecisions = { allowedHosts: [], deniedHosts: [] };

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

export function getDecisions(watchId: string): RedirectDecisions {
  const saved = store.get().decisions[watchId];
  if (!saved) return EMPTY_DECISIONS;
  return {
    allowedHosts: saved.allowedHosts || [],
    deniedHosts: saved.deniedHosts || [],
  };
}

// 判断はホスト単位で覚える。同じ移転先へのパス違いで何度も聞かないため。
function recordDecision(watchId: string, url: string, allow: boolean): void {
  let host: string;
  try {
    host = baseHost(new URL(url).hostname);
  } catch {
    return;
  }

  store.update((data) => {
    const current = data.decisions[watchId] || { allowedHosts: [], deniedHosts: [] };
    const allowed = new Set(current.allowedHosts || []);
    const denied = new Set(current.deniedHosts || []);

    // 判断を変えたときに前の記録が残っていると、承認と却下の両方に載ってしまう
    if (allow) {
      allowed.add(host);
      denied.delete(host);
    } else {
      denied.add(host);
      allowed.delete(host);
    }

    data.decisions[watchId] = {
      allowedHosts: [...allowed],
      deniedHosts: [...denied],
    };
  });
}

export function allowRedirectHost(watchId: string, url: string): void {
  recordDecision(watchId, url, true);
}

export function denyRedirectHost(watchId: string, url: string): void {
  recordDecision(watchId, url, false);
}

function matchesHost(hosts: string[], url: string): boolean {
  try {
    const host = baseHost(new URL(url).hostname);
    return hosts.includes(host);
  } catch {
    return false;
  }
}

// 「今後もこのドメインは自動で切り替える」を選んだ行き先か
export function isAllowedRedirect(watchId: string, url: string): boolean {
  return matchesHost(getDecisions(watchId).allowedHosts, url);
}

// 「変更しない」を選んだ行き先か。二度と提案しない。
export function isDeniedRedirect(watchId: string, url: string): boolean {
  return matchesHost(getDecisions(watchId).deniedHosts, url);
}

// 監視を削除したときに、提案と判断をまとめて捨てる
export function clearRedirectState(watchId: string): void {
  store.update((data) => {
    delete data.pending[watchId];
    delete data.decisions[watchId];
  });
}

// changedetection.io 側で直接消された監視の記録を掃除する
export function pruneRedirectState(existingWatchIds: string[]): void {
  const alive = new Set(existingWatchIds);
  store.update((data) => {
    for (const id of Object.keys(data.pending)) {
      if (!alive.has(id)) delete data.pending[id];
    }
    for (const id of Object.keys(data.decisions)) {
      if (!alive.has(id)) delete data.decisions[id];
    }
  });
}
