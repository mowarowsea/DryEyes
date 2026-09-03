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

// 同じ URL でも表示テーマが違えば別の絵になるので、キャッシュは分けて持つ
function cacheKey(url: string, dark: boolean): string {
  return `${dark ? 'dark' : 'light'} ${url}`;
}

function readCache(key: string): string | null {
  const hit = snapshotCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    snapshotCache.delete(key);
    return null;
  }
  return hit.html;
}

function writeCache(key: string, html: string): void {
  if (snapshotCache.size >= SNAPSHOT_CACHE_LIMIT) {
    // Map は挿入順なので、いちばん古い 1 件を捨てれば足りる
    const oldest = snapshotCache.keys().next().value;
    if (oldest !== undefined) snapshotCache.delete(oldest);
  }
  snapshotCache.set(key, { html, expiresAt: Date.now() + SNAPSHOT_TTL_MS });
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
 *
 * dark を立てるとブラウザ側の prefers-color-scheme をダークにして開く。JS でテーマを決める
 * ページは、その判断結果ごとスナップショットに焼き込まれる。
 */
export async function renderPageHtml(targetUrl: string, dark = false): Promise<string> {
  const key = cacheKey(targetUrl, dark);
  const cached = readCache(key);
  if (cached) return cached;

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(config.browser.wsUrl, { timeout: CONNECT_TIMEOUT_MS });
    const context = await browser.newContext({
      userAgent: RENDER_USER_AGENT,
      locale: 'ja-JP',
      viewport: { width: 1280, height: 900 },
      colorScheme: dark ? 'dark' : 'light',
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
    writeCache(key, html);
    return html;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * リダイレクト先のページで、その監視が見ている要素がまだ取れるかを確かめる。
 *
 * 移転先がミラーサイトなら同じセレクタで拾えるが、ドメイン失効後のパーキングページや
 * ログイン要求ページへ飛ばされている場合は何も当たらない。監視先の差し替えを提案する前に
 * ここで判定して、「監視している要素が見つかりません」と添えられるようにする。
 *
 * changedetection.io のフィルタは CSS と XPath が混在しうるので、両方を試す。
 */
export async function hasAnySelectorMatch(targetUrl: string, selectors: string[]): Promise<boolean> {
  const targets = selectors.map((s) => s.trim()).filter(Boolean);
  if (targets.length === 0) return false;

  // BFF の tsconfig には DOM の型が無いため、ブラウザ側で動かすコードは文字列で持つ
  const script = `(() => {
    const selectors = ${JSON.stringify(targets)};
    return selectors.some((raw) => {
      const selector = raw.replace(/^xpath1?:/, '');
      try {
        if (selector.startsWith('/') || selector.startsWith('(')) {
          const res = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          return res.snapshotLength > 0;
        }
        return document.querySelectorAll(selector).length > 0;
      } catch (e) {
        // 書き方が壊れているセレクタは「見つからなかった」と同じ扱いにする
        return false;
      }
    });
  })()`;

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(config.browser.wsUrl, { timeout: CONNECT_TIMEOUT_MS });
    const context = await browser.newContext({
      userAgent: RENDER_USER_AGENT,
      locale: 'ja-JP',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response) throw new Error('ページを開けませんでした');
    await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);

    // クロールと同じ条件で見るため、遅延読み込みもここで起こしておく
    await page.evaluate(LAZY_LOAD_SCROLL_JS);
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);

    const found = await page.evaluate<boolean>(script);
    await context.close().catch(() => undefined);
    return Boolean(found);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// カード背景の候補画像を探す
// ---------------------------------------------------------------------------

export interface CardImageCandidate {
  url: string;
  width: number;
  height: number;
  score: number;
  /** 同じ表示サイズで何枚も並んでいた（＝一覧のサムネイル）か */
  repeated?: boolean;
}

// ロゴ・スペーサー・ダミーの類。ファイル名で分かるものはここで落とす。
// icon / avatar / banner は落とさない。プロフィール画像やヘッダー画像は「そのページの絵」
// であることが多く、名前ではなく大きさと置き場所で判断した方が当たる。
const CARD_IMAGE_NOISE = 'logo|sprite|spacer|blank|dummy|no[-_]?image|placeholder|ad[-_]';

// ブラウザ側で評価するコード。BFF の tsconfig には DOM の型が無いので文字列で持つ。
// 監視対象セレクタにマッチした要素を起点に、そこから外へ数段だけ広げながら画像を集める。
// ページ先頭から探すとプラットフォーム共通のロゴを掴むが、起点をユーザーが選んだ
// 監視範囲にすれば「同じサイトの別作品」でも別の絵が採れる。
// String.raw なのは、埋め込む正規表現のバックスラッシュをそのまま渡すため
// （素のテンプレートリテラルだと  が 8 進エスケープとして解釈されてしまう）。
const CARD_IMAGE_SCRIPT = String.raw`(async (selectors, noisePattern) => {
  const MIN_SIDE = 100;      // これ以下は装飾アイコンとみなす
  const MAX_ASPECT = 4;      // 横長・縦長すぎるものは帯や区切り線
  // 監視要素からどこまで外へ広げるか。
  // 話数一覧を監視していると、起点は <a> ひとつぶんなので画像に行き当たるまで
  // 6〜7 段かかる（a → div → li → ul → nav → 一覧 → 作品情報）。浅すぎると何も採れない。
  const MAX_ANCESTOR_STEPS = 10;
  const noise = new RegExp(noisePattern, 'i');
  // ページ共通のクロム。ここに置かれた絵はどのページでも同じなので採らない。
  const PAGE_CHROME = 'nav,footer,aside,[role="banner"],[role="navigation"],[role="contentinfo"]';
  // <header> はサイト共通ヘッダーにも「その節の見出し」にも使われる。本文の中にある後者には
  // プロフィール画像や作品のメインビジュアルが入るので、落とすのは前者だけにする。
  const CONTENT_SECTION = 'main,article,section,[role="main"]';
  // 一覧のサムネイルは同じ表示サイズで何枚も並ぶ。ページを代表する絵としては単独で置かれた
  // 画像（プロフィール画像やメインビジュアル）の方が確からしいので、後で順位を落とす。
  // 枚数だけで見るので、クラス名の付け方や DOM の作りには依存しない。
  const REPEAT_THRESHOLD = 3;
  // 実寸を測るのは上位だけ。全部測ると一覧ページで数十枚ぶん待つことになる。
  const MEASURE_LIMIT = 12;
  const MEASURE_TIMEOUT_MS = 4000;

  const isPageChrome = (el) => {
    if (el.closest(PAGE_CHROME)) return true;
    const header = el.closest('header');
    return Boolean(header) && !header.closest(CONTENT_SECTION);
  };

  const resolveRoots = () => {
    const found = [];
    for (const raw of selectors) {
      const selector = raw.replace(/^xpath1?:/, '');
      try {
        if (selector.startsWith('/') || selector.startsWith('(')) {
          const res = document.evaluate(selector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
          for (let i = 0; i < res.snapshotLength; i++) {
            const node = res.snapshotItem(i);
            if (node && node.nodeType === 1) found.push(node);
          }
        } else {
          document.querySelectorAll(selector).forEach((el) => found.push(el));
        }
      } catch (e) {
        // 壊れたセレクタは無かったことにする
      }
    }
    // 監視範囲を指定していない（ページ全体監視）ときは本文全体から探す
    return found.length > 0 ? found.slice(0, 5) : [document.body].filter(Boolean);
  };

  const absolute = (raw) => {
    if (!raw) return null;
    const url = String(raw).trim().replace(/^url\(['"]?|['"]?\)$/g, '');
    if (!url || /^data:/i.test(url)) return null;
    try {
      const resolved = new URL(url, location.href);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
      return resolved.href;
    } catch (e) {
      return null;
    }
  };

  // srcset は指定された中でいちばん大きいものを使う（カード背景は大きいほど嬉しい）
  const fromSrcset = (value) => {
    const entries = String(value || '')
      .split(',')
      .map((part) => part.trim().split(/\s+/))
      .filter((parts) => parts[0]);
    if (entries.length === 0) return null;
    entries.sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0));
    return entries[0][0];
  };

  // 画像そのものの大きさ。表示サイズは CSS でいくらでも変えられるので、これで裏を取る。
  // 読めなかったものは null にして、今までどおり表示サイズだけの判断に任せる。
  const measure = (url) => new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => resolve(null);
    setTimeout(() => resolve(null), MEASURE_TIMEOUT_MS);
    probe.src = url;
  });

  const collected = new Map();

  const consider = (el, rawUrl, depth) => {
    const url = absolute(rawUrl);
    if (!url || noise.test(url)) return;

    const rect = el.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < MIN_SIDE || height < MIN_SIDE) return;

    const aspect = width / height;
    if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT) return;
    if (isPageChrome(el)) return;

    // <img> の表示サイズは CSS でいくらでも引き伸ばせる。矢印やアイコンの gif を
    // 掴まないよう、元画像の実寸も見る。読み込み前や CSS 背景は実寸が取れないので、
    // その場合は今までどおり表示サイズだけで判断する。
    if (el.naturalWidth && el.naturalHeight) {
      if (el.naturalWidth < MIN_SIDE || el.naturalHeight < MIN_SIDE) return;
    }

    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.1) return;

    // 監視要素から遠いほど「そのページ固有」である確度が下がるので割り引く
    let score = (width * height) / (depth + 1);
    // 説明のある画像は中身のある絵であることが多い
    if (el.getAttribute && (el.getAttribute('alt') || '').trim()) score *= 1.15;

    const prev = collected.get(url);
    if (!prev || prev.score < score) collected.set(url, { url, width, height, score });
  };

  const collectFrom = (root, depth) => {
    const before = collected.size;

    root.querySelectorAll('img').forEach((img) => {
      consider(img, img.currentSrc || img.getAttribute('src') || fromSrcset(img.getAttribute('srcset')), depth);
    });
    root.querySelectorAll('source[srcset]').forEach((source) => {
      const picture = source.closest('picture');
      const img = picture && picture.querySelector('img');
      if (img) consider(img, fromSrcset(source.getAttribute('srcset')), depth);
    });
    // CSS で敷いてある絵（漫画サイトのサムネイルはこの形が多い）
    root.querySelectorAll('*').forEach((el) => {
      const image = getComputedStyle(el).backgroundImage;
      if (!image || image === 'none') return;
      const match = image.match(/url\((['"]?)(.*?)\1\)/);
      if (match) consider(el, match[2], depth);
    });

    return collected.size > before;
  };

  const roots = resolveRoots();
  for (const root of roots) {
    let node = root;
    for (let depth = 0; depth <= MAX_ANCESTOR_STEPS && node; depth++) {
      // 近い階層で見つかったら、そこで打ち切って外へ広げない
      if (collectFrom(node, depth)) break;
      node = node.parentElement;
    }
  }

  // 同じ表示サイズのものしか採れていないなら、拾えたのは一覧のサムネイルだけ。
  // 一覧を監視しているとこうなる（投稿カードや話数一覧）。その一覧の外まで見て、
  // ページを代表する絵が別にあるかを確かめる。兄弟は祖先を共有するので起点は 1 つでよい。
  const onlyListItems = () => {
    const items = [...collected.values()];
    if (items.length < REPEAT_THRESHOLD) return false;
    const size = items[0].width + 'x' + items[0].height;
    return items.every((item) => item.width + 'x' + item.height === size);
  };

  if (roots.length > 0 && onlyListItems()) {
    let node = roots[0];
    for (let depth = 0; depth <= MAX_ANCESTOR_STEPS && node; depth++) {
      collectFrom(node, depth);
      node = node.parentElement;
    }
  }

  const found = [...collected.values()];
  const sameSize = new Map();
  for (const item of found) {
    const key = item.width + 'x' + item.height;
    sameSize.set(key, (sameSize.get(key) || 0) + 1);
  }
  for (const item of found) {
    item.repeated = sameSize.get(item.width + 'x' + item.height) >= REPEAT_THRESHOLD;
  }

  // 一覧の 1 枚より、単独で置かれている絵を先に出す。単独のものが無ければ今までどおり。
  const ranked = found
    .sort((a, b) => (a.repeated === b.repeated ? b.score - a.score : a.repeated ? 1 : -1))
    .slice(0, MEASURE_LIMIT);

  // CSS 背景は要素の大きさと画像の大きさが一致しない（16px の矢印を横長の帯の右端に
  // 置くだけ、など）。実物を読んで実寸を測り、装飾用の小さな画像をここで落とす。
  const measured = await Promise.all(ranked.map((item) => measure(item.url)));
  return ranked
    .filter((item, i) => !measured[i] || (measured[i].width >= MIN_SIDE && measured[i].height >= MIN_SIDE))
    .slice(0, 5);
})('PLACEHOLDER_SELECTORS', 'PLACEHOLDER_NOISE')`;

// ブラウザへ渡す完成形のコードを組み立てる。
// 文字列で持っている以上、崩れても TypeScript は気づけないのでテストから叩けるようにしておく。
export function buildCardImageScript(selectors: string[]): string {
  const targets = selectors.map((s) => s.trim()).filter(Boolean);
  return CARD_IMAGE_SCRIPT.replace("'PLACEHOLDER_SELECTORS'", JSON.stringify(targets)).replace(
    "'PLACEHOLDER_NOISE'",
    JSON.stringify(CARD_IMAGE_NOISE)
  );
}

/**
 * 監視対象セレクタの近くにある画像を、カード背景の候補として大きい順に返す。
 *
 * スクリーンショットは撮らない。実ブラウザを使うのは「セレクタを評価して、
 * 実際に描画されたサイズを測る」ためで、返すのは画像の URL だけ。
 * 素の HTML を正規表現で読む方式では、CSS 背景も遅延読み込みも表示サイズも分からない。
 */
export async function findCardImageCandidates(
  targetUrl: string,
  selectors: string[]
): Promise<CardImageCandidate[]> {
  const script = buildCardImageScript(selectors);

  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(config.browser.wsUrl, { timeout: CONNECT_TIMEOUT_MS });
    const context = await browser.newContext({
      userAgent: RENDER_USER_AGENT,
      locale: 'ja-JP',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    if (!response) throw new Error('ページを開けませんでした');
    await page.waitForLoadState('load', { timeout: LOAD_TIMEOUT_MS }).catch(() => undefined);

    // 画面内に入って初めて読み込まれるサムネイルを起こす
    await page.evaluate(LAZY_LOAD_SCROLL_JS);
    await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS }).catch(() => undefined);

    const candidates = await page.evaluate<CardImageCandidate[]>(script);
    await context.close().catch(() => undefined);
    return Array.isArray(candidates) ? candidates : [];
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
