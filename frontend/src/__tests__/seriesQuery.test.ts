import { describe, expect, it } from 'vitest';
import { guessSeriesQuery } from '../seriesQuery';

describe('guessSeriesQuery', () => {
  it('作品名のうしろに付いた宣伝を落とす', () => {
    expect(
      guessSeriesQuery('最果てのパラディン raw 第01-15巻 [Saihate no Paradin vol 01-15] zip rar 無料ダウンロード')
    ).toBe('最果てのパラディン');
  });

  it('頭の作者の括弧書きを外す', () => {
    expect(guessSeriesQuery('[藤栄道彦] 最後のレストラン 第01-20巻')).toBe('最後のレストラン');
  });

  it('ローマ字表記でも巻数の手前で切る', () => {
    expect(guessSeriesQuery('Isekai machikoba muso Shinrai v01-02s.rar katfile')).toBe(
      'Isekai machikoba muso Shinrai'
    );
  });

  it('巻数の書き方が 01-15巻 でも切れる', () => {
    expect(guessSeriesQuery('ダンジョン飯 01-15巻')).toBe('ダンジョン飯');
  });

  // 印が題名そのものに含まれると空になってしまう。そのときは元の文字列を返す
  it('題名に「第」が含まれていても空にしない', () => {
    expect(guessSeriesQuery('第3のギデオン')).toBe('第3のギデオン');
  });

  it('宣伝の無いタイトルはそのまま', () => {
    expect(guessSeriesQuery('葬送のフリーレン')).toBe('葬送のフリーレン');
  });

  it('タイトルが無ければ空', () => {
    expect(guessSeriesQuery(null)).toBe('');
  });
});
