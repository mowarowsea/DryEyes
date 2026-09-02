// HTML を文字列のまま拾い読みするための共有ヘルパー。
// BFF は DOM パーサーを持たない（依存を増やさない）ため、favicon と
// カード画像のどちらも <link> / <meta> を正規表現で読む。

// タグ文字列から属性値をひとつ取り出す。値は "…" / '…' / 裸のいずれもありうる。
export function attributeOf(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!match) return null;
  return (match[2] ?? match[3] ?? match[4] ?? '').trim() || null;
}

const META_TAG = /<meta\b[^>]*>/gi;

// ページ作者が「このページの代表画像」として宣言したものを、優先度の高い順に返す。
// og:image が本命で、Twitter Card しか置いていないサイトのために両方見る。
const IMAGE_META_PRIORITY = [
  'og:image:secure_url',
  'og:image:url',
  'og:image',
  'twitter:image:src',
  'twitter:image',
];

export function extractSocialImageUrls(html: string): string[] {
  // 同じ property が複数回現れるサイトがあるので、優先度ごとに束ねてから並べ直す
  const byKey = new Map<string, string[]>();

  for (const tag of html.match(META_TAG) || []) {
    const key = (attributeOf(tag, 'property') || attributeOf(tag, 'name') || '').toLowerCase();
    if (!IMAGE_META_PRIORITY.includes(key)) continue;

    const content = attributeOf(tag, 'content');
    if (!content) continue;

    const list = byKey.get(key) || [];
    list.push(content);
    byKey.set(key, list);
  }

  const urls = IMAGE_META_PRIORITY.flatMap((key) => byKey.get(key) || []);
  return [...new Set(urls)];
}
