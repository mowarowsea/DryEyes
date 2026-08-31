import { WatchModel } from './types';

// 未読まわりの判定はカードと一覧の両方で使うため、ここに一本化する。
// 片方だけ直すと「一覧のタブ件数と、カードのバッジが食い違う」ことになるため。

// BFF が付与する未読フラグを優先し、無い場合のみ直近の変更検知にフォールバックする。
// （hasUnviewed を返さない古い BFF のレスポンス向け）
export const isUnviewed = (watch: WatchModel): boolean =>
  watch.hasUnviewed ??
  Boolean(watch.lastChanged && watch.lastChecked && watch.lastChanged >= watch.lastChecked - 60);

// 最後に差分を見てから何回更新されたか。
// 件数を持たない古い BFF では未読の有無しか分からないので 1 / 0 に丸める。
export const unviewedCountOf = (watch: WatchModel): number =>
  watch.unviewedCount ?? (isUnviewed(watch) ? 1 : 0);
