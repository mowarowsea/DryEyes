import axios from 'axios';

// 監視対象サイトのファビコンを取得する。
//
// ブラウザから `<img src="https://example.com/favicon.ico">` を直接読む方式では、
//   - /favicon.ico を置かず <link rel="icon"> で別パスを指す
//   - 既定の UA / Referer を見て 403 を返す
// といったサイトで軒並み失敗するため、BFF 側で HTML を読んで実際のアイコンを探す。
// 取得結果はオリジン単位でメモリにキャッシュする（監視 100 件でも実質 1 サイト 1 回）。

export interface FaviconAsset {
  contentType: string;
  data: Buffer;
}

const OK_TTL_MS = 24 * 60 * 60 * 1000;
// 見つからなかったサイトを毎回叩きに行かないよう、失敗も短めにキャッシュする
const FAIL_TTL_MS = 60 * 60 * 1000;
const MAX_BYTES = 512 * 1024;
const HTML_TIMEOUT_MS = 6000;
const ICON_TIMEOUT_MS = 6000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface CacheEntry {
  asset: FaviconAsset | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
// 同じオリジンの取得が同時に走らないよう、進行中の Promise を共有する
const inflight = new Map<string, Promise<FaviconAsset | null>>();

// テスト用にキャッシュを空にする
export function resetFaviconCache(): void {
  cache.clear();
  inflight.clear();
}

export async function getFavicon(pageUrl: string): Promise<FaviconAsset | null> {
  let origin: string;
  try {
    const parsed = new URL(pageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    origin = parsed.origin;
  } catch {
    return null;
  }

  const cached = cache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.asset;

  const running = inflight.get(origin);
  if (running) return running;

  const task = loadFavicon(pageUrl, origin)
    .catch(() => null)
    .then((asset) => {
      cache.set(origin, {
        asset,
        expiresAt: Date.now() + (asset ? OK_TTL_MS : FAIL_TTL_MS),
      });
      return asset;
    })
    .finally(() => {
      inflight.delete(origin);
    });

  inflight.set(origin, task);
  return task;
}

async function loadFavicon(pageUrl: string, origin: string): Promise<FaviconAsset | null> {
  const candidates = await iconCandidates(pageUrl, origin);

  for (const candidate of candidates) {
    const asset = await fetchIcon(candidate);
    if (asset) return asset;
  }
  return null;
}

// ページの <link rel="... icon ..."> を読み、最後の手段として /favicon.ico を足す
async function iconCandidates(pageUrl: string, origin: string): Promise<string[]> {
  const urls: string[] = [];

  try {
    const res = await axios.get(pageUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      responseType: 'text',
      timeout: HTML_TIMEOUT_MS,
      maxRedirects: 5,
      transformResponse: [(data: any) => data],
    });

    const html = typeof res.data === 'string' ? res.data : '';
    // <head> 以降を延々と走査しないよう、先頭だけ見れば十分
    for (const href of extractIconHrefs(html.slice(0, 200_000))) {
      try {
        // data: URI は扱わない（そのままでは画像として返せないため）
        if (/^data:/i.test(href)) continue;
        urls.push(new URL(href, res.request?.res?.responseUrl || pageUrl).toString());
      } catch {
        /* 壊れた href は捨てる */
      }
    }
  } catch {
    /* HTML が読めなくても /favicon.ico は試す */
  }

  urls.push(`${origin}/favicon.ico`);
  return [...new Set(urls)];
}

const LINK_TAG = /<link\b[^>]*>/gi;

// rel に icon を含む <link> の href を、宣言順に取り出す。
// rel="icon" / "shortcut icon" を先に、apple-touch-icon は後ろに回す。
export function extractIconHrefs(html: string): string[] {
  const primary: string[] = [];
  const fallback: string[] = [];

  for (const tag of html.match(LINK_TAG) || []) {
    const rel = (attributeOf(tag, 'rel') || '').toLowerCase();
    if (!rel.split(/\s+/).some((token) => token === 'icon' || token.endsWith('-icon'))) continue;

    const href = attributeOf(tag, 'href');
    if (!href) continue;

    if (rel.includes('apple-touch')) fallback.push(href);
    else primary.push(href);
  }

  return [...primary, ...fallback];
}

function attributeOf(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!match) return null;
  return (match[2] ?? match[3] ?? match[4] ?? '').trim() || null;
}

async function fetchIcon(url: string): Promise<FaviconAsset | null> {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
      responseType: 'arraybuffer',
      timeout: ICON_TIMEOUT_MS,
      maxRedirects: 5,
      maxContentLength: MAX_BYTES,
    });

    const contentType = String(res.headers['content-type'] || '').split(';')[0].trim();
    const data = Buffer.from(res.data);

    // 見つからないパスが HTML の 404 ページを 200 で返してくることがある
    if (data.length === 0 || data.length > MAX_BYTES) return null;
    if (!isImageContentType(contentType, url)) return null;

    return { contentType: contentType || 'image/x-icon', data };
  } catch {
    return null;
  }
}

function isImageContentType(contentType: string, url: string): boolean {
  if (contentType.startsWith('image/')) return true;
  // .ico を application/octet-stream や空の Content-Type で返すサーバーがある
  if (!contentType || contentType === 'application/octet-stream') {
    return /\.(ico|png|svg|jpe?g|gif|webp)(\?|$)/i.test(url);
  }
  return false;
}
