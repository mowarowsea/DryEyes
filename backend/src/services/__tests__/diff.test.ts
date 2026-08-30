import { describe, it, expect } from 'vitest';
import { diffSnapshots, splitSnapshotLines } from '../diff.js';

describe('splitSnapshotLines', () => {
  it('should normalize newlines and drop blank lines', () => {
    expect(splitSnapshotLines('a\r\n\r\nb  \n\n  \nc')).toEqual(['a', 'b', 'c']);
  });

  it('should tolerate empty input', () => {
    expect(splitSnapshotLines('')).toEqual([]);
  });
});

describe('diffSnapshots', () => {
  it('should report added lines when new items appear at the top', () => {
    const before = ['第110話', '第109話', '第108話'].join('\n');
    const after = ['第112話', '第111話', '第110話', '第109話', '第108話'].join('\n');

    const result = diffSnapshots(before, after);

    expect(result.added).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.lines.filter((l) => l.type === 'added').map((l) => l.text)).toEqual([
      '第112話',
      '第111話',
    ]);
  });

  it('should report removed lines', () => {
    const result = diffSnapshots('在庫あり\n5,000円', '5,000円');

    expect(result.removed).toBe(1);
    expect(result.added).toBe(0);
    expect(result.lines.find((l) => l.type === 'removed')?.text).toBe('在庫あり');
  });

  it('should report a replacement as one removal plus one addition', () => {
    const result = diffSnapshots('価格: 5,000円', '価格: 4,500円');

    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });

  it('should return no lines when nothing changed', () => {
    const snapshot = ['a', 'b', 'c'].join('\n');
    const result = diffSnapshots(snapshot, snapshot);

    expect(result.lines).toEqual([]);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
  });

  it('should collapse far-away unchanged lines into a gap marker', () => {
    const filler = Array.from({ length: 40 }, (_, i) => `line-${i}`);
    const before = ['old-head', ...filler, 'old-tail'].join('\n');
    const after = ['new-head', ...filler, 'new-tail'].join('\n');

    const result = diffSnapshots(before, after);
    const gap = result.lines.find((l) => l.type === 'gap');

    // 変更の前後 2 行だけ残り、間の 36 行は 1 つの gap にまとまる
    expect(gap).toBeDefined();
    expect(gap!.count).toBe(filler.length - 4);
    expect(result.lines.filter((l) => l.type === 'context')).toHaveLength(4);
  });

  it('should truncate very large diffs and flag them', () => {
    const before = Array.from({ length: 1000 }, (_, i) => `before-${i}`).join('\n');
    const after = Array.from({ length: 1000 }, (_, i) => `after-${i}`).join('\n');

    const result = diffSnapshots(before, after);

    expect(result.truncated).toBe(true);
    expect(result.lines.length).toBeLessThanOrEqual(400);
    // 打ち切っても件数は全体の実数を返す
    expect(result.added).toBe(1000);
    expect(result.removed).toBe(1000);
  });

  it('should still detect changes when the snapshots are too large for the LCS matrix', () => {
    // 先頭・末尾を削っても DP 上限 (1500x1500 相当) を超えるサイズにする
    const common = Array.from({ length: 1600 }, (_, i) => `line-${i}`);
    const before = ['first-before', ...common, 'last-before'].join('\n');
    const after = ['first-after', ...common, 'last-after'].join('\n');

    const result = diffSnapshots(before, after);

    // 近似差分でも「相手側に無い行」は追加/削除として拾える
    expect(result.added).toBe(2);
    expect(result.removed).toBe(2);
    expect(result.lines.some((l) => l.type === 'added' && l.text === 'first-after')).toBe(true);
    expect(result.lines.some((l) => l.type === 'removed' && l.text === 'last-before')).toBe(true);
  });
});
