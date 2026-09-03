import { describe, it, expect } from 'vitest';
import {
  coverCrop,
  cropBackgroundStyle,
  moveCrop,
  parseCropHeader,
  resizeCrop,
} from '../cardImage';

// 切り抜きは「元画像に対する割合」で持ち、敷くときに箱の実寸へ戻す。
// 箱の大きさは端末やカードの中身で変わるので、この変換がずれると
// 選んだ範囲と実際に出る範囲が食い違う。

describe('parseCropHeader', () => {
  it('画像に添えて返る指定を読む', () => {
    expect(parseCropHeader('0.10000,0.20000,0.50000,0.25000,1.50000')).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.25,
      ratio: 1.5,
    });
  });

  it('指定が無い・壊れているときは切り抜きなしとして扱う', () => {
    expect(parseCropHeader(null)).toBeNull();
    expect(parseCropHeader('')).toBeNull();
    expect(parseCropHeader('0.1,0.2,0.5')).toBeNull();
    expect(parseCropHeader('0.1,0.2,0.5,0.25,abc')).toBeNull();
    // 大きさが 0 の範囲は敷きようがない
    expect(parseCropHeader('0,0,0,0.2,1')).toBeNull();
  });
});

describe('coverCrop', () => {
  // 切り抜きを指定していないカードは cover / center で敷かれる。
  // 調整の起点が今の見え方と一致していないと、開いた瞬間に絵が飛ぶ。
  it('縦長の絵では、幅いっぱいの帯が真ん中に来る', () => {
    const crop = coverCrop(0.7, 7); // 縦長の表紙を横長の帯に敷く
    expect(crop.width).toBe(1);
    expect(crop.height).toBeCloseTo(0.1, 5);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo(0.45, 5);
  });

  it('箱より横長の絵では、高さいっぱいの範囲が真ん中に来る', () => {
    const crop = coverCrop(14, 7);
    expect(crop.height).toBe(1);
    expect(crop.width).toBeCloseTo(0.5, 5);
    expect(crop.x).toBeCloseTo(0.25, 5);
    expect(crop.y).toBe(0);
  });
});

describe('cropBackgroundStyle', () => {
  it('切り抜きなしと同じ範囲を指定すると、cover / center と同じ敷き方になる', () => {
    // 700x100 の箱に、縦長 (0.7) の絵
    const style = cropBackgroundStyle(coverCrop(0.7, 7), 700, 100);
    expect(style.backgroundSize).toBe('700px 1000px');
    // 縦にはみ出す 900px の半分だけ上へずらす＝真ん中
    expect(style.backgroundPosition).toBe('0px -450px');
  });

  it('上を選べば絵の上が出る', () => {
    const style = cropBackgroundStyle({ x: 0, y: 0, width: 1, height: 0.1, ratio: 0.7 }, 700, 100);
    expect(style.backgroundPosition).toBe('0px 0px');
  });

  it('端を越えてずらしても、箱に隙間ができるところでは止める', () => {
    // 絵の下端ぎりぎりを選んでも、下に余白が出る位置までは動かさない
    const style = cropBackgroundStyle({ x: 0, y: 0.9, width: 1, height: 0.1, ratio: 0.7 }, 700, 100);
    expect(style.backgroundPosition).toBe('0px -900px');
  });

  it('箱の縦横比が切り抜きとずれても、引き伸ばさず覆う方に倒す', () => {
    // エラー帯が出てカードが高くなった状態（箱は 700x200）。
    // 引き伸ばすと絵がゆがむので、はみ出させて縦横比を保つ。
    const style = cropBackgroundStyle({ x: 0, y: 0.45, width: 1, height: 0.1, ratio: 0.7 }, 700, 200);
    const [width, height] = style.backgroundSize.split(' ').map((v) => parseFloat(v));
    expect(width / height).toBeCloseTo(0.7, 5);
    // 選んだ範囲が箱の高さを満たすところまで拡大する
    expect(height * 0.1).toBeGreaterThanOrEqual(200);
  });
});

describe('resizeCrop / moveCrop', () => {
  const crop = coverCrop(0.7, 7);

  it('拡大しても切り抜きの中心は動かない', () => {
    const zoomed = resizeCrop(crop, 7, 0.5);
    expect(zoomed.width).toBeCloseTo(0.5, 5);
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(crop.x + crop.width / 2, 5);
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(crop.y + crop.height / 2, 5);
  });

  it('拡大しすぎ・縮めすぎは止める（絵の外を敷くことになる）', () => {
    expect(resizeCrop(crop, 7, 5).width).toBeCloseTo(crop.width, 5);
    expect(resizeCrop(crop, 7, 0.01).width).toBeCloseTo(crop.width * 0.2, 5);
  });

  it('動かしても絵の外へは出さない', () => {
    const moved = moveCrop({ ...crop, width: 0.5, height: 0.05 }, -1, 2);
    expect(moved.x).toBe(0);
    expect(moved.y).toBeCloseTo(0.95, 5);
  });
});
