import React from 'react';
import { choiceButtonClass } from '../ui';

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
