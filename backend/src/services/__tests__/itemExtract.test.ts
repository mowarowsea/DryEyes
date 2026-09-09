import { describe, it, expect, vi } from 'vitest';

vi.mock('../browserRender.js', () => ({
  evaluateOnPage: vi.fn(async () => [{ text: '[著者] 作品名 第03巻', urls: ['https://a.example/3'] }]),
}));

const { buildScript, extractItems } = await import('../itemExtract.js');
const { evaluateOnPage } = await import('../browserRender.js');

describe('buildScript', () => {
  it('should emit a real whitespace regex, not a literal "s"', () => {
    // テンプレートリテラルの中でバックスラッシュを一重にすると /s+/ に潰れる。
    // それだと「空白の畳み込み」ではなく「文字 s の削除」になってしまう
    const script = buildScript(['//div']);
    expect(script).toContain(String.raw`replace(/\s+/g, ' ')`);
    expect(script).not.toContain("replace(/s+/g, ' ')");
  });

  it('should embed selectors as JSON so quotes cannot break out', () => {
    const script = buildScript(['//div[@class="a"]']);
    expect(script).toContain(JSON.stringify(['//div[@class="a"]']));
  });
});

describe('extractItems', () => {
  it('should not open a browser when the watch has no selector', async () => {
    // ページ全体を見ている監視は、どこを 1 件とみなすか決まらない
    expect(await extractItems('https://example.com', [])).toEqual([]);
    expect(await extractItems('https://example.com', ['  '])).toEqual([]);
    expect(evaluateOnPage).not.toHaveBeenCalled();
  });

  it('should return the items the page produced', async () => {
    const items = await extractItems('https://example.com', ['//div']);
    expect(items).toEqual([{ text: '[著者] 作品名 第03巻', urls: ['https://a.example/3'] }]);
  });

  it('should tolerate a page that returns something other than an array', async () => {
    vi.mocked(evaluateOnPage).mockResolvedValueOnce(null as never);
    expect(await extractItems('https://example.com', ['//div'])).toEqual([]);
  });
});
