import { describe, it, expect } from 'vitest';
import { extractSocialImageUrls } from '../htmlMeta.js';
import { buildCardImageScript } from '../browserRender.js';

describe('extractSocialImageUrls', () => {
  it('og:image を拾う', () => {
    const html = `
      <head>
        <meta property="og:title" content="第12話">
        <meta property="og:image" content="https://cdn.example.com/works/42/cover.jpg">
      </head>`;
    expect(extractSocialImageUrls(html)).toEqual(['https://cdn.example.com/works/42/cover.jpg']);
  });

  it('secure_url を og:image より優先する', () => {
    const html = `
      <meta property="og:image" content="http://cdn.example.com/a.jpg">
      <meta property="og:image:secure_url" content="https://cdn.example.com/a-secure.jpg">`;
    expect(extractSocialImageUrls(html)[0]).toBe('https://cdn.example.com/a-secure.jpg');
  });

  it('og:image が無ければ Twitter Card を使う', () => {
    // name 属性で書くサイトもあるので property と両方見る
    const html = `<meta name="twitter:image" content="https://cdn.example.com/tw.png">`;
    expect(extractSocialImageUrls(html)).toEqual(['https://cdn.example.com/tw.png']);
  });

  it('代表画像を宣言していないページでは空を返す', () => {
    const html = `<meta name="description" content="og:image はありません">`;
    expect(extractSocialImageUrls(html)).toEqual([]);
  });

  it('シングルクォートや属性順の違いを取りこぼさない', () => {
    const html = `<meta content='https://cdn.example.com/q.jpg' property='og:image' />`;
    expect(extractSocialImageUrls(html)).toEqual(['https://cdn.example.com/q.jpg']);
  });
});

describe('buildCardImageScript', () => {
  // ブラウザへ渡すコードは文字列なので、型チェックでは壊れに気づけない。
  // （実際 \1 が 8 進エスケープ扱いになって崩れたことがある）
  it('組み立てた結果が JavaScript として構文エラーにならない', () => {
    const script = buildCardImageScript(['//*[@id="episodes"]', '.work-detail']);
    expect(() => new Function(`return ${script};`)).not.toThrow();
  });

  it('前後の空白と空文字を落としてセレクタを埋め込む', () => {
    expect(buildCardImageScript(['  .work-detail  ', ''])).toContain('[".work-detail"]');
  });

  it('セレクタ無し（ページ全体監視）でも組み立てられる', () => {
    const script = buildCardImageScript([]);
    expect(script).toContain('[]');
    expect(() => new Function(`return ${script};`)).not.toThrow();
  });
});
