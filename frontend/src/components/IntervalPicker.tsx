import React from 'react';
import { ChevronDown } from 'lucide-react';
import { choiceButtonClass, inputClass, selectClass } from '../ui';

// チェック間隔のプリセット。登録画面と設定変更画面の両方で同じ選択肢を出す。
// （片方だけに項目を足すと、登録した間隔が編集画面で選び直せなくなる）
export const INTERVAL_PRESETS: { label: string; value: number }[] = [
  { label: '5分', value: 5 },
  { label: '10分', value: 10 },
  { label: '30分', value: 30 },
  { label: '1時間', value: 60 },
  { label: '6時間', value: 360 },
  { label: '24時間', value: 1440 },
];

interface IntervalPickerProps {
  value: number;
  onChange: (minutes: number) => void;
}

export const IntervalPicker: React.FC<IntervalPickerProps> = ({ value, onChange }) => (
  <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
    {INTERVAL_PRESETS.map((preset) => (
      <button
        key={preset.value}
        type="button"
        onClick={() => onChange(preset.value)}
        className={choiceButtonClass(value === preset.value)}
      >
        {preset.label}
      </button>
    ))}
  </div>
);

// 設定変更画面のように縦の余白を詰めたい場所で使う、同じ選択肢のセレクト版。
// プリセットに無い値（登録後に自由入力で決めた間隔など）はそのまま数値入力に落とす。
const CUSTOM = 'custom';

export const IntervalSelect: React.FC<IntervalPickerProps> = ({ value, onChange }) => {
  const [isCustom, setIsCustom] = React.useState(
    () => !INTERVAL_PRESETS.some((preset) => preset.value === value)
  );

  return (
    <div className="flex items-center gap-2">
      <div className={`relative min-w-0 ${isCustom ? 'w-32 flex-shrink-0' : 'flex-1'}`}>
        <select
          aria-label="チェック間隔"
          value={isCustom ? CUSTOM : String(value)}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setIsCustom(true);
              return;
            }
            setIsCustom(false);
            onChange(Number(e.target.value));
          }}
          className={selectClass}
        >
          {INTERVAL_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}ごと
            </option>
          ))}
          <option value={CUSTOM}>分を指定...</option>
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {isCustom && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input
            type="number"
            min={1}
            aria-label="チェック間隔（分）"
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className={`${inputClass} min-w-0`}
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap flex-shrink-0">
            分ごと
          </span>
        </div>
      )}
    </div>
  );
};
