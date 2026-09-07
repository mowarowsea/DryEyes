import { baseHost } from './urlSafety.js';
import { WatchModel } from '../types/index.js';

// 登録しようとしている URL を、すでに監視していないかを調べる。
//
// 監視が増えてくると「これ登録したっけ」が起きる。とくに共有シートから登録するときは
// 一覧を見ずに登録まで進むので、同じページの監視が 2 つ並びやすい。
// ここで見つけたものは画面で知らせるだけで、登録自体は止めない（別々に見張りたいこともある）。

// 見つかった理由。
//  - same:     同じ URL（表記ゆれを除く）
//  - redirect: 別ドメインだが、移転先として検知済み／承認済みの転送で結ばれた同じページ
export type DuplicateReason = 'same' | 'redirect';

export interface DuplicateMatch {
  watch: WatchModel;
  reason: DuplicateReason;
}

// 「同じページか」を見るための鍵。
//  - http と https の違いは無視する（https で登録し直すのが普通で、別ページではない）
//  - 先頭の www. と末尾のスラッシュは無視する
//  - フラグメント (#...) は無視する。取得される内容は変わらない
//  - クエリは残す。?page=2 のような別ページを同じものにしないため
export function duplicateKey(rawUrl: string): string | null {
  const parsed = parseHttpUrl(rawUrl);
  return parsed ? `${baseHost(parsed.hostname)}${pathKeyOf(parsed)}` : null;
}

// ホストを除いた鍵。移転で結ばれた別ドメインの同じページを見るときに使う
function pathKey(rawUrl: string): string | null {
  const parsed = parseHttpUrl(rawUrl);
  return parsed ? pathKeyOf(parsed) : null;
}

function pathKeyOf(parsed: URL): string {
  return `${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
}

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface DuplicateLookupDeps {
  // その監視に積まれている移転の提案先（無ければ null）
  pendingRedirectUrlOf: (watchId: string) => string | null;
  // 「転送元 → 転送先」の組を、このユーザーが承認済みか
  isAllowedRedirect: (fromUrl: string, toUrl: string) => boolean;
}

/**
 * 同じページを見ている監視を探す。同じ URL のものを優先し、
 * 無ければ移転で結ばれたもの（提案中の転送先が一致する／承認済みの転送でホストだけ違う）を探す。
 */
export function findDuplicateWatch(
  url: string,
  watches: WatchModel[],
  deps: DuplicateLookupDeps
): DuplicateMatch | null {
  const key = duplicateKey(url);
  if (!key) return null;

  const same = watches.find((w) => duplicateKey(w.url) === key);
  if (same) return { watch: same, reason: 'same' };

  const path = pathKey(url);
  for (const watch of watches) {
    const pending = deps.pendingRedirectUrlOf(watch.id);
    if (pending && duplicateKey(pending) === key) return { watch, reason: 'redirect' };

    // 承認済みの転送はどちら向きでも同じページ扱いにする。
    // 行き来するミラーサイトでは、古いほうのドメインで登録済みのことも新しいほうのこともある。
    if (
      path !== null &&
      pathKey(watch.url) === path &&
      (deps.isAllowedRedirect(watch.url, url) || deps.isAllowedRedirect(url, watch.url))
    ) {
      return { watch, reason: 'redirect' };
    }
  }

  return null;
}
