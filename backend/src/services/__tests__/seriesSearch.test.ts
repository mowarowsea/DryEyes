import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、先に一時ディレクトリを指す
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-series-search-test-'));
process.env.DATA_DIR = tmpDir;

const { extractHits, buildSearchUrl, searchAllSites, listSites, updateSite } = await import('../seriesSearch.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildSearchUrl', () => {
  it('作品名を埋め、空白は + にする', () => {
    expect(buildSearchUrl('https://a.example/search/{q}/', 'ONE PIECE')).toBe('https://a.example/search/ONE+PIECE/');
    expect(buildSearchUrl('https://b.example/?s={q}', '葬送')).toBe('https://b.example/?s=%E8%91%AC%E9%80%81');
  });
});

describe('extractHits', () => {
  // 13dl / dl-zip の検索結果を縮めたもの
  const html = `
    <li class="uppercase"><a href="https://ww14.13dl.app/search/葬送のフリーレン/">Search "葬送のフリーレン"</a></li>
    <div class="item"><a href="/dl/葬送のフリーレン/"><img alt="葬送のフリーレン"></a>
      <a href="/dl/葬送のフリーレン/">葬送のフリーレン raw 第01-15巻 [Soso no Furiren vol 01-15]</a></div>
    <div class="item"><a href="/dl/Artbook-葬送のフリーレン画集-Vol/">[Artbook] 葬送のフリーレン画集 Vol.1</a></div>
    <a href="https://dl-zip.com/tag/x/">葬送のフリーレン</a>
    <a href="https://other.example/dl/">葬送のフリーレン 別サイト</a>
    <a href="/dl/unrelated/">関係ない作品 第01巻</a>
    <a href="/dl/amp/">葬送のフリーレン &amp; 外伝</a>
  `;

  it('作品名を含む同じサイトのリンクだけを、題名の長い方で 1 件ずつ拾う', () => {
    const hits = extractHits(html, 'https://ww14.13dl.app/search/x/', '葬送のフリーレン');
    expect(hits.map((h) => h.text)).toEqual([
      '葬送のフリーレン raw 第01-15巻 [Soso no Furiren vol 01-15]',
      '[Artbook] 葬送のフリーレン画集 Vol.1',
      '葬送のフリーレン & 外伝',
    ]);
    expect(hits[0].url).toBe('https://ww14.13dl.app/dl/%E8%91%AC%E9%80%81%E3%81%AE%E3%83%95%E3%83%AA%E3%83%BC%E3%83%AC%E3%83%B3/');
  });
});

describe('searchAllSites', () => {
  it('失敗したサイトは失敗を数え、他のサイトの結果は返す', async () => {
    const [first, ...rest] = listSites();
    const results = await searchAllSites('星', () => null, async (url) => {
      if (url.startsWith(first.searchUrl.slice(0, 20))) throw new Error('boom');
      return `<a href="/w/">星の図書館</a>`;
    });
    expect(results[0].error).toBe('boom');
    expect(results.slice(1).every((r) => r.hits.length === 1)).toBe(true);
    expect(listSites()[0].failStreak).toBe(1);
    expect(rest.every((s) => listSites().find((x) => x.id === s.id)!.lastHitAt)).toBe(true);
  });

  it('使用しないサイトは検索しない', async () => {
    const [first] = listSites();
    updateSite(first.id, { enabled: false });
    const results = await searchAllSites('星', () => null, async () => '');
    expect(results.map((r) => r.siteId)).not.toContain(first.id);
  });
});
