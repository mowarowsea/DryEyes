import React from 'react';
import { DiffLine } from '../types';

interface DiffLinesProps {
  lines: DiffLine[];
  /** 行数の上限で途中までしか無いか */
  truncated?: boolean;
}

// 行単位の差分（追加=緑 / 削除=赤 / 離れた変更なし行は点線の帯にまとめる）。
// 変更点モーダルと変更履歴の両方で同じ見た目にするため、ここに一本化する。
export const DiffLines: React.FC<DiffLinesProps> = ({ lines, truncated = false }) => (
  <div className="px-2 sm:px-3 py-3">
    <div className="font-mono text-[11px] sm:text-xs leading-relaxed">
      {lines.map((line, idx) => {
        if (line.type === 'gap') {
          return (
            <div
              key={idx}
              className="my-1 py-1 text-center text-[10px] text-slate-400 dark:text-slate-500 bg-slate-50/80 dark:bg-slate-800/60 border-y border-dashed border-slate-200 dark:border-slate-700"
            >
              変更なし {line.count} 行
            </div>
          );
        }

        const style =
          line.type === 'added'
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-l-2 border-emerald-400 dark:border-emerald-500'
            : line.type === 'removed'
              ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-200 border-l-2 border-rose-400 dark:border-rose-500'
              : 'text-slate-500 dark:text-slate-400 border-l-2 border-transparent';
        const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

        return (
          <div key={idx} className={`flex px-1.5 py-0.5 rounded-r ${style}`}>
            <span className="w-3 flex-shrink-0 select-none opacity-70">{marker}</span>
            <span className="flex-1 whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        );
      })}
    </div>

    {truncated && (
      <p className="mt-2 mx-1.5 text-[10px] text-amber-600 dark:text-amber-400">
        変更が多いため、途中までを表示しています。
      </p>
    )}
  </div>
);
