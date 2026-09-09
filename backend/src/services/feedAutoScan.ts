import { changedetectionClient } from './changedetection.js';
import { scanWatchForFeed } from './feedScan.js';
import { sendCandidates } from './feedSend.js';
import { getFeedConfig, getPointer, listCandidates } from './feedStore.js';
import { getOwner } from './ownership.js';
import { WatchModel } from '../types/index.js';

// 監視が更新されたら、その増分を取り込んで (必要なら) PowerDowner へ送る。
//
// 取り込みの間隔はここでは決めない。「いつ見に行くか」は監視ごとのチェック間隔
// (changedetection.io 側の設定) が既に持っているので、こちらはその結果に追いつくだけにする。
// つまりここの周期は「更新に気づくまでの遅れ」でしかなく、取り込みそのものの周期ではない。
//
// 更新が無い監視は listWatches の lastChanged だけで弾けるので、この巡回は
// changedetection.io への API 1 回で済む。実際にページを開くのは増分があったときだけ。
const FOLLOW_INTERVAL_MS = 5 * 60 * 1000;

let running = false;

export interface FeedAutoScanDeps {
  listWatches: () => Promise<WatchModel[]>;
  scan: typeof scanWatchForFeed;
  send: typeof sendCandidates;
}

const defaultDeps: FeedAutoScanDeps = {
  listWatches: () => changedetectionClient.listWatches(),
  scan: scanWatchForFeed,
  send: sendCandidates,
};

export interface FeedAutoScanSummary {
  scanned: number;
  added: number;
  sent: number;
  failures: { watchId: string; message: string }[];
}

/** テスト用に多重起動の抑止を戻す */
export function resetFeedAutoScanState(): void {
  running = false;
}

/**
 * この監視を追いかける必要があるか。
 *
 * 投入先ユーザーが決まっていることを PowerDowner 連携の印にしている。設定画面で
 * 投入先を選ぶこと自体が「この監視はダウンロードに繋ぐ」という意思表示なので、
 * それとは別に「巡回する / しない」のスイッチは持たせない。
 */
function shouldFollow(watch: WatchModel): boolean {
  if (getFeedConfig(watch.id).userId === null) return false;
  // 停止中の監視はスナップショットが増えない
  if (watch.paused) return false;

  const pointer = getPointer(watch.id);
  // 一度も取り込んでいない監視は、ポインタを置くために 1 回は通す
  if (!pointer) return true;
  // 前回取り込んだところから動いていなければ、開くだけ無駄になる
  return (watch.lastChanged ?? 0) > pointer.snapshotTimestamp;
}

export async function runFeedScan(deps: FeedAutoScanDeps = defaultDeps): Promise<FeedAutoScanSummary> {
  const summary: FeedAutoScanSummary = { scanned: 0, added: 0, sent: 0, failures: [] };
  // ブラウザを開くので重い。前の回が終わっていなければ見送る
  if (running) return summary;
  running = true;

  try {
    const watches = await deps.listWatches();
    for (const watch of watches) {
      if (!shouldFollow(watch)) continue;

      try {
        const result = await deps.scan(watch);
        summary.scanned++;
        summary.added += result.added;

        if (!getFeedConfig(watch.id).autoSend) continue;

        // 投入先ユーザーは監視の所有者から決まる。分からなければ送れない
        const owner = getOwner(watch.id);
        if (!owner) continue;

        // 未処理のものをまとめて送る。前回投入に失敗して残ったものもここで拾い直す
        const pending = listCandidates({ watchId: watch.id, status: 'pending' });
        if (pending.length === 0) continue;

        const sendResult = await deps.send(pending.map((c) => c.id), owner);
        summary.sent += sendResult.sent;
        for (const error of sendResult.errors) summary.failures.push(error);
      } catch (err: any) {
        // 1 つの監視が転んでも、残りは回し切る
        summary.failures.push({ watchId: watch.id, message: err?.message || String(err) });
      }
    }
  } finally {
    running = false;
  }

  return summary;
}

export function startFeedScanner(): void {
  const run = () => {
    runFeedScan()
      .then((summary) => {
        if (summary.failures.length > 0) {
          console.warn('[Feed] 取り込みで失敗がありました:', summary.failures.map((f) => f.message).join(' / '));
        }
      })
      .catch((err: any) => {
        console.warn('[Feed] 取り込みの実行に失敗しました:', err.message);
      });
  };
  run();
  setInterval(run, FOLLOW_INTERVAL_MS);
}
