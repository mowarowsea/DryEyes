import crypto from 'node:crypto';
import { DiffLine } from '../types/index.js';

// 監視ページの増分と、実ページから取り出した要素を突き合わせる。
//
// スナップショットはテキストなので、差分から分かるのは「どの行が増えたか」までで、
// リンクの href は残らない。だから差分は検知だけに使い、URL は実ページから取る
// (ARCHITECTURE.md 5 章「差分テキストから URL は取れない」)。

/** 実ページから取り出したアイテム 1 件 */
export interface ExtractedItem {
  text: string;
  urls: string[];
}

// 短い行は何にでも当たってしまうので突き合わせに使わない
const MIN_LINE_LENGTH = 4;

export function normalizeText(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 差分から「増えた行」だけを取り出す */
export function addedLinesOf(lines: DiffLine[]): string[] {
  return lines
    .filter((l) => l.type === 'added')
    .map((l) => normalizeText(l.text))
    .filter((l) => l.length >= MIN_LINE_LENGTH);
}

/**
 * 増分に対応するアイテムだけを残す。
 *
 * スナップショットは行単位のテキスト、アイテムは要素のテキストなので、どちらが長いかは
 * ページの作りで変わる (1 行に収まることも、1 要素が数行になることもある)。
 * どちらかがどちらかを含んでいれば同じものとみなす。
 */
export function selectAddedItems(items: ExtractedItem[], addedLines: string[]): ExtractedItem[] {
  if (addedLines.length === 0) return [];
  return items.filter((item) => {
    const text = normalizeText(item.text);
    if (text.length < MIN_LINE_LENGTH) return false;
    return addedLines.some((line) => text.includes(line) || line.includes(text));
  });
}

export interface ItemMeta {
  title: string | null;
  author: string | null;
  volume: string | null;
  rawText: string;
}

/**
 * 監視ごとの正規表現でメタを取り出す。
 *
 * 名前付きキャプチャ (?<author>) (?<title>) (?<volume>) がそのまま PowerDowner へ渡る
 * フィールドになる。サイトごとに表記が違っても、監視の設定だけで吸収できて
 * DryEyes のコードにサイト固有の知識が入らない。
 *
 * 外れても rawText は必ず残す。抽出ルールは必ずどこかで外れる (表記変更、作画と原作で 2 人、
 * シリーズ名と巻数がくっつく) ので、生テキストがあれば後から読み直せる。
 */
export function applyPattern(text: string, pattern?: string | null): ItemMeta {
  const rawText = normalizeText(text);
  const plain: ItemMeta = { title: null, author: null, volume: null, rawText };
  if (!pattern) return plain;

  let matched: RegExpExecArray | null;
  try {
    // u フラグは付けない。付けるとエスケープの扱いが厳しくなり、
    // 手で書いた正規表現が「壊れている」と扱われやすくなる
    matched = new RegExp(pattern).exec(rawText);
  } catch {
    // 書き方が壊れている正規表現は「当たらなかった」と同じ扱いにする
    return plain;
  }
  if (!matched?.groups) return plain;

  const pick = (key: string): string | null => {
    const value = matched?.groups?.[key];
    return value ? value.trim() : null;
  };
  return { title: pick('title'), author: pick('author'), volume: pick('volume'), rawText };
}

/** 同じ行を二度候補にしないためのキー */
export function sourceKeyOf(watchId: string, text: string): string {
  const hash = crypto.createHash('sha1').update(normalizeText(text)).digest('hex').slice(0, 12);
  return `${watchId}:${hash}`;
}
