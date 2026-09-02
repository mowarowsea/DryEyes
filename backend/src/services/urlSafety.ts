import dns from 'node:dns/promises';

// 監視 URL の同一性判定と、リダイレクト先を叩く前の安全確認。
//
// リダイレクト追従はサーバー（BFF）が「相手に指定された URL」へ接続しに行く動作なので、
// そのまま追うと社内 LAN や localhost へ誘導されうる（SSRF）。
// このファイルの assertSafeRedirectTarget を通したものだけを追いかける。

// IPv4 の内部向けレンジ。ここへ向かうリダイレクトは追わない。
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^169\.254\./, // リンクローカル（クラウドのメタデータエンドポイントを含む）
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT / Tailscale
];

// 名前解決するまでもなく内部を指していると分かるホスト名
const INTERNAL_HOSTNAME = /(^|\.)(localhost|local|internal|localdomain|home|lan)$/i;

export function isPrivateAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (host.includes(':')) {
    // IPv6。ループバック・リンクローカル・ユニークローカル・IPv4 射影を弾く
    if (host === '::' || host === '::1') return true;
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10
    if (/^f[cd]/.test(host)) return true; // fc00::/7
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return PRIVATE_IPV4.some((re) => re.test(host));
}

/**
 * リダイレクト先として追ってよい URL かを確かめる。危険なら例外を投げる。
 *  - http / https 以外は追わない
 *  - ホスト名の見た目で内部と分かるものは追わない
 *  - 名前解決の結果が内部アドレスなら追わない（外部ドメインを内部へ向ける手口を塞ぐ）
 */
export async function assertSafeRedirectTarget(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`追跡できない URL です: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`http(s) 以外へのリダイレクトは追跡しません: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (INTERNAL_HOSTNAME.test(hostname)) {
    throw new Error(`内部ホストへのリダイレクトは追跡しません: ${hostname}`);
  }
  if (isPrivateAddress(hostname)) {
    throw new Error(`内部アドレスへのリダイレクトは追跡しません: ${hostname}`);
  }

  // IP リテラルでなければ実際に解決して確かめる。
  // 解決できないホストは「危険とは言い切れないが追う価値もない」ので、ここで止める。
  if (!/^[\d.]+$/.test(hostname) && !hostname.includes(':')) {
    let addresses: { address: string }[];
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      throw new Error(`名前を解決できませんでした: ${hostname}`);
    }
    if (addresses.some((a) => isPrivateAddress(a.address))) {
      throw new Error(`内部アドレスへ解決されるホストです: ${hostname}`);
    }
  }

  return parsed;
}

// ホストの先頭の www. だけを落とす。
// それ以外のサブドメイン（shop. / m. など）は別サイト扱いにして、必ず確認を挟む。
export function baseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * 「実質同じ URL」への正規化。自動で追従してよいかの判定に使う。
 *  - http は https と同じものとして扱う（アップグレードは実質同じページ）
 *  - 先頭の www. を無視する
 *  - 末尾のスラッシュを無視する
 * クエリとフラグメントは触らない。トラッキングやセッションが付いた URL は
 * 「実質同じ」ではなく、ユーザーに確認すべき変化なので。
 */
export function normalizeForCompare(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${baseHost(parsed.hostname)}${path}${parsed.search}${parsed.hash}`;
}

/**
 * 確認なしで追従してよい些細なリダイレクトか。
 * https 化・www の付け外し・末尾スラッシュだけの違いに限る。
 * https から http への降格は、たとえ同じページでも黙って追わない。
 */
export function isTrivialRedirect(fromUrl: string, toUrl: string): boolean {
  try {
    const from = new URL(fromUrl);
    const to = new URL(toUrl);
    if (from.protocol === 'https:' && to.protocol === 'http:') return false;
    return normalizeForCompare(fromUrl) === normalizeForCompare(toUrl);
  } catch {
    return false;
  }
}

// ホストが変わったか（www の有無だけの違いは変わっていないものとして扱う）
export function hostChanged(fromUrl: string, toUrl: string): boolean {
  try {
    return baseHost(new URL(fromUrl).hostname) !== baseHost(new URL(toUrl).hostname);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// プロキシ（ピッカーのプレビューとファビコン取得）の宛先チェック
// ---------------------------------------------------------------------------
//
// リダイレクト追従と違い、ここは「ユーザーが監視したい URL」を受ける口なので、
// 内部アドレスを一律に弾くと LAN 上の機器（NAS の管理画面など）を監視できなくなる。
// DryEyes 自体が LAN で動かすツールである以上、それは塞ぎすぎ。
//
// そこで遮断するのは、ユーザーが監視対象として指したいはずのない宛先だけに絞る。
//   - ループバック: BFF と同じホストに居る changedetection.io (:5000) と
//     sockpuppetbrowser の CDP (:3020)。プロキシ経由で叩かれると、
//     この 2 つを 127.0.0.1 に閉じ込めた意味が無くなる。
//   - リンクローカル: クラウドのメタデータエンドポイント (169.254.169.254)。
// 192.168.0.0/16 や 10.0.0.0/8 は通す。

const LOOPBACK_IPV4 = [
  /^127\./,
  /^0\./, // 0.0.0.0 は多くの実装でループバック扱いになる
  /^169\.254\./,
];

// 名前解決するまでもなくループバックと分かるホスト名
const LOOPBACK_HOSTNAME = /(^|\.)localhost$/i;

export function isLoopbackAddress(address: string): boolean {
  const host = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10 リンクローカル
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isLoopbackAddress(mapped[1]);
    return false;
  }

  return LOOPBACK_IPV4.some((re) => re.test(host));
}

/**
 * プロキシで取りに行ってよい URL かを確かめる。危険なら例外を投げる。
 * 通ってよい範囲は上のコメントのとおりで、LAN 内のアドレスは意図的に許可する。
 */
export async function assertSafeProxyTarget(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('取得できない URL です');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('http(s) 以外の URL は取得しません');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTNAME.test(hostname) || isLoopbackAddress(hostname)) {
    throw new Error('この端末自身を指す URL は取得しません');
  }

  // 外部ドメインをループバックへ向ける手口（localtest.me など）を塞ぐ。
  // IP リテラルは上で判定済みなので、名前のときだけ引く。
  if (!/^[\d.]+$/.test(hostname) && !hostname.includes(':')) {
    let addresses: { address: string }[];
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch {
      throw new Error(`名前を解決できませんでした: ${hostname}`);
    }
    if (addresses.some((a) => isLoopbackAddress(a.address))) {
      throw new Error('この端末自身へ解決されるホストです');
    }
  }

  return parsed;
}
