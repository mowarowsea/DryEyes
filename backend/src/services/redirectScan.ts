import { changedetectionClient } from './changedetection.js';
import { hasAnySelectorMatch } from './browserRender.js';
import { getOwner, isOwnedBy } from './ownership.js';
import { getPageInfo } from './proxy.js';
import { traceRedirects } from './redirect.js';
import {
  allowRedirect,
  clearPendingRedirect,
  denyRedirect,
  getPendingRedirect,
  hostPairOf,
  isAllowedRedirect,
  isDeniedRedirect,
  listPendingRedirects,
  sameHostPair,
  setPendingRedirect,
} from './redirectReview.js';
import { isTrivialRedirect } from './urlSafety.js';
import {
  RedirectDecisionOptions,
  RedirectDecisionResult,
  RedirectProposal,
  WatchModel,
} from '../types/index.js';

// 監視対象の移転（リダイレクト）を見つけて、ユーザーに確認するまでの流れをまとめたもの。
//
// 移転はエラーとして現れない。リダイレクトの先で普通に中身が取れてしまうため、
// changedetection.io から見れば「いつもどおり成功している」状態のまま、
// いつの間にか別ドメインの内容を見ていることになる。だから定期的にこちらから確かめる。
//
// 見つけたときの扱いは 3 通り。
//   1. 実質同じ URL（https 化・www の付け外し・末尾スラッシュ）→ 黙って追従する
//   2. 持ち主が以前「今後たずねない」で承認した組 → 黙って追従する（往復するミラーサイト向け）
//   3. それ以外 → 提案として積み、画面で確認してもらう。承認されるまで URL は変えない
//
// URL を差し替えても履歴は引き継ぐ（スナップショットは消さない）。移転先が同じ内容の
// ミラーなら差分ゼロで通過するのが正しく、ここでリセットすると往復のたびに監視が途切れる。

// ジョブが起きる間隔
const SCAN_INTERVAL_MS = 30 * 60 * 1000;
// 同じ監視を調べ直すまでの間隔。移転はめったに起きないので、チェック間隔とは別に長く取る。
const PER_WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

// 監視ごとの最終スキャン時刻。再起動後は調べ直すだけなので、永続化はしない。
const lastScannedAt = new Map<string, number>();
let scanRunning = false;

// テスト用に内部状態を空にする
export function resetRedirectScanState(): void {
  lastScannedAt.clear();
  scanRunning = false;
}

// 提案に添える判断材料を集める。どちらも取れなくても提案自体は出す。
async function describeTarget(
  watch: WatchModel,
  toUrl: string
): Promise<{ selectorFound: boolean | null; toTitle: string | null }> {
  // ページ全体を見ている監視には、照合すべきセレクタが無い
  const selectors = watch.includeFilters.filter(Boolean);
  const selectorFound = selectors.length
    ? await hasAnySelectorMatch(toUrl, selectors).catch(() => null)
    : null;

  const info = await getPageInfo(toUrl).catch(() => null);
  // getPageInfo はタイトルを取れないと URL をそのまま返すので、それは「取れなかった」と扱う
  const toTitle = info && info.title && info.title !== toUrl ? info.title : null;

  return { selectorFound, toTitle };
}

/**
 * 1 件の監視についてリダイレクトを調べ、必要なら追従または提案を行う。
 * 何もしなかったときは null、追従したときは 'followed'、提案を積んだときは 'proposed' を返す。
 */
export async function scanWatchForRedirect(
  watch: WatchModel
): Promise<'followed' | 'proposed' | null> {
  const pending = getPendingRedirect(watch.id);
  const trace = await traceRedirects(watch.url);

  if (trace.finalUrl === watch.url) {
    // 移転が解消して元の URL に戻ったなら、確認待ちの提案も畳む
    if (pending) clearPendingRedirect(watch.id);
    return null;
  }

  const follow = async (reason: string): Promise<'followed'> => {
    await changedetectionClient.updateWatchUrl(watch.id, trace.finalUrl);
    if (pending) clearPendingRedirect(watch.id);
    console.log(`[Redirect] "${watch.title}" の監視先を ${trace.finalUrl} へ切り替えました（${reason}）`);
    return 'followed';
  };

  if (isTrivialRedirect(watch.url, trace.finalUrl)) return follow('実質同じ URL');

  // 判断は持ち主ごとに覚えている。持ち主の居ない監視（引き継ぎ前のもの）は毎回確認になる
  const owner = getOwner(watch.id);
  if (owner && isAllowedRedirect(owner, watch.url, trace.finalUrl)) return follow('承認済みの移転');
  if (owner && isDeniedRedirect(owner, watch.url, trace.finalUrl)) return null;

  // 同じ行き先の提案が既に出ているなら、作り直さない。
  // 判断材料を集め直すのに実ブラウザを起動するので、答えを待っている間は繰り返さない。
  if (pending && pending.toUrl === trace.finalUrl) return null;

  const { selectorFound, toTitle } = await describeTarget(watch, trace.finalUrl);

  setPendingRedirect(watch.id, {
    fromUrl: watch.url,
    toUrl: trace.finalUrl,
    chain: trace.chain,
    status: trace.status,
    permanent: trace.permanent,
    hostChanged: trace.hostChanged,
    detectedAt: new Date().toISOString(),
    selectorFound,
    toTitle,
  });
  console.log(`[Redirect] "${watch.title}" が ${trace.finalUrl} へ移転しています。確認待ちにしました`);
  return 'proposed';
}

/**
 * 全監視を対象に、期限が来たものだけリダイレクトを調べる。
 * 1 件の失敗（到達できない・名前が引けないなど）で残りを止めない。
 */
export async function scanForRedirects(): Promise<void> {
  if (scanRunning) return; // 前回が長引いている間は重ねて走らせない
  scanRunning = true;
  try {
    let watches: WatchModel[];
    try {
      watches = await changedetectionClient.listWatches();
    } catch (err: any) {
      console.warn('[Redirect] 監視一覧の取得に失敗しました:', err.message);
      return;
    }

    const now = Date.now();
    for (const watch of watches) {
      if (watch.paused || !watch.url) continue;

      const last = lastScannedAt.get(watch.id);
      if (last && now - last < PER_WATCH_INTERVAL_MS) continue;
      lastScannedAt.set(watch.id, now);

      try {
        await scanWatchForRedirect(watch);
      } catch (err: any) {
        // 監視対象が一時的に落ちているだけのことも多いので、警告に留める
        console.warn(`[Redirect] "${watch.title}" の確認に失敗しました:`, err.message);
      }
    }
  } finally {
    scanRunning = false;
  }
}

// 起動時に一度走らせ、以後は一定間隔で確認し続ける
export function startRedirectScanner(): void {
  const run = () => {
    scanForRedirects().catch((err: any) => {
      console.warn('[Redirect] 移転チェックの実行に失敗しました:', err.message);
    });
  };
  run();
  setInterval(run, SCAN_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// ユーザーの答え（承認・却下）
// ---------------------------------------------------------------------------
//
// 答えは既定でまとめて効かせる。サイト丸ごとの移転では、同じ持ち主の監視が何十件も
// 同じ「転送元 → 転送先」の組で確認待ちになる。1 件ずつ答えさせるのは、同じ質問を
// 何十回も繰り返すのと同じ。onlyThis を立てたときだけ、起点の監視 1 件に絞る。

type PendingEntry = { watchId: string; proposal: RedirectProposal };

// 起点の監視と同じ組で確認待ちになっている、同じ持ち主の監視を集める（起点を先頭に）
function collectTargets(
  userId: string,
  watchId: string,
  proposal: RedirectProposal,
  onlyThis: boolean
): PendingEntry[] {
  const targets: PendingEntry[] = [{ watchId, proposal }];
  const pair = hostPairOf(proposal.fromUrl, proposal.toUrl);
  if (onlyThis || !pair) return targets;

  for (const entry of listPendingRedirects()) {
    if (entry.watchId === watchId) continue;
    // 他のユーザーの監視は、その人が自分で答える
    if (!isOwnedBy(entry.watchId, userId)) continue;
    const other = hostPairOf(entry.proposal.fromUrl, entry.proposal.toUrl);
    if (other && sameHostPair(other, pair)) targets.push(entry);
  }
  return targets;
}

/**
 * 提案を承認して監視先を差し替える。同じ組の確認待ちも、同じ持ち主の分はまとめて差し替える。
 * always を立てると、以後この組の移動は確認なしで追従する。
 */
export async function acceptPendingRedirect(
  userId: string,
  watchId: string,
  options: RedirectDecisionOptions
): Promise<RedirectDecisionResult> {
  const proposal = getPendingRedirect(watchId);
  if (!proposal) throw new Error('確認待ちの移転はありません');

  const targets = collectTargets(userId, watchId, proposal, options.onlyThis);

  // 起点の監視だけは失敗をそのまま返す。押した本人が見ている監視なので、黙って飛ばさない。
  await changedetectionClient.updateWatchUrl(watchId, proposal.toUrl);
  clearPendingRedirect(watchId);
  // 差し替えた URL を起点に、次のスキャンで見直す
  lastScannedAt.delete(watchId);
  let applied = 1;
  let failed = 0;

  for (const target of targets.slice(1)) {
    try {
      await changedetectionClient.updateWatchUrl(target.watchId, target.proposal.toUrl);
      clearPendingRedirect(target.watchId);
      lastScannedAt.delete(target.watchId);
      applied++;
    } catch (err: any) {
      // 残りは止めない。失敗した監視は確認待ちのまま残るので、あとからやり直せる
      failed++;
      console.warn(`[Redirect] 監視 ${target.watchId} の監視先を差し替えられませんでした:`, err.message);
    }
  }

  if (options.always) {
    allowRedirect(userId, proposal.fromUrl, proposal.toUrl);
    // 往復するミラーは元の URL へも戻るため、戻り先も承認済みにしておく。
    // そうしないと「元に戻りました」で毎回聞かれることになる。
    allowRedirect(userId, proposal.toUrl, proposal.fromUrl);
  }

  if (targets.length > 1) {
    console.log(
      `[Redirect] ${proposal.fromUrl} → ${proposal.toUrl} の移転を ${applied} 件まとめて反映しました` +
        (failed ? `（${failed} 件は失敗）` : '')
    );
  }
  return { proposal, applied, failed };
}

/**
 * 提案を却下する。同じ組の確認待ちも、同じ持ち主の分はまとめて畳む。
 * always を立てると、以後この組の移動は提案しない。
 * always なしの「今回は変更しない」でも、次のスキャン間隔が来るまでは蒸し返さない。
 */
export function dismissPendingRedirect(
  userId: string,
  watchId: string,
  options: RedirectDecisionOptions
): RedirectDecisionResult {
  const proposal = getPendingRedirect(watchId);
  if (!proposal) throw new Error('確認待ちの移転はありません');

  const targets = collectTargets(userId, watchId, proposal, options.onlyThis);
  for (const target of targets) {
    clearPendingRedirect(target.watchId);
    lastScannedAt.set(target.watchId, Date.now());
  }

  if (options.always) denyRedirect(userId, proposal.fromUrl, proposal.toUrl);

  return { proposal, applied: targets.length, failed: 0 };
}
