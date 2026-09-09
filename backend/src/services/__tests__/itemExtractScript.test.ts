// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildScript } from '../itemExtract.js';

// 注入先はブラウザなので、jsdom に読ませて実際に動かして確かめる。
// BFF の tsconfig には DOM の型が無いため、DOM まわりは any で扱う。
const dom: any = globalThis as any;

const setBody = (html: string) => {
  dom.document.body.innerHTML = html;
};

const run = (selectors: string[]): { text: string; urls: string[] }[] =>
  new Function('return ' + buildScript(selectors))();

describe('buildScript', () => {
  it('should drop the outer element when a selector matches both a row and its container', () => {
    // 要素ピッカーが作る XPath は同じ並び全部に当たるので、行を包む親まで巻き込むことがある。
    // 親を残すとページ全体に近いテキストが「1 件」になってしまう
    setBody(`
      <div class="row">
        <div class="row"><a href="https://a.example/1">第1巻</a></div>
        <div class="row"><a href="https://a.example/2">第2巻</a></div>
      </div>`);

    const items = run(['.row']);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.text)).toEqual(['第1巻', '第2巻']);
  });

  it('should work the same through an XPath selector', () => {
    setBody(`
      <div id="list">
        <div class="row"><a href="https://a.example/1">第1巻</a></div>
        <div class="row"><a href="https://a.example/2">第2巻</a></div>
      </div>`);

    const items = run(['//div[@class="row"]']);
    expect(items.map((i) => i.text)).toEqual(['第1巻', '第2巻']);
  });

  it('should collect every mirror link under one row', () => {
    setBody(`
      <div class="row">
        作品名 v01-02
        <a href="https://katfile.example/x">katfile</a>
        <a href="https://rapidgator.example/x">rapidgator</a>
      </div>`);

    const [item] = run(['.row']);
    expect(item.urls).toEqual(['https://katfile.example/x', 'https://rapidgator.example/x']);
    expect(item.text).toContain('作品名 v01-02');
  });

  it('should take the element itself when the row is the anchor', () => {
    setBody('<a class="row" href="https://a.example/1">作品名 v01</a>');
    const [item] = run(['.row']);
    expect(item.urls).toEqual(['https://a.example/1']);
  });

  it('should ignore links that are not http(s)', () => {
    setBody(`
      <div class="row">
        <a href="javascript:void(0)">開く</a>
        <a href="#top">上へ</a>
        <a href="https://a.example/1">本命</a>
      </div>`);

    const [item] = run(['.row']);
    expect(item.urls).toEqual(['https://a.example/1']);
  });

  it('should not repeat the same link twice', () => {
    setBody(`
      <div class="row">
        <a href="https://a.example/1">1</a>
        <a href="https://a.example/1">1 (別の見た目)</a>
      </div>`);

    expect(run(['.row'])[0].urls).toEqual(['https://a.example/1']);
  });

  it('should collapse whitespace in the text', () => {
    // ここが壊れていると「文字 s を消す」正規表現になる (テンプレートリテラルのエスケープ)
    setBody('<div class="row">  作品名\n\n  v01  <a href="https://a.example/1">dl</a></div>');
    expect(run(['.row'])[0].text).toBe('作品名 v01 dl');
  });

  it('should skip a broken selector instead of throwing', () => {
    setBody('<div class="row"><a href="https://a.example/1">第1巻</a></div>');
    expect(run(['((((', '.row'])).toHaveLength(1);
  });

  it('should return nothing when the selector matches nothing', () => {
    setBody('<div class="other">x</div>');
    expect(run(['.row'])).toEqual([]);
  });
});
