import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { JsonStore } from './store.js';
import { extractSocialImageUrls } from './htmlMeta.js';
import { findCardImageCandidates, RENDER_USER_AGENT } from './browserRender.js';
import {
  CardImageChoice,
  CardImageCrop,
  CardImageOptionsResponse,
  CardImageOverride,
  CardImageRecord,
  CardImageStoreData,
  WatchModel,
} from '../types/index.js';

// 監視カードの背景に敷く「そのページらしい絵」を決める。
//
// 「いい感じ」を絶対評価するのは無理なので、判断材料を二段構えで使う。
//   ① og:image / twitter:image
//      ページ作者自身が宣言した代表画像。判定を丸ごと任せられる代わりに、
//      作品ごとではなくサイト共通のロゴを返してくるプラットフォームがある。
//      共通画像だと見抜けるのは次の二通り。
//        ・同一オリジンの他の監視と URL がぶつかった。DryEyes は同じサイトを何件も
//          監視しているので、絶対評価ではなく相対評価でこれを見分けられる。
//        ・URL 自身がロゴだと名乗っている（/logo/ や -logo.svg）。初めて登録した
//          プラットフォームでも、ぶつかる相手を待たずに判断できる。
//   ② 監視対象セレクタの近くにある画像
//      「このページのどこが大事か」はピッカーで既に教えてもらっている。
//      ページ先頭ではなくそこを起点に探せば、同じプラットフォームの別作品でも別の絵になる。
//
// ①が信用できるならそのまま使い、怪しければ②を先に見て、②でも決まらなければ①へ戻る。
//
// 決まった絵はファイルに残す。毎回ページを開き直さないためと、
// ①の重複判定に他の監視の og:image が要るため。
//
// ここまでは全部「機械が推測した結果」なので、当たらないこともある。
// ユーザーがカードのメニューから絵を選び直したときはその指定 (override) を必ず優先し、
// 自動判定は一切走らせない。

const store = new JsonStore<CardImageStoreData>('watch-card-images.json', {
  images: {},
  overrides: {},
});

// 絵の決め方を変えたら上げる。上がっていれば、URL もセレクタも同じ記録を採り直させられる。
// v2: サイト共通のロゴらしい OGP を後回しにし、本文やプロフィール領域の絵を先に見るようにした。
export const RESOLVER_VERSION = 2;

// 一度決まった絵はそう変わらないので長め。監視 URL やセレクタを変えたら TTL 前でも採り直す。
const RESOLVED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 見つからなかったサイトを毎回開き直さないよう、失敗も覚えておく
const UNRESOLVED_TTL_MS = 6 * 60 * 60 * 1000;

const HTML_TIMEOUT_MS = 8000;
const IMAGE_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// 画像そのもののキャッシュ。カードは一覧に何十枚も並ぶので、毎回取りに行かせない。
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 取れなかったときは短く切る。一覧を開くと同じ配信元へ数十枚まとめて取りに行くことになり、
// 相手に絞られて数枚だけ落ちることがある。これを成功と同じ 24 時間覚えてしまうと、
// URL は正しく決まっているのに丸一日そのカードだけ絵が出ない。
const IMAGE_FAIL_TTL_MS = 10 * 60 * 1000;
const IMAGE_CACHE_LIMIT = 100;

export interface CardImageAsset {
  contentType: string;
  data: Buffer;
  // 中身から作る検証子。取り直して別の絵になったかを、画面側の HTTP キャッシュに伝える。
  etag: string;
}

const imageCache = new Map<string, { asset: CardImageAsset | null; expiresAt: number }>();
// 一覧を開くと全カードが同時に来るので、同じ監視の解決は 1 本にまとめる
const inflight = new Map<string, Promise<CardImageRecord>>();

// 解決には実ブラウザを 1 つ使うことがある。初回に全カード分が並走しないよう絞る。
const RESOLVE_CONCURRENCY = 3;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= RESOLVE_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// テスト用
export function resetCardImageCache(): void {
  imageCache.clear();
  inflight.clear();
}

export function selectorKeyOf(includeFilters: string[] | undefined): string {
  return (includeFilters || [])
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

// 記録が今の監視設定にそのまま使えるか。URL やセレクタが変わっていたら採り直す。
export function isFresh(
  record: CardImageRecord | undefined,
  pageUrl: string,
  selectorKey: string
): boolean {
  if (!record) return false;
  if (record.pageUrl !== pageUrl || record.selectorKey !== selectorKey) return false;
  // 決め方そのものを変えたときは、設定が同じでも採り直す
  if (record.resolverVersion !== RESOLVER_VERSION) return false;

  const age = Date.now() - new Date(record.resolvedAt).getTime();
  if (Number.isNaN(age)) return false;
  // ブラウザに繋げず OGP のまま置いた記録は、絵が決まっていても短く切る
  if (record.provisional) return age < UNRESOLVED_TTL_MS;
  return age < (record.imageUrl ? RESOLVED_TTL_MS : UNRESOLVED_TTL_MS);
}

/**
 * その og:image が、同一オリジンの他の監視でも出てきているか。
 *
 * 出てきていれば作品固有ではなくプラットフォーム共通の絵なので、両方とも採用しない。
 * 先に登録されていた側は既にその絵を採ってしまっているため、記録ごと捨てて採り直させる
 * （次にカードが表示されたときに②へ落ちる）。
 */
export function isSharedAcrossOrigin(watchId: string, pageUrl: string, imageUrl: string): boolean {
  const origin = originOf(pageUrl);
  if (!origin) return false;

  const collided = Object.entries(store.get().images).filter(
    ([id, record]) =>
      id !== watchId && record.socialImageUrl === imageUrl && originOf(record.pageUrl) === origin
  );
  if (collided.length === 0) return false;

  store.update((data) => {
    for (const [id] of collided) {
      // その絵を採用していた監視だけ無効化する。②で決めた記録は巻き込まない。
      if (data.images[id]?.source === 'social') delete data.images[id];
    }
  });
  return true;
}

async function fetchSocialImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await axios.get(pageUrl, {
      headers: { 'User-Agent': RENDER_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      responseType: 'text',
      timeout: HTML_TIMEOUT_MS,
      maxRedirects: 5,
      transformResponse: [(data: any) => data],
    });

    const html = typeof res.data === 'string' ? res.data : '';
    const baseUrl = res.request?.res?.responseUrl || pageUrl;
    // og:image は <head> に置かれる。本文まで舐める必要はない。
    for (const raw of extractSocialImageUrls(html.slice(0, 200_000))) {
      try {
        const resolved = new URL(raw, baseUrl);
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') return resolved.href;
      } catch {
        /* 壊れた URL は捨てる */
      }
    }
  } catch {
    /* HTML が読めなければ ② に任せる */
  }
  return null;
}

/**
 * OGP はサイト共通のロゴを返すことがある。ロゴと明示できる URL だけを低信頼にし、
 * それ以外の OGP は従来どおり優先する。プロフィール画像の /icons/ や /avatar/ は
 * ページ固有である場合が多いため、ここでは共通画像とみなさない。
 */
export function isLikelySiteWideSocialImage(imageUrl: string): boolean {
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase();
    return /(?:^|[/_.-])(logo|brand|favicon)(?:[/_.-]|$)/.test(pathname);
  } catch {
    return false;
  }
}

async function resolve(watchId: string, pageUrl: string, selectorKey: string): Promise<CardImageRecord> {
  const socialImageUrl = await fetchSocialImage(pageUrl);
  const sharedSocialImage = socialImageUrl
    ? isSharedAcrossOrigin(watchId, pageUrl, socialImageUrl)
    : false;
  const shouldPreferElement =
    !socialImageUrl || sharedSocialImage || isLikelySiteWideSocialImage(socialImageUrl);

  let imageUrl: string | null = null;
  let source: CardImageRecord['source'] = null;
  // 要素から選ぶつもりが、ブラウザへ繋げずに OGP へ落ちた状態。
  // 決まった絵をそのまま一週間抱え込まないよう、記録を短命にする目印にする。
  let provisional = false;

  if (shouldPreferElement) {
    try {
      const candidates = await findCardImageCandidates(pageUrl, selectorKey.split('\n').filter(Boolean));
      if (candidates.length > 0) {
        imageUrl = candidates[0].url;
        source = 'element';
      }
    } catch {
      // ブラウザに繋げないときは、低信頼 OGP でも従来どおりの表示を保つ。
      provisional = true;
    }
  }

  if (!imageUrl && socialImageUrl && !sharedSocialImage) {
    imageUrl = socialImageUrl;
    source = 'social';
  }

  const record: CardImageRecord = {
    pageUrl,
    selectorKey,
    imageUrl,
    socialImageUrl,
    source,
    resolvedAt: new Date().toISOString(),
    resolverVersion: RESOLVER_VERSION,
    provisional,
  };
  store.update((data) => {
    data.images[watchId] = record;
  });
  return record;
}

export async function resolveCardImage(watch: WatchModel): Promise<CardImageRecord> {
  const selectorKey = selectorKeyOf(watch.includeFilters);

  const cached = store.get().images[watch.id];
  if (isFresh(cached, watch.url, selectorKey)) return cached;

  const already = inflight.get(watch.id);
  if (already) return already;

  const task = withSlot(() => resolve(watch.id, watch.url, selectorKey)).finally(() => {
    inflight.delete(watch.id);
  });
  inflight.set(watch.id, task);
  return task;
}

function readImageCache(url: string): CardImageAsset | null | undefined {
  const hit = imageCache.get(url);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    imageCache.delete(url);
    return undefined;
  }
  return hit.asset;
}

function writeImageCache(url: string, asset: CardImageAsset | null): void {
  if (imageCache.size >= IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest !== undefined) imageCache.delete(oldest);
  }
  const ttl = asset ? IMAGE_CACHE_TTL_MS : IMAGE_FAIL_TTL_MS;
  imageCache.set(url, { asset, expiresAt: Date.now() + ttl });
}

// 中身の先頭数バイトから画像の種類を判定する。
// Content-Type を当てにできないため（カドコミの CDN は表紙を binary/octet-stream で返す）、
// 実物を見て決める。判定できたものだけを画像として扱い、正しい種類を付けて画面へ返す。
export function sniffImageType(data: Buffer): string | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x42, 0x4d)) return 'image/bmp';
  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  // ISO-BMFF。ftyp のブランドで AVIF / HEIC を見分ける
  if (data.toString('ascii', 4, 8) === 'ftyp') {
    const brand = data.toString('ascii', 8, 12);
    if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif';
    if (brand.startsWith('heic') || brand.startsWith('heix')) return 'image/heic';
  }
  // SVG はテキストなので、先頭の宣言かルート要素で見る
  const head = data.toString('utf8', 0, 256).trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

// 画像は BFF が代理で取る。Referer や UA を見て直リンクを弾くサイトがあるため、
// ブラウザから元の URL を直接読ませても表示できないことが多い。
async function fetchImage(imageUrl: string, pageUrl: string): Promise<CardImageAsset | null> {
  const cached = readImageCache(imageUrl);
  if (cached !== undefined) return cached;

  let asset: CardImageAsset | null = null;
  try {
    const res = await axios.get(imageUrl, {
      headers: {
        'User-Agent': RENDER_USER_AGENT,
        Accept: 'image/*',
        // そのページから読まれた画像として振る舞う（ホットリンク対策を素直に通る）
        Referer: pageUrl,
      },
      responseType: 'arraybuffer',
      timeout: IMAGE_TIMEOUT_MS,
      maxRedirects: 5,
      maxContentLength: MAX_IMAGE_BYTES,
    });

    const data = Buffer.from(res.data);
    const sniffed = data.length > 0 ? sniffImageType(data) : null;
    if (sniffed && data.length <= MAX_IMAGE_BYTES) {
      const etag = `"${crypto.createHash('sha1').update(data).digest('base64url')}"`;
      asset = { contentType: sniffed, data, etag };
    }
  } catch {
    asset = null;
  }

  writeImageCache(imageUrl, asset);
  return asset;
}

/**
 * カード背景として表示する画像と、その切り抜き指定。
 * 決められなければ null（画面側は今までどおりの見た目に戻る）。
 *
 * 切り抜きは画像そのものには焼き込まず、割合のまま画面へ渡して CSS で当てる。
 * カードの箱の大きさは端末ごとに違ううえ、エラー帯が出れば同じ端末でも変わるため、
 * BFF 側で切ってしまうと「その箱にちょうど合う絵」を作れない。
 */
export async function getCardImage(
  watch: WatchModel
): Promise<{ asset: CardImageAsset; crop: CardImageCrop | null } | null> {
  const override = getCardImageOverride(watch.id);

  if (override) {
    if (override.mode === 'none') return null;
    const crop = override.crop ?? null;

    if (override.mode === 'upload' && override.uploadFile) {
      const asset = readUploadedImage(override.uploadFile);
      return asset ? { asset, crop } : null;
    }
    if (override.mode === 'url' && override.imageUrl) {
      const asset = await fetchImage(override.imageUrl, watch.url);
      return asset ? { asset, crop } : null;
    }
    return null;
  }

  const record = await resolveCardImage(watch);
  if (!record.imageUrl) return null;
  const asset = await fetchImage(record.imageUrl, record.pageUrl);
  return asset ? { asset, crop: null } : null;
}

/** 監視を消したときに、その記録も消す */
export function clearCardImage(watchId: string): void {
  const data = store.get();
  if (!data.images[watchId] && !data.overrides[watchId]) return;
  removeUploadedImages(watchId);
  store.update((current) => {
    delete current.images[watchId];
    delete current.overrides[watchId];
  });
}

// ---------------------------------------------------------------------------
// ユーザーが自分で決めた背景
// ---------------------------------------------------------------------------

// 手元から登録された絵の置き場所。JSON に base64 で抱えると、
// 一覧を開くたびに全監視ぶんの画像を読み込むことになるのでファイルに出す。
const UPLOAD_DIR = path.join(config.dataDir, 'card-images');

const UPLOAD_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
};

// 監視 ID はそのままファイル名になるので、パスに使える文字だけに落とす。
// 所有者チェックを通った ID しか来ないが、名前の組み立てで外へ出られないことは
// 呼び出し元に頼らず、ここで保証する。
function uploadKeyOf(watchId: string): string {
  return watchId.replace(/[^a-zA-Z0-9_-]/g, '');
}

function removeUploadedImages(watchId: string): void {
  const key = uploadKeyOf(watchId);
  if (!key) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(UPLOAD_DIR);
  } catch {
    return; // まだ一度も登録されていない
  }
  for (const name of entries) {
    if (name !== key && !name.startsWith(`${key}.`)) continue;
    const full = path.join(UPLOAD_DIR, name);
    imageCache.delete(`file:${full}`);
    try {
      fs.unlinkSync(full);
    } catch {
      /* 消せなくても上書きで置き換わるので致命的ではない */
    }
  }
}

function readUploadedImage(fileName: string): CardImageAsset | null {
  // 保存したファイル名しか受け取らないが、記録が壊れていても外へ出ないようにする
  const full = path.join(UPLOAD_DIR, path.basename(fileName));
  const key = `file:${full}`;

  const cached = readImageCache(key);
  if (cached !== undefined) return cached;

  let asset: CardImageAsset | null = null;
  try {
    const data = fs.readFileSync(full);
    const contentType = sniffImageType(data);
    if (contentType) {
      const etag = `"${crypto.createHash('sha1').update(data).digest('base64url')}"`;
      asset = { contentType, data, etag };
    }
  } catch {
    asset = null;
  }

  writeImageCache(key, asset);
  return asset;
}

/**
 * 手元から登録された画像を保存し、ファイル名を返す。
 * 中身を見て種類を決めるのは取得した画像と同じ理由で、拡張子や Content-Type は当てにしない。
 */
export function saveUploadedCardImage(watchId: string, data: Buffer): string {
  const contentType = sniffImageType(data);
  if (!contentType) throw new Error('画像として読み取れないファイルです');
  if (data.length > MAX_IMAGE_BYTES) throw new Error('画像が大きすぎます');

  const key = uploadKeyOf(watchId);
  if (!key) throw new Error('監視 ID が不正です');

  // 拡張子が変わると古い絵が残るので、先に同じ監視のぶんを片付ける
  removeUploadedImages(watchId);

  const fileName = `${key}.${UPLOAD_EXTENSION[contentType] || 'img'}`;
  const full = path.join(UPLOAD_DIR, fileName);
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(full, data);
  imageCache.delete(`file:${full}`);
  return fileName;
}

export function getCardImageOverride(watchId: string): CardImageOverride | null {
  return store.get().overrides[watchId] ?? null;
}

export function setCardImageOverride(watchId: string, override: CardImageOverride | null): void {
  // 自動へ戻すときは、手元の絵も残さない
  if (!override || override.mode !== 'upload') removeUploadedImages(watchId);

  store.update((data) => {
    if (override) {
      data.overrides[watchId] = override;
      // 自動判定の記録は「今の設定でどう決まったか」でしかない。
      // 指定を外したときに古い絵へ戻らないよう、ここで捨てて採り直させる。
      delete data.images[watchId];
    } else {
      delete data.overrides[watchId];
      delete data.images[watchId];
    }
  });
}

/**
 * 背景に使えそうな画像の候補を集める。
 *
 * 自動判定と同じ材料（OGP と監視対象セレクタの近くの画像）を、順位付けだけして全部返す。
 * 「いい感じ」を機械が当て切れないのは分かっているので、最後は人が選べるようにする。
 * 監視対象サイトを実際にブラウザで開くため、応答には数十秒かかることがある。
 */
export async function listCardImageCandidates(watch: WatchModel): Promise<CardImageOptionsResponse> {
  const override = getCardImageOverride(watch.id);
  const selectors = selectorKeyOf(watch.includeFilters).split('\n').filter(Boolean);

  const [social, elements] = await Promise.all([
    fetchSocialImage(watch.url).catch(() => null),
    withSlot(() => findCardImageCandidates(watch.url, selectors)).catch(() => null),
  ]);

  // いま敷いている絵。指定があればそれ、無ければ自動判定の記録。
  const currentUrl =
    override?.mode === 'url'
      ? override.imageUrl || null
      : override
        ? null
        : (store.get().images[watch.id]?.imageUrl ?? null);

  const candidates: CardImageChoice[] = [];
  const seen = new Set<string>();
  const add = (url: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, current: url === currentUrl });
  };

  // ページ固有の絵から先に並べる。OGP はサイト共通のロゴであることがあるので後ろ。
  for (const item of elements || []) add(item.url);
  if (social) add(social);
  // 今の絵が候補に出てこないこともある（設定を変える前に決めた絵など）。
  // 選び直したあとで元に戻せるよう、必ず選択肢に残す。
  if (currentUrl) add(currentUrl);

  return {
    mode: override?.mode ?? 'auto',
    crop: override?.crop ?? null,
    // 一覧に並べても選べる数には限りがあるので、上位だけ返す
    candidates: candidates.sort((a, b) => Number(b.current) - Number(a.current)).slice(0, 6),
    browserFailed: elements === null,
  };
}

// ---------------------------------------------------------------------------
// 画面とのやり取り（切り抜きの受け渡し）
// ---------------------------------------------------------------------------

// 切り抜きは画像に添えてヘッダーで返す。値は「x,y,幅,高さ,元画像の縦横比」で、
// 位置と大きさは元画像に対する割合 (0..1)。
export function formatCrop(crop: CardImageCrop): string {
  return [crop.x, crop.y, crop.width, crop.height, crop.ratio].map((v) => v.toFixed(5)).join(',');
}

/**
 * 画面から届いた切り抜きを、そのまま信じずに範囲へ収める。
 * 壊れた値を覚えると、そのカードだけ絵が消えたり極端に拡大されたりして、
 * 画面から直す手立てもなくなる。
 */
export function normalizeCrop(crop: CardImageCrop | null | undefined): CardImageCrop | null {
  if (!crop) return null;
  const values = [crop.x, crop.y, crop.width, crop.height, crop.ratio];
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  if (crop.width <= 0 || crop.height <= 0 || crop.ratio <= 0) return null;

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
  const width = clamp(crop.width, 0.01, 1);
  const height = clamp(crop.height, 0.01, 1);
  return {
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
    ratio: clamp(crop.ratio, 0.01, 100),
  };
}

/**
 * 手元から登録された画像は data: URL で届く。
 * 中身が画像かどうかはここでは見ない。宣言された種類は当てにならないので、
 * 保存側が実物の先頭バイトを見て決める。
 */
export function decodeImageDataUrl(dataUrl: string | undefined): Buffer {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(dataUrl || '');
  if (!match) throw new Error('画像を読み取れませんでした');
  return Buffer.from(match[1], 'base64');
}

/** 候補のサムネイル。画面から直接読めないのはカード背景と同じ理由（Referer / UA で弾かれる）。 */
export function fetchCandidateImage(imageUrl: string, pageUrl: string): Promise<CardImageAsset | null> {
  return fetchImage(imageUrl, pageUrl);
}
