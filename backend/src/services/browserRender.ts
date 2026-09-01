import { chromium, Browser } from 'playwright-core';
import { config } from '../config.js';
import { LAZY_LOAD_SCROLL_JS } from './lazyLoadScroll.js';

// クロール (changedetection.io の html_webdriver) と揃えた User-Agent。
// 素の HeadlessChrome のままだと弾くサイトがあるため、通常の Chrome を名乗る。
export const RENDER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// 描画待ちの上限。sockpuppetbrowser 経由の実測は 7〜17 秒程度。
const CONNECT_TIMEOUT_MS = 8000;
const NAVIGATION_TIMEOUT_MS = 25000;
// 広告などで load イベントがいつまでも来ないページがあるので、DOM が出来た後の待ちは短く切る
const LOAD_TIMEOUT_MS = 8000;
// スクロールし終えてから、遅延読み込みの fetch が DOM に反映されるまでの待ち時間
const SETTLE_TIMEOUT_MS = 3000;

// ブラウザ側で評価するコード。BFF の tsconfig には DOM の型が無いので、
// 型チェックの対象にならないよう文字列で持つ。
const SNAPSHOT_SCRIPT = `(() => {
  // 遅延読み込みのまま src が入らなかった画像を、スナップショットでも出せるようにする
  document.querySelectorAll('img[data-src]').forEach((img) => {
    if (!img.getAttribute('src')) img.setAttribute('src', img.getAttribute('data-src') || '');
  });
  document.querySelectorAll('img[data-srcset]').forEach((img) => {
    if (!img.getAttribute('srcset')) img.setAttribute('srcset', img.getAttribute('data-srcset') || '');
  });

  // 静的スナップショットにする。iframe は広告や SNS ボタンで、監視対象にはならない。
  document.querySelectorAll('script, noscript, iframe, object, embed').forEach((el) => el.remove());
  // 後から差し込む <base> が効くよう、ページ自身の <base> は外す
  document.querySelectorAll('base').forEach((el) => el.remove());

  return '<!DOCTYPE html>' + document.documentElement.outerHTML;
})()`;

// ページを開き直すたびに Chrome を起動すると 10 秒以上待たされるので、短時間だけ使い回す
const SNAPSHOT_TTL_MS = 3 * 60 * 1000;
const SNAPSHOT_CACHE_LIMIT = 20;
const snapshotCache = new Map<string, { html: string; expiresAt: number }>();

function readCache(url: string): string | null {
  const hit = snapshotCache.get(url);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    snapshotCache.delete(url);
    return null;
  }
  return hit.html;
}

function writeCache(url: string, html: string): void {
  if (snapshotCache.size >= SNAPSHOT_CACHE_LIMIT) {
    // Map は挿入順なので、いちばん古い 1 件を捨てれば足りる
    const oldest = snapshotCache.keys().next().value;
    if (oldest !== undefined) snapshotCache.delete(oldest);
  }
  snapshotCache.set(url, { html, expiresAt: Date.now() + SNAPSHOT_TTL_MS });
}

export function clearSnapshotCache(): void {
  snapshotCache.clear();
}

/**
 * 監視対象ページを実ブラウザで開き、JS 実行後の DOM を静的な HTML として取り出す。
 *
 * ピッカーが素の HTML を iframe に流していた頃は、少年ジャンプ＋の話数一覧のように
 * JS が後から描画する部分がまるごと消えていた。しかも自前オリジンで配信する以上、
 * ページ側の API 呼び出しは CORS で必ず失敗するため、iframe の中で JS を動かしても直らない。
 * クロール側は html_webdriver（sockpuppetbrowser）で見ているので、ピッカーも同じ絵を見る。
 *
 * 取り出した HTML からは script / iframe を落として完全な静的スナップショットにする。
 * ページ自身の JS が動き直すと、せっかく描画された内容を「ローディング中…」で塗り潰したり、
 * SPA のルーターが画面遷移を起こしたりするため。
 */
export async function renderPageHtml(targetUrl: string): Promise<string> {
  const cached = readCache(targetUrl);
  if (cached) return cached;

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(config.browser.wsUrl, { timeout: CONNECT_TIMEOUT_MS });
    const context = await browser.newContext({
      userAgent: RENDER_USER_AGENT,
      locale: 'ja-JP',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // 到達できなかったときはここで例外にして、呼び出し元の静的 HTML へ落とす。
    // load まで待つと広告次第でいつまでも返らないので、DOM が出来た時点でいったん抜ける。
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response) throw new Error('ページを開けませんでした');
    await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);

    // 画面内に入って初めて中身を取りに行く要素（話数一覧など）を、末尾まで見て起こす
    await page.evaluate(LAZY_LOAD_SCROLL_JS);
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);

    const html = await page.evaluate<string>(SNAPSHOT_SCRIPT);
    if (typeof html !== 'string' || !html) throw new Error('描画結果の HTML を取り出せませんでした');

    await context.close().catch(() => undefined);
    writeCache(targetUrl, html);
    return html;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
