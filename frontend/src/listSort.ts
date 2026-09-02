import { WatchModel } from './types';
import { unviewedCountOf } from './watchStatus';

// 一覧の並び替え。フィルタ（WatchList のタブ）と組み合わせて使う。

export type SortKey = 'updated' | 'unviewed' | 'checked' | 'title';
export type SortDirection = 'desc' | 'asc';

export interface SortOrder {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortOrder = { key: 'updated', direction: 'desc' };

// 並び順のラベル。「降順・昇順」だけだと何が上に来るのか分からないため、
// 項目ごとに実際の並びが分かる言い方を持たせる。
// defaultDirection は、その項目に切り替えたときにまず出したい向き
// （日付や未読は多い / 新しいほうから、タイトルだけは五十音の頭から）。
export const SORT_OPTIONS: {
  key: SortKey;
  label: string;
  desc: string;
  asc: string;
  defaultDirection: SortDirection;
}[] = [
  { key: 'updated', label: '更新日時', desc: '新しい順', asc: '古い順', defaultDirection: 'desc' },
  { key: 'unviewed', label: '未読の数', desc: '多い順', asc: '少ない順', defaultDirection: 'desc' },
  { key: 'checked', label: '確認日時', desc: '新しい順', asc: '古い順', defaultDirection: 'desc' },
  { key: 'title', label: 'タイトル', desc: 'わ→あ', asc: 'あ→わ', defaultDirection: 'asc' },
];

export const sortOptionOf = (key: SortKey) =>
  SORT_OPTIONS.find((o) => o.key === key) ?? SORT_OPTIONS[0];

// 並び順の短い説明（「更新日時 / 新しい順」）
export const describeSort = ({ key, direction }: SortOrder): string => {
  const option = sortOptionOf(key);
  return `${option.label} / ${direction === 'desc' ? option.desc : option.asc}`;
};

// 昇順としての比較。降順は結果を反転させるだけにして、条件分岐を二重に持たない。
// 未取得（null）は -1 として扱うので、降順では常に最後にまとまる。
const compareAsc = (a: WatchModel, b: WatchModel, key: SortKey): number => {
  switch (key) {
    case 'unviewed':
      return unviewedCountOf(a) - unviewedCountOf(b);
    case 'checked':
      return (a.lastChecked ?? -1) - (b.lastChecked ?? -1);
    case 'title':
      return a.title.localeCompare(b.title, 'ja');
    case 'updated':
    default:
      return (a.lastChanged ?? -1) - (b.lastChanged ?? -1);
  }
};

// 同点のときは id で固定する。裏の自動更新が走るたびに同点同士が入れ替わると、
// 見ている最中にカードの位置が動いてしまう。
export const sortWatches = (watches: WatchModel[], { key, direction }: SortOrder): WatchModel[] =>
  [...watches].sort((a, b) => {
    const diff = compareAsc(a, b, key);
    if (diff !== 0) return direction === 'desc' ? -diff : diff;
    return a.id.localeCompare(b.id);
  });

// 並び順は端末ごとの好みなので、次に開いたときも同じ並びで出す。
const STORAGE_KEY = 'dryeyes.sort';

const isSortKey = (v: unknown): v is SortKey => SORT_OPTIONS.some((o) => o.key === v);

export const getStoredSort = (): SortOrder => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw);
    if (!isSortKey(parsed?.key)) return DEFAULT_SORT;
    return {
      key: parsed.key,
      direction: parsed.direction === 'asc' ? 'asc' : 'desc',
    };
  } catch {
    return DEFAULT_SORT;
  }
};

export const storeSort = (order: SortOrder): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    /* 保存できなくてもその場の並び替えは効く */
  }
};
