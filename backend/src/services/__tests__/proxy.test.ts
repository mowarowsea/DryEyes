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

  // capture は window → document の順に流れる。document だけに付けていると、
  // ページが window に付けたリスナーに先を越されて遷移してしまう。
  it('should capture events on window, not only on document', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body></body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain('CAPTURE_ROOTS = [window, document]');
    // 選択のための click も最上流の window で先取りする
    expect(result).toContain("window.addEventListener('click'");
  });

  // イベント遮断が 1 経路でも漏れると遷移するので、href そのものを剥がしておく
  it('should strip href and target from links so they cannot navigate at all', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: '<html><head></head><body><a href="/next" target="_blank">Next</a></body></html>',
    });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain("NEUTRAL_HREF = 'javascript:void(0)'");
    // 選択後に元の遷移先を読めるよう退避する
    expect(result).toContain('data-dryeyes-href');
    expect(result).toContain("a.removeAttribute('target')");
  });

  // 話数一覧のように JS が後から差し込むリンクにも追従する必要がある
  it('should keep neutralizing links that are added after load', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body></body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain('MutationObserver');
    expect(result).toContain("attributeFilter: ['href', 'action', 'target', 'http-equiv']");
  });

  // クリック以外の遷移経路（meta refresh・location 書き換え・JS 発火のクリック）も塞ぐ
  it('should block navigation paths that do not go through a click', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body></body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain('location.assign');
    expect(result).toContain('location.replace');
    expect(result).toContain("http-equiv') || '').toLowerCase() === 'refresh'");
    expect(result).toContain('HTMLElement.prototype.click');
  });

  // 既定は軽い静的取得。重い描画は画面から頼まれたときだけにする。
  it('should not start a browser unless it is asked to', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body>static</body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(mockRender).not.toHaveBeenCalled();
    expect(result).toContain('static');
    expect(result).toContain("mode:'static'");
  });

  // 素の HTML では JS が後から描画する部分（話数一覧など）が丸ごと欠けるので、
  // 頼まれたときは実ブラウザで描画したものを使う。
  it('should use the browser-rendered DOM when asked to', async () => {
    mockRender.mockReset();
    mockRender.mockResolvedValueOnce(
      '<!DOCTYPE html><html><head></head><body><h4>11話</h4></body></html>'
    );

    const result = await fetchProxyPage('https://example.com/episode/1', true);

    expect(result).toContain('11話');
    expect(result).toContain('<base href="https://example.com/episode/1">');
    expect(result).toContain("mode:'browser'");
    expect(axios.get).not.toHaveBeenCalled();
  });

  // ピッカーの枠だけ暗くて中身が真っ白、を避けるため画面のテーマをページ側にも渡す
  it('should leave the page untouched when the screen is in light theme', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body>hi</body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).not.toContain('dryeyes-force-dark');
  });

  it('should darken the previewed page when the screen is in dark theme', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body>hi</body></html>' });

    const result = await fetchProxyPage('https://example.com/', false, true);

    // 自前でテーマを切り替えるページにはダークを選ばせ、
    expect(result).toContain('prefers-color-scheme');
    // それでも明るいままのページは反転して合わせる
    expect(result).toContain('dryeyes-force-dark');
  });

  it('should render with a dark browser when the screen is in dark theme', async () => {
    mockRender.mockReset();
    mockRender.mockResolvedValueOnce('<html><head></head><body>rendered</body></html>');

    await fetchProxyPage('https://example.com/', true, true);

    expect(mockRender).toHaveBeenCalledWith('https://example.com/', true);
  });

  // 押しても何も変わらないまま終わらせないよう、素の HTML で出したことを画面へ伝える
  it('should fall back to the raw HTML and report it when the browser is unavailable', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body>static</body></html>' });

    const result = await fetchProxyPage('https://example.com/', true);

    expect(result).toContain('static');
    expect(result).toContain("mode:'static'");
    expect(axios.get).toHaveBeenCalled();
  });
});
