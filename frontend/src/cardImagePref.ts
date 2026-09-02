// 監視カードの背景に絵を敷くかどうか。
// 見た目の好みで、しかも端末ごとに変えたい設定なので、テーマと同じく localStorage に持つ
// （サーバーには置かない）。既定は表示する。

const STORAGE_KEY = 'dryeyes.cardImage';

export function getStoredCardImageEnabled(): boolean {
  try {
    // 明示的に切った記録があるときだけ隠す
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    /* プライベートウィンドウなどで読めない場合は既定に従う */
    return true;
  }
}

export function storeCardImageEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* 保存できなくてもセッション中は切り替わったままにする */
  }
}
