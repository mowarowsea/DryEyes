// 画面をまたいで使い回す Tailwind クラス。
// 同じ見た目の入力欄・ボタンがモーダルごとにコピーされていると、余白や色を直したときに
// 直し漏れた画面だけ浮いてしまうため、見た目の定義はここに集約する。

// 設定編集など、項目数が多く密度を上げたい欄
export const inputClass =
  'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

// XPath / トピック名など、等幅で読みたい欄
export const monoInputClass = `${inputClass} font-mono`;

// 登録ウィザードのように、1 画面に数項目しか置かない欄
export const largeInputClass =
  'w-full px-3.5 py-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition shadow-sm';

// 選択肢ボタン（チェック間隔のプリセット、コピー先ユーザーなど）。
// 横幅は使う側で決められるよう、padding は縦だけ持たせる。
export const choiceButtonClass = (selected: boolean): string =>
  `py-2 text-xs font-medium rounded-lg border transition ${
    selected
      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
  }`;

// モーダル下部の「キャンセル」
export const cancelButtonClass =
  'px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition';

// モーダル下部の主ボタン（登録する／保存する／コピーを作成）
export const submitButtonClass =
  'px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition rounded-xl shadow-sm shadow-indigo-200 dark:shadow-none flex items-center gap-1.5';

// セレクトボックス。入力欄と同じ枠に、右端の矢印ぶんだけ余白を足したもの
export const selectClass = `${inputClass} pr-8 appearance-none cursor-pointer`;
