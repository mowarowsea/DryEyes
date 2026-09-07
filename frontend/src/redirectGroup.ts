import { RedirectProposal, WatchModel } from './types';

// 移転の答えをまとめて効かせる単位は「転送元ホスト → 転送先ホスト」の組。
// サイト丸ごとの移転では同じ組の確認待ちが何十件も並ぶので、1 件に答えれば残りも同じ扱いにする。
// BFF と同じく、先頭の www. だけは無視してホストを比べる。

const hostKeyOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};

export function redirectPairKey(proposal: RedirectProposal): string | null {
  const from = hostKeyOf(proposal.fromUrl);
  const to = hostKeyOf(proposal.toUrl);
  return from && to ? `${from} -> ${to}` : null;
}

// この監視と同じ転送で確認待ちになっている、他の監視（まとめて処理される相手）
export function similarRedirectWatches(watches: WatchModel[], watch: WatchModel): WatchModel[] {
  const key = watch.pendingRedirect ? redirectPairKey(watch.pendingRedirect) : null;
  if (!key) return [];
  return watches.filter(
    (w) => w.id !== watch.id && !!w.pendingRedirect && redirectPairKey(w.pendingRedirect) === key
  );
}
