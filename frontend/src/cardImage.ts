import { CardImageCrop } from './types';

// カード背景の「どこを切り抜いて敷くか」を扱う。
//
// 切り抜きは画像そのものには焼き込まず、割合 (0..1) のまま持って表示時に当てる。
// 敷く箱の大きさは端末の幅で変わるうえ、エラー帯や移転の確認が出れば同じ端末でも
// カードの高さが変わるため、あらかじめ切った絵では毎回どこかが合わなくなる。

// 絵を敷くのはカードの右側だけ。左半分は文字の下なので絵を置かない。
//
// 幅を絞るのは見た目のためだけではない。background-size: cover は「この箱を覆う」
// 倍率まで拡大するので、カード全幅の箱に縦長の表紙を敷くと拡大率が上がりすぎて、
// 絵の真ん中の細い帯しか出てこない。実際に見せる幅の箱に絞れば、その分だけ
// 縮小されて絵が広く入る。
export const CARD_IMAGE_WIDTH = '58%';

// レイヤーの左端から右端へ向かってはっきりさせる（右端がいちばん濃い）
export const CARD_IMAGE_MASK =
  'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.3) 32%, rgba(0,0,0,0.72) 68%, #000 100%)';

/** 画像に添えて返ってくる切り抜き指定（`x,y,幅,高さ,元画像の縦横比`）を読む。 */
export function parseCropHeader(value: string | null | undefined): CardImageCrop | null {
  if (!value) return null;
  const parts = value.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 5 || parts.some((v) => !Number.isFinite(v))) return null;

  const [x, y, width, height, ratio] = parts;
  if (width <= 0 || height <= 0 || ratio <= 0) return null;
  return { x, y, width, height, ratio };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * 切り抜いた範囲を、指定した箱に敷くための background-size / position。
 *
 * 「切り抜いた範囲がこの箱を覆う最小の倍率」まで拡大し、その中心を箱の中心に合わせる。
 * 箱の縦横比は切り抜きのときと必ずしも一致しない（カードの高さは中身で変わる）ので、
 * 範囲をそのまま引き伸ばすと絵がゆがむ。覆う方に倒せば、はみ出す分が増えるだけで済む。
 */
export function cropBackgroundStyle(
  crop: CardImageCrop,
  boxWidth: number,
  boxHeight: number
): { backgroundSize: string; backgroundPosition: string } {
  // 元画像を何ピクセルで描くか。切り抜き範囲が箱の幅・高さを満たす方に合わせる。
  const width = Math.max(boxWidth / crop.width, (boxHeight / crop.height) * crop.ratio);
  const height = width / crop.ratio;

  // 切り抜きの中心を箱の中心へ。はみ出す量を超えてずらすと隙間ができるので、そこで止める。
  const left = clamp(boxWidth / 2 - (crop.x + crop.width / 2) * width, boxWidth - width, 0);
  const top = clamp(boxHeight / 2 - (crop.y + crop.height / 2) * height, boxHeight - height, 0);

  // 端数はここで落とす。1px の 100 分の 1 まであれば見た目には十分で、
  // 測り直すたびに末尾だけ違う値を書き込んで再描画させても得るものがない。
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    backgroundSize: `${round(width)}px ${round(height)}px`,
    backgroundPosition: `${round(left)}px ${round(top)}px`,
  };
}

/**
 * 切り抜きを指定していないときと同じ見え方になる範囲。
 * つまり background-size: cover / position: center で出る範囲そのもの。
 *
 * 切り抜き画面の初期値に使う。開いた直後に絵が動かないので、
 * 「今の見え方から、どこをどう動かすか」として調整できる。
 */
export function coverCrop(imageRatio: number, boxRatio: number): CardImageCrop {
  // 箱より横長の絵は幅が余り、縦長の絵は高さが余る
  const width = imageRatio > boxRatio ? boxRatio / imageRatio : 1;
  const height = imageRatio > boxRatio ? 1 : imageRatio / boxRatio;
  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
    ratio: imageRatio,
  };
}

/**
 * 切り抜き範囲の大きさを変える（拡大・縮小）。中心は動かさない。
 *
 * scale は「箱いっぱいに見せる範囲」に対する倍率で、1 が既定（＝今までの見え方）。
 * 小さくするほど絵の一部を大きく映すことになる。
 */
export function resizeCrop(crop: CardImageCrop, boxRatio: number, scale: number): CardImageCrop {
  const full = coverCrop(crop.ratio, boxRatio);
  const factor = clamp(scale, 0.2, 1);
  const width = full.width * factor;
  const height = full.height * factor;

  return {
    ...crop,
    width,
    height,
    x: clamp(crop.x + crop.width / 2 - width / 2, 0, 1 - width),
    y: clamp(crop.y + crop.height / 2 - height / 2, 0, 1 - height),
  };
}

/** 切り抜き範囲を動かす（元画像に対する割合で受け取り、はみ出さない位置に収める）。 */
export function moveCrop(crop: CardImageCrop, x: number, y: number): CardImageCrop {
  return {
    ...crop,
    x: clamp(x, 0, 1 - crop.width),
    y: clamp(y, 0, 1 - crop.height),
  };
}
