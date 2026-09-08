import axios from 'axios';
import { renderPageHtml, RENDER_USER_AGENT } from './browserRender.js';
import { attributeOf, escapeHtml } from './htmlMeta.js';
import { ELEMENT_PATH_HELPERS } from './elementPath.js';

// 注入する Element Inspector スクリプト。
// <head> の先頭に置いて、ページ自身のスクリプトより先にリスナーを登録する。
// こうしないと、リンクやSPAのルーターに先回りされて画面が遷移してしまう。
const INSPECTOR_SCRIPT = `
<script>
(function() {
  let highlightedEl = null;
  // 「選択範囲を拡大」で親へ辿れるよう、最後に選んだ要素を覚えておく
  let selectedEl = null;

  // ハイライト用のオーバーレイスタイル
  const style = document.createElement('style');
  style.innerHTML = \`
    .dryeyes-inspect-hover {
      outline: 2px solid #4f46e5 !important;
      background-color: rgba(79, 70, 229, 0.15) !important;
      cursor: crosshair !important;
    }
    .dryeyes-inspect-batch-highlight {
      outline: 2px dashed #9333ea !important;
      background-color: rgba(147, 51, 234, 0.2) !important;
      transition: all 0.2s ease !important;
    }
  \`;
  (document.head || document.documentElement).appendChild(style);

  let batchHighlightedElements = [];

  function clearBatchHighlight() {
    batchHighlightedElements.forEach(el => {
      if (el && el.classList) {
        el.classList.remove('dryeyes-inspect-batch-highlight');
      }
    });
    batchHighlightedElements = [];
  }

  function applyBatchHighlight(xpath) {
    clearBatchHighlight();
    if (!xpath) return;
    try {
      const res = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < res.snapshotLength; i++) {
        const node = res.snapshotItem(i);
        if (node && node.nodeType === 1) {
          node.classList.add('dryeyes-inspect-batch-highlight');
          batchHighlightedElements.push(node);
        }
      }
    } catch (e) {
      console.error('[DryEyes Inspector] Failed to highlight xpath:', e);
    }
  }

  // 親ウィンドウからのメッセージリスナー（一括ハイライト指示）
  window.addEventListener('message', function(event) {
    if (!event.data) return;
    if (event.data.type === 'DRYEYES_HIGHLIGHT_XPATH') {
      applyBatchHighlight(event.data.xpath);
    } else if (event.data.type === 'DRYEYES_CLEAR_HIGHLIGHT') {
      clearBatchHighlight();
    } else if (event.data.type === 'DRYEYES_EXPAND_SELECTION') {
      expandSelection();
    } else if (event.data.type === 'DRYEYES_PROBE_SELECTORS') {
      probeSelectors(event.data.selectors, event.data.requestId);
    }
  });

  // ---- 要素を選ぶための画面なので、ページ側の遷移は一切起こさせない ----

  // デフォルト動作（リンク遷移・フォーム送信）と、ページ自身のハンドラの両方を止める。
  // stopPropagation ではなく stopImmediatePropagation なのは、
  // 同じノードにページが先に付けたリスナー（SPAのルーターなど）も黙らせるため。
  function blockEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // デフォルト動作は残したまま（スクロールやクリック生成を壊さない）、
  // ページ側のハンドラだけを黙らせる。
  function muteEvent(e) {
    e.stopImmediatePropagation();
  }

  // capture は window → document → 要素 の順に流れる。document だけに付けていると、
  // window に付けたページ側のリスナーに先を越されて遷移してしまう。両方で捕まえる。
  var CAPTURE_ROOTS = [window, document];

  function captureAll(types, handler) {
    types.forEach(function(type) {
      CAPTURE_ROOTS.forEach(function(root) {
        root.addEventListener(type, handler, true);
      });
    });
  }

  captureAll(['mousedown', 'mouseup', 'auxclick', 'submit', 'dragstart'], blockEvent);
  captureAll(['touchstart', 'touchend', 'pointerdown', 'pointerup', 'keydown', 'keyup'], muteEvent);

  // ---- 遷移先そのものを持たせない ----
  //
  // イベントを止める防御は、1 経路でも漏れる（未知のイベント名・setTimeout 経由など）と
  // 遷移してしまう。そこでリンクからは href を剥がし、遷移しようがない状態にする。
  // 元の href は選択後に参照できるよう data 属性へ退避する。
  var NEUTRAL_HREF = 'javascript:void(0)';

  function neutralizeLink(a) {
    var href = a.getAttribute('href');
    if (href !== null && href !== NEUTRAL_HREF) {
      a.setAttribute('data-dryeyes-href', href);
      a.setAttribute('href', NEUTRAL_HREF);
    }
    // target="_blank" は別タブを開こうとするので落とす
    if (a.hasAttribute('target')) a.removeAttribute('target');
  }

  function neutralizeForm(form) {
    var action = form.getAttribute('action');
    if (action !== null) {
      form.setAttribute('data-dryeyes-action', action);
      form.removeAttribute('action');
    }
    if (form.hasAttribute('target')) form.removeAttribute('target');
  }

  function neutralizeMeta(meta) {
    // <meta http-equiv="refresh"> は放っておくと勝手に飛ぶ
    if ((meta.getAttribute('http-equiv') || '').toLowerCase() === 'refresh') {
      meta.parentNode && meta.parentNode.removeChild(meta);
    }
  }

  // ---- スタイルシートは BFF 経由で読む ----
  //
  // ウェブフォントは CORS 必須。サイト自身が配るフォントは Access-Control-Allow-Origin を
  // 付けていないことが多く、別オリジンのこのプレビューからは読めずにアイコンフォントが
  // 「☒」になる。<link rel="stylesheet"> を BFF の asset エンドポイントへ向け直すと、
  // BFF が CSS 内のフォント URL も自分経由へ書き換えて返す（proxy.ts の rewriteCss）。
  // エンドポイントの場所はこのプレビュー自身の URL（.../proxy/page）から相対で求める。
  // BFF は自分の公開 URL（Tailscale のホスト名やサブパス）を知らないため。
  var ASSET_ENDPOINT = null;
  try { ASSET_ENDPOINT = new URL('asset', location.href).href; } catch (e) {}

  function rerouteStylesheet(link) {
    if (!ASSET_ENDPOINT) return;
    var rel = (link.getAttribute('rel') || '').toLowerCase().split(/\\s+/);
    if (rel.indexOf('stylesheet') === -1) return;
    var href = link.getAttribute('href');
    if (!href || href.indexOf(ASSET_ENDPOINT) === 0) return;
    // BFF で取れなかった CSS は元の URL から直接読む（従来どおり、フォントだけ出ない）
    if (link.hasAttribute('data-dryeyes-css-direct')) return;
    var absolute;
    try { absolute = new URL(href, document.baseURI).href; } catch (e) { return; }
    if (!/^https?:/i.test(absolute)) return;

    link.setAttribute('data-dryeyes-css', absolute);
    // 中身を書き換えて返すので、元のハッシュ (SRI) とは合わなくなる
    link.removeAttribute('integrity');
    if (!link.hasAttribute('data-dryeyes-css-watched')) {
      link.setAttribute('data-dryeyes-css-watched', '');
      link.addEventListener('error', function() {
        var original = link.getAttribute('data-dryeyes-css');
        if (!original || link.hasAttribute('data-dryeyes-css-direct')) return;
        link.setAttribute('data-dryeyes-css-direct', '');
        link.setAttribute('href', original);
      });
    }
    link.setAttribute('href', ASSET_ENDPOINT + '?url=' + encodeURIComponent(absolute) + '&kind=css');
  }

  function neutralizeTree(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.tagName === 'A') neutralizeLink(root);
    else if (root.tagName === 'FORM') neutralizeForm(root);
    else if (root.tagName === 'META') neutralizeMeta(root);
    else if (root.tagName === 'LINK') rerouteStylesheet(root);
    if (!root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), neutralizeLink);
    Array.prototype.forEach.call(root.querySelectorAll('form'), neutralizeForm);
    Array.prototype.forEach.call(root.querySelectorAll('meta[http-equiv]'), neutralizeMeta);
    Array.prototype.forEach.call(root.querySelectorAll('link[rel]'), rerouteStylesheet);
  }

  neutralizeTree(document.documentElement);

  // 話数一覧のように JS が後から差し込むリンクや、href を書き戻すページも追いかける。
  // 2 周目は href が既に無害化済みなので、自分の書き換えでは回り続けない。
  try {
    new MutationObserver(function(records) {
      records.forEach(function(record) {
        Array.prototype.forEach.call(record.addedNodes, neutralizeTree);
        if (record.type === 'attributes') neutralizeTree(record.target);
      });
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'action', 'target', 'http-equiv', 'rel'],
    });
  } catch (e) {}

  document.addEventListener('DOMContentLoaded', function() { neutralizeTree(document.documentElement); });
  window.addEventListener('load', function() { neutralizeTree(document.documentElement); });

  // クリック以外の遷移経路（新規ウィンドウ・SPAの履歴操作・location 書き換え）も塞ぐ。
  // location.href への代入だけは仕様上どうしても潰せないので、
  // 上の href 剥がしとイベント遮断が主防御、ここは取りこぼしの受け皿という位置づけ。
  try { window.open = function() { return null; }; } catch (e) {}
  try {
    history.pushState = function() {};
    history.replaceState = function() {};
  } catch (e) {}
  try {
    location.assign = function() {};
    location.replace = function() {};
    location.reload = function() {};
  } catch (e) {}

  // ページ側が JS からリンクのクリックを発火させて飛ぶことがある
  try {
    var nativeClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function() {
      if (this && this.tagName === 'A') return;
      return nativeClick.apply(this, arguments);
    };
  } catch (e) {}

${ELEMENT_PATH_HELPERS}
  // CSS Selector 計算ヘルパー
  function getCssSelector(el) {
    if (el.id) return '#' + el.id;
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\\s+/).filter(c => !c.startsWith('dryeyes-')).join('.');
        if (classes) selector += '.' + classes;
      }
      path.unshift(selector);
      if (el.id) break;
      el = el.parentNode;
    }
    return path.join(' > ');
  }

  // マウスオーバー
  document.addEventListener('mouseover', function(e) {
    if (highlightedEl) {
      highlightedEl.classList.remove('dryeyes-inspect-hover');
    }
    highlightedEl = e.target;
    if (highlightedEl && highlightedEl.classList) {
      highlightedEl.classList.add('dryeyes-inspect-hover');
    }
  }, true);

  // 類似要素のテキスト一覧取得ヘルパー
  function getSimilarTexts(xpath) {
    const texts = [];
    evaluateNodes(xpath).forEach(function(node) {
      const t = (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ');
      if (t) texts.push(t.substring(0, 100));
    });
    return texts;
  }

  // 監視セレクタ 1 本に当たる要素。DryEyes が作るのは XPath だが、手で書いた CSS セレクタも通す。
  function nodesForSelector(selector) {
    var s = String(selector || '').trim();
    if (!s) return [];
    if (s.charAt(0) === '/' || s.charAt(0) === '(') return evaluateNodes(s);
    try {
      return Array.prototype.slice.call(document.querySelectorAll(s));
    } catch (e) {
      return evaluateNodes(s);
    }
  }

  // 親から渡された監視セレクタがこのページで何件に当たるかを調べ、当たった要素を目立たせて返す。
  // 同じサイトの他の監視から監視場所を引き継ぐときに、このページにも当てはまるかを見せるため。
  // requestId は親がそのまま返してほしい通し番号（読み込み直す前のページからの返事を見分ける）。
  function probeSelectors(selectors, requestId) {
    clearBatchHighlight();
    var nodes = [];
    (selectors || []).forEach(function(selector) {
      nodesForSelector(selector).forEach(function(node) {
        if (nodes.indexOf(node) === -1) nodes.push(node);
      });
    });

    var texts = [];
    nodes.forEach(function(node) {
      if (node.classList) {
        node.classList.add('dryeyes-inspect-batch-highlight');
        batchHighlightedElements.push(node);
      }
      var t = (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ');
      if (t && texts.length < 20) texts.push(t.substring(0, 100));
    });

    window.parent.postMessage({
      type: 'DRYEYES_PROBE_RESULT',
      requestId: requestId,
      count: nodes.length,
      texts: texts
    }, '*');
  }

  // 選んだ要素を親ウィンドウへ知らせる。クリックからも「選択範囲を拡大」からも通る。
  function emitSelection(target) {
    if (!target || target.nodeType !== 1) return;
    selectedEl = target;

    const exactXPath = getExactXPath(target);
    const similar = getSimilarXPath(target, exactXPath);
    const selector = getCssSelector(target);
    const text = (target.innerText || target.textContent || '').trim().replace(/\\s+/g, ' ').substring(0, 100);
    const similarTexts = getSimilarTexts(similar.xpath);

    window.parent.postMessage({
      type: 'DRYEYES_ELEMENT_SELECTED',
      payload: {
        xpath: exactXPath,
        similarXPath: similar.xpath,
        similarCount: similar.count,
        similarTexts: similarTexts.length > 0 ? similarTexts : [text],
        selector,
        text,
        tagName: target.tagName.toLowerCase(),
        // まだ外側へ広げられるか。body より外まで広げても監視対象としては意味が無い。
        canExpand: canExpand(target)
      }
    }, '*');
  }

  function canExpand(el) {
    const parent = el && el.parentElement;
    return !!(parent && parent !== document.documentElement && el !== document.body);
  }

  // 狙いより内側（リンクの中の span など）を掴んでしまったときに、
  // タップし直さずに一段ずつ外側の親要素へ広げる。
  function expandSelection() {
    if (!selectedEl || !canExpand(selectedEl)) return;
    emitSelection(selectedEl.parentElement);
  }

  // クリック/タップ。
  // window の capture に付けるのは、ここが最上流だから。ページが window に付けた
  // リスナーより先に走って握り潰せるうえ、stopImmediatePropagation で document 以下へも流さない。
  // このスクリプトは <head> の先頭にあるので、window 上でも必ずページより先に登録される。
  window.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();

    emitSelection(e.target);
  }, true);
})();
</script>
`;

// 画面のテーマがダークのときに、プレビューするページ側へ注入するもの。
//
// iframe の中では prefers-color-scheme が端末の設定で評価されてしまい、DryEyes の
// テーマ設定は届かない。そこで
//   1. matchMedia を差し替えて、自前でテーマを切り替えるページにはダークを選ばせる
//   2. それでも明るいままのページだけ、色を反転させて暗くする
// の二段構えにする。1 で暗くなったページを 2 が更に反転しないよう、実際の背景色を見て決める。
const DARK_PREVIEW_INJECTION = `
<style id="dryeyes-dark-preview">
  html.dryeyes-force-dark {
    filter: invert(1) hue-rotate(180deg);
    /* 反転前は白。反転後に暗くなるので、ページが背景色を持たなくても地は暗くなる */
    background-color: #ffffff;
  }
  /* 写真やロゴまで反転すると別物になるので、そこだけ戻す */
  html.dryeyes-force-dark img,
  html.dryeyes-force-dark video,
  html.dryeyes-force-dark canvas,
  html.dryeyes-force-dark picture,
  html.dryeyes-force-dark svg image {
    filter: invert(1) hue-rotate(180deg);
  }
</style>
<script>
(function() {
  var root = document.documentElement;

  // 自前でテーマを切り替えるページに、端末ではなく DryEyes の設定を答える
  try {
    var nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = function(query) {
      var result = nativeMatchMedia(query);
      if (typeof query === 'string' && query.indexOf('prefers-color-scheme') !== -1) {
        try {
          Object.defineProperty(result, 'matches', {
            value: query.indexOf('dark') !== -1,
            configurable: true,
          });
        } catch (e) {}
      }
      return result;
    };
  } catch (e) {}

  // 実際に見えている地の色の明るさ（0=黒 〜 1=白）。
  // body が透明ならその下の html を見る。どちらも透明ならブラウザ既定の白。
  function backgroundLightness() {
    var candidates = [document.body, root];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!el) continue;
      var matched = String(getComputedStyle(el).backgroundColor || '').match(/rgba?\\(([^)]+)\\)/);
      if (!matched) continue;
      var parts = matched[1].split(',').map(parseFloat);
      var alpha = parts.length > 3 ? parts[3] : 1;
      if (!alpha) continue;
      return (0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2]) / 255;
    }
    return 1;
  }

  function syncForcedDark() {
    root.classList.toggle('dryeyes-force-dark', backgroundLightness() > 0.5);
  }

  document.addEventListener('DOMContentLoaded', syncForcedDark);
  window.addEventListener('load', syncForcedDark);
  // 読み込み後にテーマを当てるページがあるので、少し待ってからもう一度見る
  setTimeout(syncForcedDark, 800);
})();
</script>
`;

// 実ブラウザが使えないときの保険。JS で描画される部分は出ないが、静的なページなら選べる。
async function fetchStaticHtml(targetUrl: string): Promise<string> {
  const response = await axios.get(targetUrl, {
    headers: {
      'User-Agent': RENDER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    responseType: 'text',
    timeout: 12000,
  });
  return response.data;
}

/**
 * ピッカーに流すページを取ってくる。
 *
 * 既定は素の HTML。取得が速く、たいていのページはこれで選べる。
 * useBrowser を立てるとクロールと同じブラウザで描画したものを返す。
 * 話数一覧のように JS が後から差し込む部分は素の HTML には無いので、
 * 「出ていない部分がある」と気づいたときだけ画面側から切り替えてもらう。
 *
 * dark はログイン中のユーザーが選んでいる表示テーマ。プレビューだけ真っ白、を避けるため、
 * ピッカーの枠と同じテーマでページを出す。
 */
export async function fetchProxyPage(
  targetUrl: string,
  useBrowser = false,
  dark = false
): Promise<string> {
  let html: string;
  let renderedWithBrowser = false;

  if (useBrowser) {
    try {
      html = await renderPageHtml(targetUrl, dark);
      renderedWithBrowser = true;
    } catch (err: any) {
      console.warn(
        `[picker] ブラウザ描画に失敗したため静的 HTML で表示します (${targetUrl}):`,
        err?.message
      );
      html = await fetchStaticHtml(targetUrl);
    }
  } else {
    html = await fetchStaticHtml(targetUrl);

    // SPA の起動用シェルは、そのまま iframe に入れても中身が組み上がらない。
    // 自前オリジンで配信する以上、ページ自身の module script は CORS で止まるため。
    // 崩れた枠を一度見せる意味は無いので、ここは頼まれなくても実ブラウザへ切り替える。
    if (isLikelyClientRenderedShell(html)) {
      try {
        html = await renderPageHtml(targetUrl, dark);
        renderedWithBrowser = true;
      } catch (err: any) {
        console.warn(
          `[picker] SPA と判定しましたがブラウザ描画に失敗しました (${targetUrl}):`,
          err?.message
        );
      }
    }
  }

  // どちらで描画したかを画面へ知らせる。ブラウザ描画を頼まれたのに落ちたときに、
  // 「押したのに何も変わらない」で終わらせないため。
  const modeScript =
    `<script>try{window.parent.postMessage({type:'DRYEYES_RENDER_MODE',` +
    `mode:'${renderedWithBrowser ? 'browser' : 'static'}'},'*');}catch(e){}</script>`;

  // <base href="..."> を挿入して相対パス（画像やCSS）を正しく読み込ませる。
  // Inspector はページ自身のスクリプトより先に動く必要があるので、同じ位置（<head> の先頭）へ入れる。
  const darkInjection = dark ? DARK_PREVIEW_INJECTION : '';
  // targetUrl はクエリからそのまま来るので、属性値として必ずエスケープする。
  // クエリ付き URL の & も実体参照になるが、属性値の解析時に元へ戻るので href は壊れない。
  const headInjection =
    `<base href="${escapeHtml(targetUrl)}">${INSPECTOR_SCRIPT}${darkInjection}${modeScript}`;
  const headMatch = html.match(/<head[^>]*>/i);
  const htmlMatch = html.match(/<html[^>]*>/i);
  if (headMatch) {
    html = html.replace(headMatch[0], `${headMatch[0]}${headInjection}`);
  } else if (htmlMatch) {
    html = html.replace(htmlMatch[0], `${htmlMatch[0]}<head>${headInjection}</head>`);
  } else {
    html = `${headInjection}${html}`;
  }

  return html;
}

export interface PageInfo {
  title: string;
  url: string;
  /** 静的 HTML が SPA の起動用シェルだったため、ピッカーも最初から描画済み DOM を使う。 */
  renderMode?: 'browser';
}

const META_TAG = /<meta\b[^>]*>/gi;

function textFromHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const JSON_LD_TAG = /<script\b[^>]*\btype\s*=\s*(['"])?application\/ld\+json\1[^>]*>([\s\S]*?)<\/script\s*>/gi;

/**
 * 構造化データ (JSON-LD) から名前を拾う。<title> も OGP も持たないページの最後の頼み。
 * 配列や @graph でぶら下げる書き方があるので、浅く辿って最初に見つけた名前を採る。
 */
function jsonLdTitleOf(html: string): string {
  for (const tag of html.matchAll(JSON_LD_TAG)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(tag[2]);
    } catch {
      continue; // 壊れた JSON-LD を置いているページは珍しくない
    }

    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== 'object') continue;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record['@graph'])) queue.push(...record['@graph']);
      for (const key of ['headline', 'name']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return textFromHtml(value);
      }
    }
  }
  return '';
}

function staticTitleOf(html: string): string {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title && textFromHtml(title)) return textFromHtml(title);

  const preferred = ['og:title', 'twitter:title'];
  for (const key of preferred) {
    for (const tag of html.match(META_TAG) || []) {
      const name = (attributeOf(tag, 'property') || attributeOf(tag, 'name') || '').toLowerCase();
      if (name !== key) continue;
      const content = attributeOf(tag, 'content');
      if (content) return textFromHtml(content);
    }
  }
  return jsonLdTitleOf(html);
}

/**
 * iframe へ静的 HTML を渡しても SPA の module script は別オリジン扱いで CORS に阻まれる。
 * 本文がほぼ空で module script とアプリ用 root があるものだけ、描画済みスナップショットを
 * 先に選ぶ。サイト名・ドメイン名には依存しない保守的な判定。
 */
export function isLikelyClientRenderedShell(html: string): boolean {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || '';
  const visibleText = textFromHtml(
    body.replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
  );
  const hasModule = /<script\b[^>]*\btype\s*=\s*(['"])?module\1[^>]*>/i.test(html);
  const hasAppRoot = /<(?:div|main)\b[^>]*\bid\s*=\s*(['"])?(?:app|root|__next)\1[^>]*>/i.test(body);
  return hasModule && hasAppRoot && visibleText.length < 80;
}

export async function getPageInfo(targetUrl: string): Promise<PageInfo> {
  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': RENDER_USER_AGENT,
      },
      responseType: 'text',
      timeout: 8000,
    });
    const html = typeof response.data === 'string' ? response.data : '';
    const staticTitle = staticTitleOf(html);
    if (!isLikelyClientRenderedShell(html)) {
      return { title: staticTitle || targetUrl, url: targetUrl };
    }

    try {
      // ピッカーが直後に開く描画と同じものを使う。スナップショットは短時間キャッシュされる
      // ので、ここで一度描いておけばピッカーはもう待たされない。
      const rendered = await renderPageHtml(targetUrl);
      return { title: staticTitleOf(rendered) || staticTitle || targetUrl, url: targetUrl, renderMode: 'browser' };
    } catch {
      // 描画ブラウザが一時的に使えなくても、ピッカー側は従来どおり静的 HTML へ戻れる。
      return { title: staticTitle || targetUrl, url: targetUrl, renderMode: 'browser' };
    }
  } catch {
    return { title: targetUrl, url: targetUrl };
  }
}

// ---------------------------------------------------------------------------
// プレビューが読む CSS とフォントの代理取得
// ---------------------------------------------------------------------------
//
// ウェブフォントは CORS 必須で、サイト自身が配るフォントは別オリジン（プレビューの iframe）
// から読めない。Inspector が <link rel="stylesheet"> を /api/proxy/asset へ向け直し、
// ここで CSS 内のフォント URL も同じエンドポイント経由へ書き換えて返す。
// 画像など CORS の要らないものは絶対 URL に直すだけで、BFF は通さない。

export type ProxyAssetKind = 'css' | 'font';

export interface ProxyAsset {
  contentType: string;
  body: Buffer | string;
}

const ASSET_TIMEOUT_MS = 12000;
const CSS_MAX_BYTES = 4 * 1024 * 1024;
// 日本語のフルセットフォントは 10MB を超えることがある
const FONT_MAX_BYTES = 32 * 1024 * 1024;

// url(...) は引用符あり・なしのどちらもある
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;
// @font-face の中括弧は入れ子にならない
const FONT_FACE_BLOCK = /@font-face\s*\{[^}]*\}/gi;
// @import url(...) と @import "..." の両方。後ろのメディア指定は触らない
const CSS_IMPORT = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)|"([^"]*)"|'([^']*)')/gi;

// CSS 内の参照を絶対 URL にする。data: などの埋め込みや http(s) 以外は触らない（null）
function resolveCssUrl(ref: string, base: string): string | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  try {
    const absolute = new URL(trimmed, base);
    return absolute.protocol === 'http:' || absolute.protocol === 'https:' ? absolute.href : null;
  } catch {
    return null;
  }
}

/**
 * /api/proxy/asset への参照。書き換えた CSS の中に置くので、その CSS 自身の URL
 * （.../proxy/asset?url=...）からの相対で書く。BFF は自分の公開 URL を知らないため。
 */
export function proxiedAssetRef(url: string, kind: ProxyAssetKind): string {
  return `asset?url=${encodeURIComponent(url)}&kind=${kind}`;
}

/**
 * BFF 経由で配る CSS の書き換え。
 *  1. 相対 URL を元の CSS の場所基準で絶対にする（配信元が変わるので、そのままだと壊れる）
 *  2. @font-face の中のフォントだけ BFF 経由にする（CORS を BFF 側で許可する）
 *  3. @import 先の CSS も同じ書き換えを通す
 */
export function rewriteCss(css: string, cssUrl: string): string {
  const absolutized = css.replace(CSS_URL, (whole, dq, sq, bare) => {
    const absolute = resolveCssUrl(dq ?? sq ?? bare ?? '', cssUrl);
    return absolute ? `url("${absolute}")` : whole;
  });

  const withFonts = absolutized.replace(FONT_FACE_BLOCK, (block) =>
    block.replace(CSS_URL, (whole, dq, sq, bare) => {
      const absolute = resolveCssUrl(dq ?? sq ?? bare ?? '', cssUrl);
      return absolute ? `url("${proxiedAssetRef(absolute, 'font')}")` : whole;
    })
  );

  return withFonts.replace(CSS_IMPORT, (whole, u1, u2, u3, s1, s2) => {
    const absolute = resolveCssUrl(u1 ?? u2 ?? u3 ?? s1 ?? s2 ?? '', cssUrl);
    return absolute ? `@import url("${proxiedAssetRef(absolute, 'css')}")` : whole;
  });
}

// DryEyes のオリジンから配る以上、ブラウザが HTML や SVG として描画しうる型は返さない。
// フォントらしい型だけ通し、それ以外はただのバイナリにする。
const FONT_CONTENT_TYPE = /^(font\/|application\/(font-|x-font-|vnd\.ms-fontobject|octet-stream))/i;

function fontContentType(upstream: unknown): string {
  const value = String(upstream || '').split(';')[0].trim().toLowerCase();
  return FONT_CONTENT_TYPE.test(value) ? value : 'application/octet-stream';
}

export async function fetchProxyAsset(targetUrl: string, kind: ProxyAssetKind): Promise<ProxyAsset> {
  const response = await axios.get(targetUrl, {
    headers: {
      'User-Agent': RENDER_USER_AGENT,
      Accept: kind === 'css' ? 'text/css,*/*;q=0.1' : '*/*',
    },
    responseType: 'arraybuffer',
    timeout: ASSET_TIMEOUT_MS,
    maxContentLength: kind === 'css' ? CSS_MAX_BYTES : FONT_MAX_BYTES,
  });
  const body = Buffer.from(response.data);

  if (kind === 'font') {
    return { contentType: fontContentType(response.headers?.['content-type']), body };
  }

  // リダイレクトされていたら、相対 URL の基準は最終的な置き場所
  const cssUrl: string = response.request?.res?.responseUrl || targetUrl;
  return { contentType: 'text/css; charset=utf-8', body: rewriteCss(body.toString('utf8'), cssUrl) };
}
