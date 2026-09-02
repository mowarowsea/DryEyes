import axios from 'axios';
import { RENDER_USER_AGENT } from './browserRender.js';
import { assertSafeRedirectTarget, hostChanged } from './urlSafety.js';

// 監視対象 URL がどこへ飛ばされているかを調べる。
//
// changedetection.io は内部でリダイレクトを追ってしまい、監視の url は元のまま残る。
// そのため「実は別ドメインの内容を見ている」状態に気づけない。ここでは BFF 自身が
// リダイレクトを 1 ホップずつ手で追い、最終的な行き先を突き止める。

const MAX_HOPS = 5;
const TIMEOUT_MS = 8000;

export interface RedirectTrace {
  finalUrl: string;
  chain: string[]; // 開始 URL から最終 URL まで（リダイレクトが無ければ 1 要素）
  status: number; // 最初のリダイレクトのステータス。リダイレクトが無ければ 0
  permanent: boolean; // 経路がすべて 301 / 308 のときだけ true
  hostChanged: boolean;
}

const isRedirectStatus = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

// HEAD を受け付けないサイトが一定数あるので、その場合だけ GET で取り直す。
// 本文は要らないので Range で先頭だけ求める（無視されても数 KB で切る）。
async function fetchHead(url: string): Promise<{ status: number; location?: string }> {
  const options = {
    maxRedirects: 0,
    timeout: TIMEOUT_MS,
    // 3xx を例外にせず自分で扱う。4xx / 5xx もリダイレクトではないというだけなので通す。
    validateStatus: () => true,
    headers: { 'User-Agent': RENDER_USER_AGENT },
  } as const;

  let res = await axios.head(url, options);
  if (res.status === 405 || res.status === 501) {
    res = await axios.get(url, {
      ...options,
      headers: { ...options.headers, Range: 'bytes=0-2047' },
      responseType: 'text',
      transformResponse: [(data: any) => data],
    });
  }

  const location = res.headers?.location;
  return { status: res.status, location: typeof location === 'string' ? location : undefined };
}

/**
 * startUrl から始めてリダイレクトを追い、最終的な行き先を返す。
 * 途中に内部アドレスへの誘導があれば、そこで例外を投げて追跡を打ち切る。
 */
export async function traceRedirects(startUrl: string): Promise<RedirectTrace> {
  const chain = [startUrl];
  let current = startUrl;
  let firstStatus = 0;
  let permanent = true;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const { status, location } = await fetchHead(current);
    if (!isRedirectStatus(status) || !location) break;

    // Location は相対のことがある（"/new-path" など）
    const next = new URL(location, current).toString();
    // ループしているリダイレクトを延々と追わない
    if (chain.includes(next)) break;

    await assertSafeRedirectTarget(next);

    if (firstStatus === 0) firstStatus = status;
    // 一度でも一時的リダイレクトを経由したら、経路全体を恒久とは見なさない
    if (status !== 301 && status !== 308) permanent = false;

    chain.push(next);
    current = next;
  }

  return {
    finalUrl: current,
    chain,
    status: firstStatus,
    permanent: firstStatus !== 0 && permanent,
    hostChanged: hostChanged(startUrl, current),
  };
}
