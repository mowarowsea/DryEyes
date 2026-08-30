import axios from 'axios';

// 注入する Element Inspector スクリプト
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
  document.head.appendChild(style);

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
    if (highlightedEl) {
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
    e.stopPropagation();

    const target = e.target;
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

export async function fetchProxyPage(targetUrl: string): Promise<string> {
  const urlObj = new URL(targetUrl);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

  const response = await axios.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    responseType: 'text',
    timeout: 12000,
  });

  let html = response.data;

  // <base href="..."> を挿入して相対パス（画像やCSS）を正しく読み込ませる
  const baseTag = `<base href="${targetUrl}">`;
  if (html.includes('<head>')) {
    html = html.replace('<head>', `<head>${baseTag}`);
  } else if (html.includes('<html>')) {
    html = html.replace('<html>', `<html><head>${baseTag}</head>`);
  } else {
    html = `${baseTag}${html}`;
  }

  // 末尾に Inspector スクリプトを挿入
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${INSPECTOR_SCRIPT}</body>`);
  } else {
    html += INSPECTOR_SCRIPT;
  }

  return html;
}

export async function getPageInfo(targetUrl: string): Promise<{ title: string; url: string }> {
  try {
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
