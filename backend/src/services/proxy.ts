import axios from 'axios';
import { renderPageHtml, RENDER_USER_AGENT } from './browserRender.js';

// 注入する Element Inspector スクリプト。
// <head> の先頭に置いて、ページ自身のスクリプトより先にリスナーを登録する。
// こうしないと、リンクやSPAのルーターに先回りされて画面が遷移してしまう。
const INSPECTOR_SCRIPT = `
<script>
(function() {
  let highlightedEl = null;

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
    }
  });

  // ---- 要素を選ぶための画面なので、ページ側の遷移は一切起こさせない ----

  // デフォルト動作（リンク遷移・フォーム送信）と、ページ自身のハンドラの両方を止める。
  // stopPropagation ではなく stopImmediatePropagation なのは、
  // ページが document に先に付けたリスナー（SPAのルーターなど）も黙らせるため。
  function blockEvent(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // デフォルト動作は残したまま（スクロールやクリック生成を壊さない）、
  // ページ側のハンドラだけを黙らせる。
  function muteEvent(e) {
    e.stopImmediatePropagation();
  }

  ['mousedown', 'mouseup', 'auxclick', 'submit', 'dragstart'].forEach(function(type) {
    document.addEventListener(type, blockEvent, true);
  });
  ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'keydown', 'keyup'].forEach(function(type) {
    document.addEventListener(type, muteEvent, true);
  });

  // クリック以外の遷移経路（新規ウィンドウ・SPAの履歴操作）も塞ぐ
  try { window.open = function() { return null; }; } catch (e) {}
  try {
    history.pushState = function() {};
    history.replaceState = function() {};
  } catch (e) {}

  // XPath 計算ヘルパー（厳密な単一要素）
  function getExactXPath(element) {
    if (element.id !== '') {
      return '//*[@id="' + element.id + '"]';
    }
    if (element === document.body) {
      return '/html/body';
    }

    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const parentPath = element.parentNode ? getExactXPath(element.parentNode) : '';
        return parentPath + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    return '';
  }

  // 類似要素XPath計算ヘルパー（リストやグリッド内の同種要素をまとめる）
  function getSimilarXPath(element, exactPath) {
    // 1. クラス名による汎用XPath
    if (element.className && typeof element.className === 'string') {
      const validClass = element.className.trim().split(/\\s+/).find(c => c && !c.startsWith('dryeyes-'));
      if (validClass) {
        const classXPath = '//' + element.tagName.toLowerCase() + '[contains(@class, "' + validClass + '")]';
        try {
          const res = document.evaluate(classXPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          if (res.snapshotLength > 1) {
            return { xpath: classXPath, count: res.snapshotLength };
          }
        } catch (e) {}
      }
    }

    // 2. 末尾付近の [1] [2] などのインデックスを除去して親コンテナからの汎用パターンを生成
    // 例: //*[@id="..."]/div/div/a[1]/p[1] -> //*[@id="..."]/div/div//p または a/p
    let generalized = exactPath.replace(/\\[\\d+\\]/g, (match, offset, string) => {
      // id指定部分以外のインデックスを外す
      return '';
    });

    if (generalized.startsWith('//*[@id=') || generalized.startsWith('/html/body')) {
      try {
        const res = document.evaluate(generalized, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (res.snapshotLength > 1) {
          return { xpath: generalized, count: res.snapshotLength };
        }
      } catch (e) {}
    }

    // 3. 親コンテナからの相対ワイルドカード
    // 末尾1〜2階層のインデックスを外す
    let strippedTail = exactPath.replace(/\\[\\d+\\](\\/[a-z0-9]+(\\[\\d+\\])?)$/i, '$1').replace(/\\[\\d+\\]$/i, '');
    if (strippedTail !== exactPath) {
      try {
        const res = document.evaluate(strippedTail, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (res.snapshotLength > 1) {
          return { xpath: strippedTail, count: res.snapshotLength };
        }
      } catch (e) {}
    }

    return { xpath: exactPath, count: 1 };
  }

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
    if (!xpath) return [];
    const texts = [];
    try {
      const res = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < res.snapshotLength; i++) {
        const node = res.snapshotItem(i);
        if (node && node.nodeType === 1) {
          const t = (node.innerText || node.textContent || '').trim().replace(/\\s+/g, ' ');
          if (t) {
            texts.push(t.substring(0, 100));
          }
        }
      }
    } catch (e) {}
    return texts;
  }

  // クリック/タップ
  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopImmediatePropagation();

    const target = e.target;
    if (!target || target.nodeType !== 1) return;
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
        tagName: target.tagName.toLowerCase()
      }
    }, '*');
  }, true);
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
 */
export async function fetchProxyPage(targetUrl: string, useBrowser = false): Promise<string> {
  let html: string;
  let renderedWithBrowser = false;

  if (useBrowser) {
    try {
      html = await renderPageHtml(targetUrl);
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
  }

  // どちらで描画したかを画面へ知らせる。ブラウザ描画を頼まれたのに落ちたときに、
  // 「押したのに何も変わらない」で終わらせないため。
  const modeScript =
    `<script>try{window.parent.postMessage({type:'DRYEYES_RENDER_MODE',` +
    `mode:'${renderedWithBrowser ? 'browser' : 'static'}'},'*');}catch(e){}</script>`;

  // <base href="..."> を挿入して相対パス（画像やCSS）を正しく読み込ませる。
  // Inspector はページ自身のスクリプトより先に動く必要があるので、同じ位置（<head> の先頭）へ入れる。
  const headInjection = `<base href="${targetUrl}">${INSPECTOR_SCRIPT}${modeScript}`;
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

export async function getPageInfo(targetUrl: string): Promise<{ title: string; url: string }> {
  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': RENDER_USER_AGENT,
      },
      responseType: 'text',
      timeout: 8000,
    });
    const html = response.data;
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = match ? match[1].trim() : '';
    return { title: title || targetUrl, url: targetUrl };
  } catch (e) {
    return { title: targetUrl, url: targetUrl };
  }
}
