import { changedetectionClient } from './changedetection.js';
import { hasAnySelectorMatch } from './browserRender.js';
import { getPageInfo } from './proxy.js';
import { traceRedirects } from './redirect.js';
import {
  allowRedirectHost,
  clearPendingRedirect,
  denyRedirectHost,
  getPendingRedirect,
  isAllowedRedirect,
  isDeniedRedirect,
  setPendingRedirect,
} from './redirectReview.js';
import { isTrivialRedirect } from './urlSafety.js';
import { RedirectProposal, WatchModel } from '../types/index.js';

// 監視対象の移転（リダイレクト）を見つけて、ユーザーに確認するまでの流れをまとめたもの。
//
// 移転はエラーとして現れない。リダイレクトの先で普通に中身が取れてしまうため、
// changedetection.io から見れば「いつもどおり成功している」状態のまま、
// いつの間にか別ドメインの内容を見ていることになる。だから定期的にこちらから確かめる。
//
// 見つけたときの扱いは 3 通り。
//   1. 実質同じ URL（https 化・www の付け外し・末尾スラッシュ）→ 黙って追従する
//   2. 以前ユーザーが承認した行き先 → 黙って追従する（往復するミラーサイト向け）
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
  if (isAllowedRedirect(watch.id, trace.finalUrl)) return follow('承認済みの移転先');
  if (isDeniedRedirect(watch.id, trace.finalUrl)) return null;

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

/**
 * 提案を承認して監視先を差し替える。
 * always を立てると、以後この行き先ホストへのリダイレクトは確認なしで追従する。
 */
export async function acceptPendingRedirect(
  watchId: string,
  always: boolean
): Promise<RedirectProposal> {
  const proposal = getPendingRedirect(watchId);
  if (!proposal) throw new Error('確認待ちの移転はありません');

  await changedetectionClient.updateWatchUrl(watchId, proposal.toUrl);
  if (always) {
    allowRedirectHost(watchId, proposal.toUrl);
    // 往復するミラーは元の URL へも戻るため、戻り先も承認済みにしておく。
    // そうしないと「元に戻りました」で毎回聞かれることになる。
    allowRedirectHost(watchId, proposal.fromUrl);
  }
  clearPendingRedirect(watchId);
  // 差し替えた URL を起点に、次のスキャンで見直す
  lastScannedAt.delete(watchId);
  return proposal;
}

/**
 * 提案を却下する。always を立てると、以後この行き先へのリダイレクトは提案しない。
 * always なしの「今回は変更しない」でも、次のスキャン間隔が来るまでは蒸し返さない。
 */
export function dismissPendingRedirect(watchId: string, always: boolean): RedirectProposal {
  const proposal = getPendingRedirect(watchId);
  if (!proposal) throw new Error('確認待ちの移転はありません');

  if (always) denyRedirectHost(watchId, proposal.toUrl);
  clearPendingRedirect(watchId);
  lastScannedAt.set(watchId, Date.now());
  return proposal;
}
