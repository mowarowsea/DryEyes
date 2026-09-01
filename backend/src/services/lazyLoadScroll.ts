/**
 * ページを少しずつ末尾までスクロールして、遅延読み込みの中身を起こすスクリプト。
 *
 * 少年ジャンプ＋の話数一覧のように、要素が画面内に入って初めて（IntersectionObserver で）
 * 中身を取りに行くページがある。末尾へ一気に飛ぶと途中の要素を跨いでしまって観測されないため、
 * 1 画面ぶんずつ刻んで、間に描画の猶予を挟みながら降りていく。
 *
 * ピッカーの描画と、changedetection.io のクロール（webdriver_js_execute_code）の両方で使う。
 * 片方だけ動かすと「ピッカーでは選べるのにクロールでは見えない」ズレが生まれるため、
 * 同じ 1 つのスクリプトを共有する。
 *
 * 文字列を渡した evaluate は「式」として評価されるだけで関数を呼んではくれないので、
 * その場で呼び切る形（即時実行）で書いてある。
 */
export const LAZY_LOAD_SCROLL_JS = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 1 回の移動は画面の高さより必ず狭くする。画面より広く飛ばすと、間にある要素が
  // 一度も画面へ入らないまま通り過ぎてしまい、遅延読み込みが起きない。
  const step = Math.max(200, Math.round(window.innerHeight * 0.8));
  let last = -1;
  let stalled = 0;
  for (let i = 1; i <= 60; i++) {
    window.scrollTo(0, step * i);
    await sleep(200);
    // 読み込みでページが伸びる間は降り続け、伸びなくなったら 2 回待って打ち切る
    if (window.scrollY === last) {
      if (++stalled >= 2) break;
    } else {
      stalled = 0;
    }
    last = window.scrollY;
  }
  window.scrollTo(0, 0);
  await sleep(300);
})()`;
