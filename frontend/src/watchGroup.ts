import { WatchModel } from './types';

// 一覧の仕分け。2 つの軸がある。
//
//   1. Web 監視 / ダウンロード監視 — 目的が違うので、そもそも別の一覧として切り替える
//   2. 同じ作品の監視をまとめる     — 1 作品を複数サイトで追いかけるため、散らばると探せない
//
// どちらも「投入設定 (watch.feed)」から決まる。監視に別の属性を足していないのは、
// 投入先を選んだ時点で「この監視はダウンロードに繋ぐ」という意思表示になっているから
// (ARCHITECTURE.md 5 章)。

export type ListMode = 'web' | 'download';

const MODE_STORAGE_KEY = 'dryeyes.listMode';

/**
 * ダウンロード投入に繋がっている監視か。
 * 投入先ユーザーが決まっていることを印にする — PowerDowner 側の定期巡回と同じ判定。
 */
export function isDownloadWatch(watch: WatchModel): boolean {
  return (watch.feed?.userId ?? null) !== null;
}

export function modeOf(watch: WatchModel): ListMode {
  return isDownloadWatch(watch) ? 'download' : 'web';
}

/**
 * 作品をまとめるキー。
 *
 * PowerDowner の seriesKey と同じ考え方で、記号と空白を落としてから比べる —
 * 画面上のまとまりと、向こうの重複判定の単位がずれると混乱する。
 * ただしこちらは表示のためだけなので、巻数を落とすところまではやらない
 * (作品タイトルは人が入れた値で、巻数は入っていない)。
 */
export function workKeyOf(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　_\-‐–—~〜・,.、。!?！？'"“”‘’()（）[\]{}【】「」『』:：;；|/\\]/g, '')
    .trim();
}

export interface WorkGroup {
  /** まとめの識別子。作品名が無い監視は自分の id で 1 件のまとまりになる */
  key: string;
  /** 見出しに出す作品名。設定が無ければ監視のタイトル */
  title: string;
  author: string | null;
  watches: WatchModel[];
}

/**
 * 同じ作品名の監視を 1 つにまとめる。
 *
 * 渡された並び順は崩さない。まとまりの位置は、その作品の最初の 1 件が居た場所になる —
 * 並び替えを選んでいるのに、まとめた途端に順番が変わると何で並んでいるのか分からなくなる。
 *
 * 作品名を入れていない監視は、他とまとめずに 1 件のまとまりとして残す。
 * 空文字どうしを一致とみなすと、設定途中のものが全部 1 枚に吸い込まれてしまう。
 */
export function groupByWork(watches: WatchModel[]): WorkGroup[] {
  const groups: WorkGroup[] = [];
  const byKey = new Map<string, WorkGroup>();

  for (const watch of watches) {
    const title = watch.feed?.title?.trim() || '';
    const key = title ? `work:${workKeyOf(title)}` : `watch:${watch.id}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.watches.push(watch);
      // 先頭の監視に作者が入っていないこともあるので、後から出てきたぶんで埋める
      existing.author = existing.author ?? watch.feed?.author ?? null;
      continue;
    }

    const group: WorkGroup = {
      key,
      title: title || watch.title,
      author: watch.feed?.author ?? null,
      watches: [watch],
    };
    byKey.set(key, group);
    groups.push(group);
  }

  return groups;
}

/** 未読の合計。まとまりの見出しに出す */
export function unviewedTotalOf(group: WorkGroup): number {
  return group.watches.reduce((sum, w) => sum + (w.unviewedCount ?? (w.hasUnviewed ? 1 : 0)), 0);
}

/** 前回どちらの一覧を見ていたか。片方しか使わない日が続くので覚えておく */
export function getStoredMode(): ListMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'download' ? 'download' : 'web';
  } catch {
    return 'web';
  }
}

export function storeMode(mode: ListMode): void {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* プライベートウィンドウなどで書けないことがある。覚えられないだけなので無視する */
  }
}
