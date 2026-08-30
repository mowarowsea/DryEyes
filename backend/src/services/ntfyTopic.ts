import { createHash } from 'node:crypto';

// ntfy のトピック名に使えるのは [-_A-Za-z0-9] のみ。表示名（日本語や空白を含む）を
// そのままトピックにすると ntfy 側で 404 になり通知が届かないため変換する。
export function toNtfyTopic(raw: string, fallback: string): string {
  const source = (raw || '').trim();
  if (!source) return fallback;

  const slug = slugify(source);

  // 数字だけ（例: 「第111話」→「111」）だと他の監視と衝突しやすいので、
  // 英字を含む 3 文字以上のスラグが取れたときだけ採用する
  if (slug.length >= 3 && /[A-Za-z]/.test(slug)) return slug;

  // 日本語タイトルなどで有効な文字が残らない場合は、タイトル由来のハッシュで一意なトピックにする
  return `${fallback}-${shortHash(source)}`.slice(0, 64);
}

// ユーザーごとの固有トピック。ユーザー名が日本語でも必ず有効なトピックになるよう、
// スラグ + ユーザーID 由来のハッシュで構成する。ハッシュがあるので他ユーザーとは衝突しない。
export function buildUserTopic(username: string, userId: string, prefix: string): string {
  const slug = slugify(username).slice(0, 20);
  const suffix = shortHash(userId).slice(0, 6);
  return [prefix, slug, suffix].filter(Boolean).join('-').slice(0, 64);
}

// 監視ごとのトピックを、必ずそのユーザーのトピック配下に閉じ込める。
// これにより別ユーザーが同じ表示名で監視を作っても通知が混ざらない。
export function scopeTopicToUser(userTopic: string, watchTopic?: string): string {
  const requested = (watchTopic || '').trim();
  // 未指定、またはユーザートピックそのものなら、そのユーザーの共通トピックへ送る
  if (!requested || requested === userTopic) return userTopic;
  // 既にスコープ済み（保存済み監視の更新など）ならそのまま使う
  if (requested.startsWith(`${userTopic}-`)) return requested.slice(0, 64);

  const suffix = toNtfyTopic(requested, shortHash(requested)).slice(0, 24);
  return `${userTopic}-${suffix}`.slice(0, 64);
}

// changedetection.io は通知先を Apprise 形式で受け取るため、生の http:// URL は
// "is not a valid AppRise URL" で 400 になる。ntfy:// (TLS なら ntfys://) に変換する。
// clickUrl を渡すと ntfy の Click ヘッダーとして送られ、通知タップ時に開く URL になる。
export function toAppriseNtfyUrl(baseUrl: string, topic: string, clickUrl?: string): string {
  const parsed = new URL(baseUrl);
  const scheme = parsed.protocol === 'https:' ? 'ntfys' : 'ntfy';
  const port = parsed.port ? `:${parsed.port}` : '';
  const query = clickUrl ? `?click=${encodeClickParam(clickUrl)}` : '';
  return `${scheme}://${parsed.hostname}${port}/${topic}${query}`;
}

// changedetection.io は通知本文だけでなく通知 URL にも Jinja トークンを展開する。
// これを使うと監視ごとに URL を作り分けなくても、通知タップ先をその監視の差分にできる。
const WATCH_UUID_TOKEN = '{{watch_uuid}}';

// ntfy 通知をタップしたときに開く URL（DryEyes を開いてその監視の差分を表示する）
export function buildWatchClickUrl(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/?watch=${WATCH_UUID_TOKEN}`;
}

// 既存の通知 URL の click だけを差し替える。トピックや他のパラメータはそのまま残す。
export function withClickParam(appriseUrl: string, clickUrl: string): string {
  const [base, query = ''] = appriseUrl.split('?');
  const params = query.split('&').filter((param) => param && !param.startsWith('click='));
  params.push(`click=${encodeClickParam(clickUrl)}`);
  return `${base}?${params.join('&')}`;
}

// click はクエリの値なのでエンコードするが、Jinja トークンの波括弧だけは
// エンコードすると展開されなくなるため素のまま残す。
function encodeClickParam(url: string): string {
  return encodeURIComponent(url).replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}');
}

function slugify(source: string): string {
  return source
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function shortHash(source: string): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 8);
}
