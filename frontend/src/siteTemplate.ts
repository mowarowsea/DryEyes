import { WatchModel } from './types';

// 同じサイトの他の監視が見ている場所を、新しく登録する監視の候補にする。
//
// 同じサイトのページは作りが揃っているので、監視場所（XPath）もたいてい同じになる。
// それを毎回ピッカーでタップし直すのは無駄なので、既存の監視から引き継げるようにする。
// 候補はあくまで候補で、このページに当たるかはピッカーが実際のページで確かめる。

export interface SiteTemplate {
  /** 見つけたサイト（先頭の www. を除いたホスト名） */
  host: string;
  includeFilters: string[];
  subtractedFilters: string[];
  /** 同じ場所を見ている監視の数 */
  count: number;
  /** 見本にした監視。取得方法・間隔・投入設定もここから引き継ぐ */
  sample: WatchModel;
}

// 先頭の www. の有無だけは同じサイトとして扱う。それ以外のサブドメインは別サイト。
const baseHostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

// 同じ値で群れを作り、いちばん大きい群れを返す
function largestGroup<T>(items: T[], keyOf: (item: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  let best: T[] = [];
  for (const group of groups.values()) {
    if (group.length > best.length) best = group;
  }
  return best;
}

/**
 * url と同じサイトの監視から、最も多く使われている監視場所を返す。
 * ページ全体を見ている監視（includeFilters が空）は、引き継ぐ場所を持たないので数えない。
 */
export function suggestSiteTemplate(url: string, watches: WatchModel[]): SiteTemplate | null {
  const host = baseHostOf(url);
  if (!host) return null;

  const sameSite = watches.filter(
    (w) => w.includeFilters.length > 0 && baseHostOf(w.url) === host
  );
  if (sameSite.length === 0) return null;

  const best = largestGroup(sameSite, (w) => JSON.stringify(w.includeFilters));
  // 除外も、その場所を見ている監視の中で最も多い組み合わせに揃える
  const subtracted = largestGroup(best, (w) => JSON.stringify(w.subtractedFilters));

  return {
    host,
    includeFilters: [...best[0].includeFilters],
    subtractedFilters: [...subtracted[0].subtractedFilters],
    count: best.length,
    // ダウンロードに繋がっている監視があればそれを見本にする (投入先ごと引き継げる)
    sample: best.find((w) => (w.feed?.userId ?? null) !== null) ?? best[0],
  };
}
