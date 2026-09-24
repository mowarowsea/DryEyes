import { describe, it, expect } from 'vitest';
import { shelfSpelling } from '../pinax.js';

describe('shelfSpelling', () => {
  it('全角記号はフォルダ名の綴りのまま返す', () => {
    expect(
      shelfSpelling({
        title: '魔導具師ダリヤはうつむかない ~Dahliya Wilts No More~',
        author: '住川惠×甘岸久弥',
        folder: '[住川惠×甘岸久弥] 魔導具師ダリヤはうつむかない ～Dahliya Wilts No More～',
      })
    ).toEqual({
      title: '魔導具師ダリヤはうつむかない ～Dahliya Wilts No More～',
      author: '住川惠×甘岸久弥',
    });
  });

  it('完結の印 (完) は作品名に含めない', () => {
    expect(
      shelfSpelling({
        title: 'Robotics;Notes REVIVAL LEGACY',
        author: 'シヒラ竜也',
        folder: '[シヒラ竜也] Robotics；Notes REVIVAL LEGACY(完)',
      })
    ).toEqual({ title: 'Robotics；Notes REVIVAL LEGACY', author: 'シヒラ竜也' });
  });

  it('フォルダ名が想定外の形なら Pinax の値を使う', () => {
    expect(shelfSpelling({ title: 'Helck', author: '七尾ナナキ', folder: 'Helck' })).toEqual({
      title: 'Helck',
      author: '七尾ナナキ',
    });
    expect(shelfSpelling({ title: 'Helck', author: '七尾ナナキ', folder: '[別人] 別作品' })).toEqual({
      title: 'Helck',
      author: '七尾ナナキ',
    });
    expect(shelfSpelling({ title: 'Helck', author: null })).toEqual({ title: 'Helck', author: null });
  });
});
