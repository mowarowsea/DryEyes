/**
 * 監視のタイトルから、蔵書 (Pinax) を引くための検索語を起こす。
 *
 * アップローダの記事タイトルは作品名のうしろに宣伝が全部ぶら下がっている:
 *
 *   最果てのパラディン raw 第01-15巻 [Saihate no Paradin vol 01-15] zip rar 無料ダウンロード
 *   [藤栄道彦] 最後のレストラン 第01-20巻
 *
 * これを丸ごと検索語にすると部分一致でも 1 件も当たらない。作品名が終わる位置は
 * 「巻数・ローマ字読み・拡張子・宣伝文句」のどれかが始まるところなので、
 * **最初に現れた印で切る**。サイトごとの知識は要らない。
 *
 * 外すことは当然あるので、これは検索欄の初期値にしか使わない。直せる場所に置く。
 */

/** 作品名の終わりを示す印。これより後ろは宣伝か巻数 */
const NOISE = [
  /\[/,                                      // [Saihate no Paradin vol 01-15]
  /[(（]/,                                    // (完) や (全15巻)
  /第\s*\d/,                                 // 第01-15巻 / 第84話
  /\b(?:v|vol|volume)\s*\.?\s*\d/i,          // v01-02s / vol 01
  /\b(?:raw|zip|rar|7z|dl|download|torrent)\b/i,
  /無料|ダウンロード|ダウソ/,
  /\d+\s*[-~－〜]\s*\d+\s*巻/,                // 01-15巻
  /全\s*\d+\s*巻/,
];

/** 頭に付く作者の括弧書き。`[藤栄道彦] 最後のレストラン` の前半 */
const LEADING_BRACKET = /^\s*[[【(（][^\]】)）]{1,40}[\]】)）]\s*/;

/** 切ったあとに残る区切り記号。`最果てのパラディン -` のような尻尾を落とす */
const TRAILING_JUNK = /[\s\-–—_|｜/／:：、,.。]+$/;

// 1 文字まで削れたものは作品名として使えない。`第3のギデオン` のように
// 印が題名そのものに含まれる場合はここで弾いて、元の文字列に戻す
const MIN_LENGTH = 2;

export function guessSeriesQuery(watchTitle: string | null | undefined): string {
  const source = (watchTitle ?? '').replace(LEADING_BRACKET, '').trim();
  if (!source) return '';

  let cut = source.length;
  for (const noise of NOISE) {
    const at = source.search(noise);
    if (at >= 0 && at < cut) cut = at;
  }

  const trimmed = source.slice(0, cut).replace(TRAILING_JUNK, '').trim();
  return trimmed.length >= MIN_LENGTH ? trimmed : source.replace(TRAILING_JUNK, '').trim();
}
