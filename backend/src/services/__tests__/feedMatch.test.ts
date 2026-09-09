import { describe, it, expect } from 'vitest';
import { addedLinesOf, applyPattern, normalizeText, selectAddedItems, sourceKeyOf } from '../feedMatch.js';
import { DiffLine } from '../../types/index.js';

const lines = (...specs: [DiffLine['type'], string][]): DiffLine[] =>
  specs.map(([type, text]) => ({ type, text }));

describe('addedLinesOf', () => {
  it('should keep only added lines', () => {
    expect(
      addedLinesOf(lines(['added', '第112話'], ['removed', '第108話'], ['context', '第110話']))
    ).toEqual(['第112話']);
  });

  it('should drop lines too short to match on', () => {
    // 「1」のような行はどの要素にも当たってしまう
    expect(addedLinesOf(lines(['added', '1'], ['added', '第112話']))).toEqual(['第112話']);
  });

  it('should normalize whitespace', () => {
    expect(addedLinesOf(lines(['added', '  第112話   公開  ']))).toEqual(['第112話 公開']);
  });
});

describe('selectAddedItems', () => {
  const items = [
    { text: '[著者] 作品名 第03巻', urls: ['https://a.example/3'] },
    { text: '[著者] 作品名 第02巻', urls: ['https://a.example/2'] },
  ];

  it('should keep items that correspond to an added line', () => {
    expect(selectAddedItems(items, ['[著者] 作品名 第03巻'])).toEqual([items[0]]);
  });

  it('should match when the snapshot line is only part of the element text', () => {
    // 1 要素が複数行になるページ。行はその一部にしかならない
    const long = [{ text: '[著者] 作品名 第03巻 rar zip ダウンロード', urls: ['https://a.example/3'] }];
    expect(selectAddedItems(long, ['[著者] 作品名 第03巻'])).toEqual(long);
  });

  it('should match when the element text is only part of the snapshot line', () => {
    // 逆に 1 行へまとまるページ
    const short = [{ text: '第03巻', urls: ['https://a.example/3'] }];
    expect(selectAddedItems(short, ['[著者] 作品名 第03巻 ダウンロード'])).toEqual(short);
  });

  it('should return nothing when there is no increment', () => {
    expect(selectAddedItems(items, [])).toEqual([]);
  });

  it('should ignore items whose text is too short to be meaningful', () => {
    expect(selectAddedItems([{ text: '1', urls: [] }], ['[著者] 作品名 第03巻'])).toEqual([]);
  });
});

describe('applyPattern', () => {
  const pattern = String.raw`^\[(?<author>[^\]]+)\]\s*(?<title>.+?)\s*第(?<volume>\d+)巻`;

  it('should pull named groups into the meta fields', () => {
    const meta = applyPattern('[著者] 作品名 第03巻', pattern);
    expect(meta.author).toBe('著者');
    expect(meta.title).toBe('作品名');
    expect(meta.volume).toBe('03');
    expect(meta.rawText).toBe('[著者] 作品名 第03巻');
  });

  it('should keep rawText when no pattern is configured', () => {
    const meta = applyPattern('  [著者]  作品名 第03巻 ', null);
    expect(meta).toEqual({ title: null, author: null, volume: null, rawText: '[著者] 作品名 第03巻' });
  });

  it('should keep rawText when the pattern does not match', () => {
    const meta = applyPattern('まったく違う書き方の行', pattern);
    expect(meta.title).toBeNull();
    expect(meta.rawText).toBe('まったく違う書き方の行');
  });

  it('should treat a broken pattern as no match instead of throwing', () => {
    const meta = applyPattern('[著者] 作品名 第03巻', '(?<author>[');
    expect(meta.author).toBeNull();
    expect(meta.rawText).toBe('[著者] 作品名 第03巻');
  });

  it('should tolerate a pattern without named groups', () => {
    const meta = applyPattern('[著者] 作品名 第03巻', '作品名');
    expect(meta.title).toBeNull();
    expect(meta.rawText).toBe('[著者] 作品名 第03巻');
  });
});

describe('sourceKeyOf', () => {
  it('should be stable for the same text', () => {
    expect(sourceKeyOf('w1', '[著者] 作品名 第03巻')).toBe(sourceKeyOf('w1', '[著者] 作品名 第03巻'));
  });

  it('should ignore whitespace differences', () => {
    expect(sourceKeyOf('w1', '[著者]  作品名 第03巻')).toBe(sourceKeyOf('w1', '[著者] 作品名 第03巻'));
  });

  it('should differ per watch and per text', () => {
    expect(sourceKeyOf('w1', 'x')).not.toBe(sourceKeyOf('w2', 'x'));
    expect(sourceKeyOf('w1', 'x')).not.toBe(sourceKeyOf('w1', 'y'));
  });
});

describe('normalizeText', () => {
  it('should collapse whitespace and trim', () => {
    expect(normalizeText('  a \n b\t c ')).toBe('a b c');
  });
});
