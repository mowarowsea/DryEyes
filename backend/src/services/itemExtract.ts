import { evaluateOnPage } from './browserRender.js';
import { ExtractedItem } from './feedMatch.js';

/**
 * 監視しているページを実際に開いて、要素とその配下のリンクを取り出す。
 *
 * スナップショットはテキストなので href が残らない。差分は「どの行が増えたか」の検知だけに使い、
 * URL はここで実ページから取る (ARCHITECTURE.md 5 章)。
 *
 * 取り出す単位は「セレクタに当たった要素 1 つ」。DryEyes の要素ピッカーは一覧の 1 件を選ぶと
 * 同じ並び全部に当たる XPath を作るので (elementPath.ts の getSimilarXPath)、
 * それがそのまま「一覧の各行」になる。
 */

// ブラウザ側で動かすコードは文字列で持つ (BFF の tsconfig に DOM の型が無い)。
// changedetection.io のフィルタは CSS と XPath が混在しうるので両方を試す。
//
// テンプレートリテラルの中では、正規表現のバックスラッシュを二重にすること。
// `\s` と書いて初めてブラウザ側へ \s が渡る。一重だと無効なエスケープとして
// 潰れ、/\s+/ のつもりが「文字 s の連続」を消す /s+/ になってしまう。
// __tests__/itemExtract.test.ts で生成結果を見て防いでいる。
export const buildScript = (selectors: string[]): string => `(() => {
  const selectors = ${JSON.stringify(selectors)};
  const seen = new Set();
  const out = [];

  const collect = (el) => {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);

    // 要素自身がリンクのこともある (<a> が一覧の 1 行になっているページ)
    const anchors = [];
    if (el.matches && el.matches('a[href]')) anchors.push(el);
    anchors.push(...el.querySelectorAll('a[href]'));

    const urls = [];
    for (const a of anchors) {
      // href プロパティは相対 URL をページ基準で絶対化してくれる
      const href = a.href;
      if (!href || !/^https?:/i.test(href)) continue;
      if (!urls.includes(href)) urls.push(href);
    }

    const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) out.push({ text, urls });
  };

  for (const raw of selectors) {
    const selector = raw.replace(/^xpath1?:/, '');
    try {
      if (selector.startsWith('/') || selector.startsWith('(')) {
        const res = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < res.snapshotLength; i++) collect(res.snapshotItem(i));
      } else {
        document.querySelectorAll(selector).forEach(collect);
      }
    } catch (e) {
      // 書き方が壊れているセレクタは「当たらなかった」と同じ扱いにする
    }
  }
  return out;
})()`;

/**
 * セレクタに当たった要素を、テキストと配下のリンクの組で返す。
 * セレクタが無い (ページ全体を見ている) 監視は、どこを 1 件とみなせばよいか決まらないので空を返す。
 */
export async function extractItems(targetUrl: string, selectors: string[]): Promise<ExtractedItem[]> {
  const targets = selectors.map((s) => s.trim()).filter(Boolean);
  if (targets.length === 0) return [];
  const items = await evaluateOnPage<ExtractedItem[]>(targetUrl, buildScript(targets));
  return Array.isArray(items) ? items : [];
}
