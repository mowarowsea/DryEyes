import axios from 'axios';
import crypto from 'node:crypto';
import { JsonStore } from './store.js';
import { RENDER_USER_AGENT } from './browserRender.js';
import { attributeOf } from './htmlMeta.js';
import { baseHost } from './urlSafety.js';

// アップロードサイトを作品名で横断検索する (pinax の「続きを探す」の受け口)。
//
// サイトごとに持つ知識は「検索 URL の形」だけにしてある。検索結果から作品ページを拾うのは
// 「リンクの文字に作品名が入っているか」で足りる (13dl / dlraw / dl-zip で確認)。
// 見張る場所 (XPath) や投入設定は台帳に書かず、同じサイトの既存の監視から引き継ぐ —
// 見本の 1 件を要素ピッカーで登録すれば、それがそのサイトの型になる。
//
// サイトはよく潰れるので、失敗が続いたら台帳に出して人が「使用する」を外す。
// 勝手に外さないのは PowerDowner のアップローダ台帳と同じ考え方。

export interface SearchSite {
  id: string;
  label: string;
  /** {q} を作品名に置き換える。空白は + にする (13dl / dlraw の検索がそうしている) */
  searchUrl: string;
  enabled: boolean;
  /** 最後に 1 件以上見つかった日時 */
  lastHitAt: string | null;
  /** 検索が続けて失敗した回数。成功したら 0 に戻す */
  failStreak: number;
  lastError: string | null;
}

interface SearchSiteStoreData {
  sites: SearchSite[];
}

const site = (id: string, label: string, searchUrl: string): SearchSite => ({
  id,
  label,
  searchUrl,
  enabled: true,
  lastHitAt: null,
  failStreak: 0,
  lastError: null,
});

// 2026-10-01 に 3 サイトとも Cloudflare 無しで素の HTML が返ることを確認した
const DEFAULT_SITES: SearchSite[] = [
  site('13dl', '13dl', 'https://ww14.13dl.app/search/{q}/'),
  site('dlraw', 'dlraw', 'https://dlraw.me/search-manga/{q}/'),
  site('dl-zip', 'dl-zip', 'https://dl-zip.com/?s={q}'),
];

const store = new JsonStore<SearchSiteStoreData>('search-sites.json', { sites: DEFAULT_SITES });

export function listSites(): SearchSite[] {
  return store.get().sites;
}

export function addSite(label: string, searchUrl: string): SearchSite {
  const created = site(crypto.randomUUID(), label, searchUrl);
  store.update((data) => {
    data.sites.push(created);
  });
  return created;
}

export function updateSite(
  id: string,
  patch: Partial<Pick<SearchSite, 'label' | 'searchUrl' | 'enabled'>>
): SearchSite | null {
  let updated: SearchSite | null = null;
  store.update((data) => {
    const target = data.sites.find((s) => s.id === id);
    if (!target) return;
    Object.assign(target, patch);
    // 直したら数え直す。URL を書き換えたのに赤いままだと、直ったかどうか分からない
    if (patch.searchUrl !== undefined || patch.enabled) {
      target.failStreak = 0;
      target.lastError = null;
    }
    updated = { ...target };
  });
  return updated;
}

export function removeSite(id: string): boolean {
  let removed = false;
  store.update((data) => {
    const before = data.sites.length;
    data.sites = data.sites.filter((s) => s.id !== id);
    removed = data.sites.length < before;
  });
  return removed;
}

function recordResult(id: string, hits: number, error: string | null): void {
  store.update((data) => {
    const target = data.sites.find((s) => s.id === id);
    if (!target) return;
    if (error) {
      target.failStreak += 1;
      target.lastError = error;
      return;
    }
    target.failStreak = 0;
    target.lastError = null;
    if (hits > 0) target.lastHitAt = new Date().toISOString();
  });
}

// ---------------------------------------------------------------------------
// 検索結果の読み取り
// ---------------------------------------------------------------------------

/**
 * 突き合わせ用に作品名を潰す。記号と空白を落とすのは画面の workKeyOf と同じ考え方
 * (`葬送のフリーレン` と `葬送の フリーレン` を同じにしたい)。
 */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　_\-‐–—~〜・,.、。!?！？'"“”‘’()（）[\]{}【】「」『』:：;；|/\\]/g, '');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// 作品ページではないリンク。検索し直しのリンクやタグの一覧が作品名を含んで並ぶ
const NOT_A_WORK_PAGE = /\/(?:tag|tags|search|search-manga|category|categories|genre|genres|page|author)\//i;

export interface SearchHit {
  url: string;
  text: string;
}

/** 検索結果の HTML から、作品名を含むリンクを拾う */
export function extractHits(html: string, pageUrl: string, query: string): SearchHit[] {
  const needle = normalizeTitle(query);
  if (!needle) return [];

  const host = baseHost(new URL(pageUrl).hostname);
  const byUrl = new Map<string, SearchHit>();

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attributeOf(`<a ${match[1]}>`, 'href');
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(decodeEntities(href), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || baseHost(url.hostname) !== host) continue;
    if (NOT_A_WORK_PAGE.test(url.pathname)) continue;

    const text = decodeEntities(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!normalizeTitle(text).includes(needle)) continue;

    url.hash = '';
    const key = url.toString();
    // 同じ作品ページへのリンクは画像と題名で 2 回出ることが多い。長い方 (題名) を残す
    const seen = byUrl.get(key);
    if (!seen || text.length > seen.text.length) byUrl.set(key, { url: key, text });
  }

  return [...byUrl.values()];
}

/** 検索 URL の型に作品名を埋める */
export function buildSearchUrl(template: string, query: string): string {
  const q = encodeURIComponent(query.trim()).replace(/%20/g, '+');
  return template.replace(/\{q\}/g, q);
}

// ---------------------------------------------------------------------------
// 横断検索
// ---------------------------------------------------------------------------

export interface SiteSearchResult {
  siteId: string;
  label: string;
  searchUrl: string;
  error: string | null;
  hits: (SearchHit & {
    /** 既に監視しているなら、その監視 */
    watchedId: string | null;
  })[];
}

const SEARCH_TIMEOUT_MS = 20_000;

async function fetchSearchPage(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    headers: { 'User-Agent': RENDER_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    responseType: 'text',
    timeout: SEARCH_TIMEOUT_MS,
  });
  return res.data;
}

export async function searchAllSites(
  query: string,
  /** 既に監視しているページならその監視 ID。重複の判定は登録前の確認と同じものを使う */
  watchedIdOf: (url: string) => string | null,
  fetchPage: (url: string) => Promise<string> = fetchSearchPage
): Promise<SiteSearchResult[]> {
  const sites = listSites().filter((s) => s.enabled);

  return Promise.all(
    sites.map(async (s): Promise<SiteSearchResult> => {
      const searchUrl = buildSearchUrl(s.searchUrl, query);
      try {
        const html = await fetchPage(searchUrl);
        const hits = extractHits(html, searchUrl, query).map((hit) => ({
          ...hit,
          watchedId: watchedIdOf(hit.url),
        }));
        recordResult(s.id, hits.length, null);
        return { siteId: s.id, label: s.label, searchUrl, error: null, hits };
      } catch (err: any) {
        const message = err?.response?.status ? `HTTP ${err.response.status}` : String(err?.message ?? err);
        recordResult(s.id, 0, message);
        return { siteId: s.id, label: s.label, searchUrl, error: message, hits: [] };
      }
    })
  );
}
