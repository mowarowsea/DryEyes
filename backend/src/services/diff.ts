import { DiffLine, DiffResult } from '../types/index.js';

// LCS の DP テーブルを張れる上限。これを超えるスナップショットは近似差分に切り替える。
// (1500 x 1500 で Int32Array 約 9MB)
const MAX_MATRIX_CELLS = 2_250_000;

// 変更行の前後に残す「変更なし」行数
const CONTEXT_LINES = 2;

// 画面に返す最大行数。超えた分は truncated として切り捨てる。
const MAX_OUTPUT_LINES = 400;

// スナップショットは行単位のテキスト。空行は差分の意味を持たないうえ
// ノイズになるだけなので落としてから比較する。
export function splitSnapshotLines(text: string): string[] {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

// 2つのスナップショットの行差分を取る。
// 追加/削除の周辺だけを残し、離れた「変更なし」行は gap にまとめる。
export function diffSnapshots(before: string, after: string): DiffResult {
  return diffLineArrays(splitSnapshotLines(before), splitSnapshotLines(after));
}

export function diffLineArrays(a: string[], b: string[]): DiffResult {
  // 先頭・末尾の一致部分は比較対象から外して DP を小さくする
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;

  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const middle =
    (midA.length + 1) * (midB.length + 1) <= MAX_MATRIX_CELLS
      ? lcsDiff(midA, midB)
      : approximateDiff(midA, midB);

  const raw: DiffLine[] = [
    ...a.slice(0, head).map(toContext),
    ...middle,
    ...a.slice(a.length - tail).map(toContext),
  ];

  const added = raw.filter((l) => l.type === 'added').length;
  const removed = raw.filter((l) => l.type === 'removed').length;
  const { lines, truncated } = compress(raw);

  return { lines, added, removed, truncated };
}

function toContext(text: string): DiffLine {
  return { type: 'context', text };
}

// 最長共通部分列による正確な差分
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: 'added' as const, text }));
  if (m === 0) return a.map((text) => ({ type: 'removed' as const, text }));

  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
      out.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      out.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: 'removed', text: a[i++] });
  while (j < m) out.push({ type: 'added', text: b[j++] });
  return out;
}

// 巨大なスナップショット向けの近似。行の並びは厳密に追わず、
// 「相手側に無い行」を削除/追加として拾うだけに留める。
function approximateDiff(a: string[], b: string[]): DiffLine[] {
  const inB = new Set(b);
  const inA = new Set(a);
  return [
    ...a.map((text): DiffLine => (inB.has(text) ? { type: 'context', text } : { type: 'removed', text })),
    ...b.filter((text) => !inA.has(text)).map((text): DiffLine => ({ type: 'added', text })),
  ];
}

// 変更箇所から離れた「変更なし」行を gap にまとめ、出力行数を抑える
function compress(raw: DiffLine[]): { lines: DiffLine[]; truncated: boolean } {
  const changed = raw.map((l) => l.type === 'added' || l.type === 'removed');
  if (!changed.some(Boolean)) return { lines: [], truncated: false };

  const keep = raw.map((_, idx) => {
    if (changed[idx]) return true;
    for (let d = 1; d <= CONTEXT_LINES; d++) {
      if (changed[idx - d] || changed[idx + d]) return true;
    }
    return false;
  });

  const lines: DiffLine[] = [];
  let gap = 0;
  const flushGap = () => {
    if (gap > 0) lines.push({ type: 'gap', text: '', count: gap });
    gap = 0;
  };

  for (let idx = 0; idx < raw.length; idx++) {
    if (keep[idx]) {
      flushGap();
      lines.push(raw[idx]);
    } else {
      gap++;
    }
  }
  flushGap();

  if (lines.length > MAX_OUTPUT_LINES) {
    return { lines: lines.slice(0, MAX_OUTPUT_LINES), truncated: true };
  }
  return { lines, truncated: false };
}
