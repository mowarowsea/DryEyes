import { describe, it, expect } from 'vitest';
import { extractSocialImageUrls } from '../htmlMeta.js';
import { buildCardImageScript } from '../browserRender.js';
import { sniffImageType } from '../cardImage.js';

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

describe('sniffImageType', () => {
  // Content-Type を当てにできない配信元がある（カドコミの CDN は表紙を
  // binary/octet-stream で返してくる）ので、中身で判定する。
  const bytes = (...b: number[]) => Buffer.from([...b, ...new Array(32).fill(0)]);

  it('JPEG / PNG / GIF を見分ける', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image/gif');
  });

  it('WebP を RIFF ヘッダーごと見分ける', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBPVP8 '),
    ]);
    expect(sniffImageType(webp)).toBe('image/webp');
    // RIFF だが WEBP ではないもの（wav など）は画像として扱わない
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('AVIF を ftyp ブランドで見分ける', () => {
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif'), Buffer.alloc(16)]);
    expect(sniffImageType(avif)).toBe('image/avif');
  });

  it('SVG はテキストとして見分ける', () => {
    expect(sniffImageType(Buffer.from('  <svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml'
    );
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe('image/svg+xml');
  });

  it('画像でないものは弾く（404 の HTML が 200 で返ってくることがある）', () => {
    expect(sniffImageType(Buffer.from('<!DOCTYPE html><html><body>Not Found'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});
