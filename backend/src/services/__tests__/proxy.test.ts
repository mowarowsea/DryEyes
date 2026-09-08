import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchProxyAsset,
  fetchProxyPage,
  getPageInfo,
  isLikelyClientRenderedShell,
  rewriteCss,
} from '../proxy.js';
import { renderPageHtml } from '../browserRender.js';
import axios from 'axios';

vi.mock('axios');
vi.mock('../browserRender.js', async () => {
  const actual = await vi.importActual<typeof import('../browserRender.js')>('../browserRender.js');
  return { ...actual, renderPageHtml: vi.fn() };
});

const mockRender = renderPageHtml as unknown as ReturnType<typeof vi.fn>;

// Vite で組んだ SPA が返してくる起動用シェル。本文が空で、中身は module script が組み立てる。
const SPA_SHELL =
  '<!doctype html><html><head><title>Kemono</title>' +
  '<script type="module" crossorigin src="/assets/index.js"></script>' +
  '</head><body><div id="root"></div></body></html>';

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

  it('should escape the target url before putting it in the base tag', async () => {
    // url はクエリからそのまま来るので、属性を閉じて <script> を差し込む余地を残さない
    const rawHtml = `<html><head></head><body></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/"><script>alert(1)</script>');

    expect(result).not.toContain('"><script>alert(1)</script>');
    expect(result).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('should keep a query string usable after escaping the base tag', async () => {
    // & は &amp; になるが、属性値の解析でそのまま元へ戻るので href は壊れない
    const rawHtml = `<html><head></head><body></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/list?a=1&b=2');

    expect(result).toContain('<base href="https://example.com/list?a=1&amp;b=2">');
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
    expect(result).toContain("attributeFilter: ['href', 'action', 'target', 'http-equiv', 'rel']");
  });

  // サイト自身が配るウェブフォントは CORS で読めず、アイコンフォントが「☒」になる。
  // CSS を BFF (/api/proxy/asset) 経由にして、フォントもそこから読ませる。
  it('should route stylesheets through the BFF so the site own web fonts can load', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body></body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain("new URL('asset', location.href)");
    expect(result).toContain("encodeURIComponent(absolute) + '&kind=css'");
    // BFF で取れなかった CSS は元の URL へ戻して、従来どおり表示する
    expect(result).toContain('data-dryeyes-css-direct');
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

  // 狙いより内側の要素を掴んでしまったとき、選び直さずに外側へ広げられるようにする
  it('should let the picker expand the selection to the parent element', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: '<html><head></head><body></body></html>' });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain("DRYEYES_EXPAND_SELECTION");
    expect(result).toContain('emitSelection(selectedEl.parentElement)');
    // body より外まで広げても監視対象としては意味が無い
    expect(result).toContain("el !== document.body");
    // ボタンを出すかどうかを画面が決められるよう、広げられるかも一緒に返す
    expect(result).toContain('canExpand: canExpand(target)');
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

  // SPA のシェルを iframe に入れても、ページ自身の module script が CORS で止まるので
  // 中身は組み上がらない。崩れた枠を一度見せる意味が無いので、ここは自分で切り替える。
  it('should switch to the browser on its own when the raw HTML is only an SPA shell', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: SPA_SHELL });
    mockRender.mockReset();
    mockRender.mockResolvedValueOnce('<html><head></head><body><h1>ルッチーフ</h1></body></html>');

    const result = await fetchProxyPage('https://example.com/user/1');

    expect(mockRender).toHaveBeenCalledWith('https://example.com/user/1', false);
    expect(result).toContain('ルッチーフ');
    expect(result).toContain("mode:'browser'");
  });

  it('should still show the raw shell when the browser cannot be reached', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: SPA_SHELL });

    const result = await fetchProxyPage('https://example.com/user/1');

    expect(result).toContain('id="root"');
    expect(result).toContain("mode:'static'");
  });
});

describe('isLikelyClientRenderedShell', () => {
  it('SPA の起動用シェルを見分ける', () => {
    expect(isLikelyClientRenderedShell(SPA_SHELL)).toBe(true);
  });

  // 読める本文があるページは、静的 HTML のまま出したほうが速い
  it('本文があるページは対象にしない', () => {
    const html =
      '<html><head><script type="module" src="/a.js"></script></head>' +
      '<body><div id="root"><h1>第12話</h1><p>' +
      'この段落には読める文章がしっかり入っているので、起動用シェルではありません。'.repeat(2) +
      '</p></div></body></html>';
    expect(isLikelyClientRenderedShell(html)).toBe(false);
  });

  it('module script が無ければ対象にしない', () => {
    const html = '<html><head></head><body><div id="root"></div></body></html>';
    expect(isLikelyClientRenderedShell(html)).toBe(false);
  });

  it('アプリの入れ物が無ければ対象にしない', () => {
    const html = '<html><head><script type="module" src="/a.js"></script></head><body></body></html>';
    expect(isLikelyClientRenderedShell(html)).toBe(false);
  });
});

describe('getPageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockReset();
  });

  it('静的な <title> をそのまま監視名にする', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: '<html><head><title>第12話 公開</title></head><body>本文</body></html>',
    });

    await expect(getPageInfo('https://example.com/e/1')).resolves.toEqual({
      title: '第12話 公開',
      url: 'https://example.com/e/1',
    });
    // 静的なページのためにブラウザを起こさない（登録画面が 10 秒待たされてしまう）
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('<title> が無ければ og:title を使う', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: '<html><head><meta property="og:title" content="作品ページ"></head><body>本文</body></html>',
    });

    const info = await getPageInfo('https://example.com/w/1');
    expect(info.title).toBe('作品ページ');
  });

  it('<title> も OGP も無ければ JSON-LD の名前を使う', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data:
        '<html><head><script type="application/ld+json">' +
        '{"@context":"https://schema.org","@graph":[{"@type":"Article","headline":"第13話"}]}' +
        '</script></head><body>本文</body></html>',
    });

    const info = await getPageInfo('https://example.com/w/2');
    expect(info.title).toBe('第13話');
  });

  // SPA の静的 HTML はサイト名だけを返す。ブラウザで見えている名前と揃える。
  it('SPA のシェルなら描画後のタイトルを使う', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: SPA_SHELL });
    mockRender.mockResolvedValueOnce(
      '<html><head><title>Posts of "ルッチーフ" from "Pixiv Fanbox" | Kemono</title>' +
        '</head><body><h1>ルッチーフ</h1></body></html>'
    );

    const info = await getPageInfo('https://example.com/user/1');

    expect(info.title).toContain('ルッチーフ');
    expect(info.renderMode).toBe('browser');
    // ピッカーがすぐ後に開く描画と同じものを頼み、スナップショットのキャッシュに乗せる
    expect(mockRender).toHaveBeenCalledWith('https://example.com/user/1');
  });

  it('描画に失敗しても静的なタイトルで登録を続けられる', async () => {
    (axios.get as any).mockResolvedValueOnce({ data: SPA_SHELL });
    mockRender.mockRejectedValueOnce(new Error('browser unavailable'));

    const info = await getPageInfo('https://example.com/user/1');

    expect(info.title).toBe('Kemono');
    // ピッカーは描画済み DOM を試す価値があるので、判定結果は伝えたままにする
    expect(info.renderMode).toBe('browser');
  });

  it('ページが読めなければ URL をそのまま名前にする', async () => {
    (axios.get as any).mockRejectedValueOnce(new Error('offline'));

    await expect(getPageInfo('https://example.com/x')).resolves.toEqual({
      title: 'https://example.com/x',
      url: 'https://example.com/x',
    });
  });
});

// ウェブフォントは CORS 必須で、サイト自身が配るフォントは別オリジンのプレビューから読めない。
// CSS を BFF 経由にして、その中のフォント URL も BFF 経由へ書き換える。
describe('rewriteCss', () => {
  const CSS_URL = 'https://example.com/themes/css/main.css';

  it('配信元が BFF に変わるので、相対 URL は元の CSS の場所基準で絶対にする', () => {
    const css = '.hero { background: url(../img/hero.png) } .a { background: url("/img/a.png") }';
    const out = rewriteCss(css, CSS_URL);
    expect(out).toContain('url("https://example.com/themes/img/hero.png")');
    expect(out).toContain('url("https://example.com/img/a.png")');
  });

  it('@font-face の中のフォントだけ BFF 経由にする', () => {
    const css =
      "@font-face{font-family:'FontAwesome';src:url('../fonts/fa.eot?#iefix') format('embedded-opentype')," +
      "url('../fonts/fa.woff2?v=4.7') format('woff2')}" +
      '.icon { background: url(../img/icon.png) }';
    const out = rewriteCss(css, CSS_URL);
    expect(out).toContain(
      `url("asset?url=${encodeURIComponent('https://example.com/themes/fonts/fa.woff2?v=4.7')}&kind=font")`
    );
    expect(out).toContain(
      `url("asset?url=${encodeURIComponent('https://example.com/themes/fonts/fa.eot?#iefix')}&kind=font")`
    );
    // 画像は CORS が要らないので BFF を通さない
    expect(out).toContain('url("https://example.com/themes/img/icon.png")');
    expect(out).not.toContain('icon.png&kind');
  });

  it('埋め込み (data:) は触らない', () => {
    const css = '@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA)} .b{background:url(data:image/png;base64,BBBB)}';
    expect(rewriteCss(css, CSS_URL)).toBe(css);
  });

  it('@import 先の CSS も BFF 経由にして、メディア指定は残す', () => {
    const css = '@import "fonts.css";\n@import url(../print.css) print;\nbody{}';
    const out = rewriteCss(css, CSS_URL);
    expect(out).toContain(
      `@import url("asset?url=${encodeURIComponent('https://example.com/themes/css/fonts.css')}&kind=css");`
    );
    expect(out).toContain(
      `@import url("asset?url=${encodeURIComponent('https://example.com/themes/print.css')}&kind=css") print;`
    );
  });
});

describe('fetchProxyAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CSS は書き換えて text/css で返す', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: Buffer.from('@font-face{src:url(fa.woff2)}'),
      headers: { 'content-type': 'text/css' },
    });

    const asset = await fetchProxyAsset('https://example.com/css/fa.css', 'css');

    expect(asset.contentType).toBe('text/css; charset=utf-8');
    expect(asset.body).toContain(`asset?url=${encodeURIComponent('https://example.com/css/fa.woff2')}&kind=font`);
  });

  it('リダイレクトされた CSS は最終的な置き場所を基準にする', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: Buffer.from('.a{background:url(a.png)}'),
      headers: {},
      request: { res: { responseUrl: 'https://cdn.example.net/v2/main.css' } },
    });

    const asset = await fetchProxyAsset('https://example.com/main.css', 'css');

    expect(asset.body).toContain('url("https://cdn.example.net/v2/a.png")');
  });

  it('フォントは相手の型のまま返す', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: Buffer.from('wOF2'),
      headers: { 'content-type': 'font/woff2' },
    });

    const asset = await fetchProxyAsset('https://example.com/fa.woff2', 'font');

    expect(asset.contentType).toBe('font/woff2');
    expect(Buffer.isBuffer(asset.body)).toBe(true);
  });

  // DryEyes のオリジンから配るので、HTML や SVG として描画されうる型は絶対に返さない
  it('フォントらしくない型はただのバイナリにする', async () => {
    (axios.get as any).mockResolvedValueOnce({
      data: Buffer.from('<svg/>'),
      headers: { 'content-type': 'image/svg+xml' },
    });

    const asset = await fetchProxyAsset('https://example.com/fa.svg', 'font');

    expect(asset.contentType).toBe('application/octet-stream');
  });
});
