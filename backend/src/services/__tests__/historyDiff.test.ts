import { describe, it, expect, vi } from 'vitest';
import { buildHistoryDiff, SnapshotSource } from '../historyDiff.js';

// 3 回ぶんのスナップショット（新しい順）。話数一覧が 1 話ずつ増えていった体。
const snapshots: Record<number, string> = {
  300: '第3話\n第2話\n第1話',
  200: '第2話\n第1話',
  100: '第1話',
};

const source = (): SnapshotSource & { getSnapshot: ReturnType<typeof vi.fn> } => ({
  getHistory: vi.fn().mockResolvedValue([
    { timestamp: 300, snapshotId: 'c' },
    { timestamp: 200, snapshotId: 'b' },
    { timestamp: 100, snapshotId: 'a' },
  ]),
  getSnapshot: vi.fn(async (_id: string, ts: number) => snapshots[ts]),
});

describe('buildHistoryDiff', () => {
  it('そのスナップショットを直前のものと比べる', async () => {
    const result = await buildHistoryDiff(source(), 'w', 200);

    expect(result).toMatchObject({ watchId: 'w', from: 100, to: 200, added: 1, removed: 0 });
    expect(result!.lines.filter((l) => l.type === 'added').map((l) => l.text)).toEqual(['第2話']);
  });

  it('最新のスナップショットも同じ要領で比べられる', async () => {
    const result = await buildHistoryDiff(source(), 'w', 300);

    expect(result).toMatchObject({ from: 200, to: 300, added: 1 });
    expect(result!.lines.filter((l) => l.type === 'added').map((l) => l.text)).toEqual(['第3話']);
  });

  it('最初のスナップショットは比べる相手が無いので、内容の先頭を返す', async () => {
    const src = source();
    const result = await buildHistoryDiff(src, 'w', 100);

    expect(result).toMatchObject({ from: null, to: 100, lines: [], added: 0, removed: 0 });
    expect(result!.snapshotPreview).toEqual(['第1話']);
    // 比べる相手が無いぶん、取りに行くスナップショットも 1 つで済む
    expect(src.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('履歴に無い時刻なら null', async () => {
    expect(await buildHistoryDiff(source(), 'w', 999)).toBeNull();
  });
});
