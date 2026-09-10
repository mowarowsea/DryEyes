import { describe, expect, it } from 'vitest';
import { splitSharedAffixes } from '../candidateLabel';

// 同じ作品の候補は名前の大半が共通なので、違うところが見えないと投入対象を選べない
// (13dl のように「ファイル名 + ミラー名の羅列」が 1 行になるページで顕著)
describe('splitSharedAffixes', () => {
  const mirrors = '.rar katfile rapidgator dailyuploads frdl turbobit uploady';

  it('共通する前後を分け、巻の違うところだけを body に残す', () => {
    const labels = [
      `Akuyaku reijo no kyoji v01${mirrors}`,
      `Akuyaku reijo no kyoji v01b${mirrors}`,
      `Akuyaku reijo no kyoji v02${mirrors}`,
      `Akuyaku_reijo_no_kyoji_v03-04s${mirrors}`,
    ];
    const parts = splitSharedAffixes(labels);

    expect(parts.map((p) => p.body)).toEqual([
      ' reijo no kyoji v01',
      ' reijo no kyoji v01b',
      ' reijo no kyoji v02',
      '_reijo_no_kyoji_v03-04s',
    ]);
    expect(parts.every((p) => p.head === 'Akuyaku')).toBe(true);
    expect(parts.every((p) => p.tail === mirrors)).toBe(true);
  });

  it('切り分けても元の文字列は失われない', () => {
    const labels = [`Goblin Slayer Manga v01${mirrors}`, `Goblin Slayer Manga v02${mirrors}`];
    for (const [i, part] of splitSharedAffixes(labels).entries()) {
      expect(part.head + part.body + part.tail).toBe(labels[i]);
    }
  });

  it('1 件だけなら畳まない', () => {
    expect(splitSharedAffixes(['第184話'])).toEqual([{ head: '', body: '第184話', tail: '' }]);
  });

  it('全部同じ文字列なら畳まない (畳める違いが無い)', () => {
    const parts = splitSharedAffixes(['同じ名前です', '同じ名前です']);
    expect(parts.map((p) => p.body)).toEqual(['同じ名前です', '同じ名前です']);
  });

  it('共通部分が数文字しかないなら畳まない', () => {
    const parts = splitSharedAffixes(['第184話', '第183話']);
    expect(parts.map((p) => p.body)).toEqual(['第184話', '第183話']);
  });

  it('片方が共通部分だけで出来ているなら畳まない', () => {
    // 畳むと短い側の body が空になり、行から読める字が消える
    const parts = splitSharedAffixes(['ROOTxxxxMIDyyyyTAIL', 'ROOTxxxxyyyyTAIL']);
    expect(parts.map((p) => p.body)).toEqual(['ROOTxxxxMIDyyyyTAIL', 'ROOTxxxxyyyyTAIL']);
  });
});
