import { changedetectionClient } from './changedetection.js';
import { scanWatchForFeed } from './feedScan.js';
import { sendCandidates } from './feedSend.js';
import { getFeedConfig, listCandidates } from './feedStore.js';
import { getOwner } from './ownership.js';
import { WatchModel } from '../types/index.js';

// 増分の取り込みと自動投入を定期的に回す。
//
// 「候補を作る」と「確認なしで送る」は別の設定にしてある。取り込みだけ回して溜め、
// 抽出の当たり外れを見てから autoSend を立てる、という順に進められるようにするため
// (ARCHITECTURE.md 5 章)。

const SCAN_INTERVAL_MS = 30 * 60 * 1000;

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

export async function runFeedScan(deps: FeedAutoScanDeps = defaultDeps): Promise<FeedAutoScanSummary> {
  const summary: FeedAutoScanSummary = { scanned: 0, added: 0, sent: 0, failures: [] };
  // ブラウザを開くので重い。前の回が終わっていなければ見送る
  if (running) return summary;
  running = true;

  try {
    const watches = await deps.listWatches();
    for (const watch of watches) {
      const config = getFeedConfig(watch.id);
      if (!config.enabled) continue;
      // 停止中の監視はスナップショットが増えないので、開くだけ無駄になる
      if (watch.paused) continue;

      try {
        const result = await deps.scan(watch);
        summary.scanned++;
        summary.added += result.added;

        if (!config.autoSend) continue;

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
  setInterval(run, SCAN_INTERVAL_MS);
}
