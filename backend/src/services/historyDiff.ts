import { diffSnapshots, splitSnapshotLines } from './diff.js';
import { HistoryDiffResponse, WatchHistoryItem } from '../types/index.js';

// 変更履歴の 1 件分の差分。
//
// 変更点モーダルは「前回見てから最新まで」をまとめて見せるが、履歴では
// 「その回に何が変わったか」を 1 回ずつ見たい。比較相手はその直前のスナップショット。

// 初回スナップショット（比較相手が無い）のときに返す内容の行数
const PREVIEW_LINES = 30;

// changedetection クライアントのうち、ここで使う 2 つだけを切り出した形。
// テストでは本物のクライアントを立てずに差し替える。
export interface SnapshotSource {
  /** 新しい順 */
  getHistory(watchId: string): Promise<WatchHistoryItem[]>;
  getSnapshot(watchId: string, timestamp: number): Promise<string>;
}

/**
 * timestamp のスナップショットを、その直前のスナップショットと比べる。
 * timestamp が履歴に無ければ null。最初のスナップショットは比べる相手が無いので、
 * 差分の代わりに内容の先頭を snapshotPreview で返す。
 */
export async function buildHistoryDiff(
  source: SnapshotSource,
  watchId: string,
  timestamp: number
): Promise<HistoryDiffResponse | null> {
  const history = await source.getHistory(watchId);
  const index = history.findIndex((item) => item.timestamp === timestamp);
  if (index < 0) return null;

  // 新しい順なので、直前のスナップショットは 1 つ後ろ
  const previous = history[index + 1];
  if (!previous) {
    const current = await source.getSnapshot(watchId, timestamp);
    return {
      watchId,
      from: null,
      to: timestamp,
      lines: [],
      added: 0,
      removed: 0,
      truncated: false,
      snapshotPreview: splitSnapshotLines(current).slice(0, PREVIEW_LINES),
    };
  }

  const [before, after] = await Promise.all([
    source.getSnapshot(watchId, previous.timestamp),
    source.getSnapshot(watchId, timestamp),
  ]);

  return {
    watchId,
    from: previous.timestamp,
    to: timestamp,
    ...diffSnapshots(before, after),
  };
}
