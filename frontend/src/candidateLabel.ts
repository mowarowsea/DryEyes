/**
 * 投入候補の一覧で「どの行がどれか」を見えるようにする。
 *
 * 候補の名前は元テキストそのままなので、同じ作品の一覧では大半が共通になる
 * (`Akuyaku reijo no kyoji v01.rar katfile rapidgator ...` の並び)。
 * 全体を同じ濃さで出すと、実際に違う `v01` / `v02` の 2 文字が埋もれて読み取れない。
 *
 * そこで一覧の中で共通する前後を切り分け、違うところだけを濃く出す。
 * どこが共通かは並んでいるものから決まるので、サイトごとの知識は要らない。
 */

export interface LabelParts {
  /** どの行にも共通する前置き */
  head: string;
  /** 行ごとに違うところ。ここだけ見れば区別が付く */
  body: string;
  /** どの行にも共通する後置き (ミラー名の羅列など) */
  tail: string;
}

// 数文字を薄くしても読みやすさは変わらず、色が飛んで散らかるだけなので畳まない
const MIN_AFFIX = 4;

// 絵文字などで壊れないよう、切るのはコードポイント単位で
const chars = (s: string): string[] => Array.from(s);

const commonPrefix = (rows: string[][]): number => {
  let n = rows[0].length;
  for (const row of rows.slice(1)) {
    let i = 0;
    while (i < n && i < row.length && row[i] === rows[0][i]) i += 1;
    n = i;
  }
  return n;
};

const commonSuffix = (rows: string[][]): number =>
  commonPrefix(rows.map((row) => [...row].reverse()));

/**
 * 並んでいるラベルを head / body / tail に切る。
 *
 * 1 件しかないときや全部が同じ文字列のときは畳まない。畳めるものが無いのに
 * body を空にすると、行から読める字が消えてしまう。
 */
export function splitSharedAffixes(labels: string[]): LabelParts[] {
  const whole = labels.map((label) => ({ head: '', body: label, tail: '' }));
  if (labels.length < 2) return whole;

  const rows = labels.map(chars);
  const shortest = Math.min(...rows.map((row) => row.length));

  let head = commonPrefix(rows);
  if (head >= shortest) return whole; // 全部同じ、または短い行が他の行の頭そのまま
  let tail = commonSuffix(rows);

  // 共通部分が重ならないように。判定に使った最短の行を基準にする
  if (head + tail > shortest) tail = shortest - head;
  if (head < MIN_AFFIX) head = 0;
  if (tail < MIN_AFFIX) tail = 0;

  const parts = rows.map((row) => ({
    head: row.slice(0, head).join(''),
    body: row.slice(head, row.length - tail).join(''),
    tail: tail > 0 ? row.slice(row.length - tail).join('') : '',
  }));

  // 共通部分だけで出来ている行があるなら畳まない。その行から読める字が消えてしまう
  if (parts.some((part) => part.body.length === 0)) return whole;
  return parts;
}
