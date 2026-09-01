import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProxyPage } from '../proxy.js';
import { renderPageHtml } from '../browserRender.js';
import axios from 'axios';

vi.mock('axios');
vi.mock('../browserRender.js', async () => {
  const actual = await vi.importActual<typeof import('../browserRender.js')>('../browserRender.js');
  return { ...actual, renderPageHtml: vi.fn() };
});

const mockRender = renderPageHtml as unknown as ReturnType<typeof vi.fn>;

describe('fetchProxyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 既定はブラウザ描画が使えない状況にして、静的 HTML のフォールバックを通す
    mockRender.mockRejectedValue(new Error('browser unavailable'));
  });

  it('should inject <base> tag and inspector script into HTML', async () => {
    const rawHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/item/1');

    expect(axios.get).toHaveBeenCalledWith('https://example.com/item/1', expect.any(Object));
    expect(result).toContain('<base href="https://example.com/item/1">');
    expect(result).toContain('DRYEYES_ELEMENT_SELECTED');
    expect(result).toContain('dryeyes-inspect-hover');
  });

  it('should inject the inspector into <head> before the page own scripts', async () => {
    const rawHtml = `<!DOCTYPE html><html><head><script src="/app.js"></script></head><body><a href="/next">Next</a></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/');

    // ページ自身のスクリプトより先に読み込まれないと、リンクの遷移を先回りで止められない
    expect(result.indexOf('DRYEYES_ELEMENT_SELECTED')).toBeLessThan(result.indexOf('/app.js'));
    expect(result.indexOf('DRYEYES_ELEMENT_SELECTED')).toBeLessThan(result.indexOf('<body>'));
  });

  it('should block navigation triggered by links and forms', async () => {
    const rawHtml = `<html><head></head><body></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain('stopImmediatePropagation');
    expect(result).toContain("'submit'");
    expect(result).toContain('history.pushState');
  });

  // 素の HTML では JS が後から描画する部分（話数一覧など）が丸ごと欠けるので、
  // ふだんは実ブラウザで描画したものを使う。
  it('should prefer the browser-rendered DOM over the raw HTML', async () => {
    mockRender.mockResolvedValueOnce(
      '<!DOCTYPE html><html><head></head><body><h4>11話</h4></body></html>'
    );

    const result = await fetchProxyPage('https://example.com/episode/1');

    expect(result).toContain('11話');
    expect(result).toContain('<base href="https://example.com/episode/1">');
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('should fall back to the raw HTML when the browser is unavailable', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body>static</body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain('static');
    expect(axios.get).toHaveBeenCalled();
  });
});
