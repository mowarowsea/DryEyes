import React from 'react';
import { BookMarked } from 'lucide-react';
import { WorkGroup, unviewedTotalOf } from '../watchGroup';

interface WorkGroupCardProps {
  group: WorkGroup;
  children: React.ReactNode;
}

/**
 * 同じ作品を追いかけている監視をひとまとめにする枠。
 *
 * 中身は普通の監視カードのまま。1 サイトごとにチェックも停止も削除もできる必要があるので、
 * まとめても各カードの操作は畳まない。まとめるのは「どれが同じ作品か」を見せるためで、
 * 操作を減らすためではない。
 *
 * 1 件しか無い作品はこの枠を使わない (WatchList 側で素のカードを出す) —
 * 全部に見出しが付くと、まとまっていること自体が見えなくなる。
 */
export const WorkGroupCard: React.FC<WorkGroupCardProps> = ({ group, children }) => {
  const unviewed = unviewedTotalOf(group);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-2">
      <header className="flex items-center gap-2 px-1.5 pb-2">
        <BookMarked className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
        <div className="min-w-0 flex items-baseline gap-2">
          <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{group.title}</h3>
          {group.author && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{group.author}</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {unviewed > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
              {unviewed}
            </span>
          )}
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{group.watches.length} サイト</span>
        </div>
      </header>

      <div className="space-y-2">{children}</div>
    </section>
  );
};
