import axios from 'axios';
import { config } from '../config.js';

// 蔵書の台帳 (Pinax) から、作者名と作品名の「棚での綴り」を借りてくる。
//
// 監視の投入設定には作者とタイトルを手で書くが、ここが 1 文字でも棚と違うと
// PowerDowner が付けるフォルダ名が既存のものと別になり、同じ作品が 2 箇所に割れる。
// 実際 `[奥橋睦×柳野かなた×輪くすさが] 最果てのパラディン` のような区切りは
// 覚えて打てるものではない。棚に既にある綴りを選ばせるのが一番確実で、速い。
//
// 読み取り専用。Pinax に何も書かないし、落ちていても投入設定は手入力で使える。

/** 投入設定の候補として出す、棚にある作品 1 件 */
export interface PinaxSeries {
  id: number;
  title: string;
  author: string | null;
  /** 手元にある冊数。同名の別作品や、名前だけ似た別シリーズを見分ける手がかり */
  files: number;
  /** 「続きが出ている — 8〜15巻が未所持」など。落とす価値があるかがここで分かる */
  shelf: string | null;
}

/** Pinax の /api/series が返す 1 件のうち、こちらで使う分だけ */
interface PinaxSeriesRow {
  id: number;
  title: string;
  author: string | null;
  /** 棚の実フォルダ名 `[作者] 作品名`。title / author はこれを表示用に整えたもの */
  folder?: string | null;
  fileCount?: number;
  shelf?: { label?: string | null } | null;
}

/**
 * 作者・作品名を、棚の実フォルダ名の綴りで取り出す。
 *
 * Pinax の title / author は表示用に全角記号を半角へ寄せてある
 * (`～Dahliya～` が `~Dahliya~` になる)。これをそのまま投入設定に使うと
 * PowerDowner が付けるフォルダ名が既存の棚と 1 文字ずれて、同じ作品が 2 箇所に割れる。
 * だから本物の綴りはフォルダ名から取る。
 *
 * 末尾の `(完)` は棚で完結の印に付けているもので、作品名ではないので外す。
 * 取り出したものが title / author と (表記揺れを除いて) 一致しないときは
 * フォルダ名の形が想定外ということなので、Pinax の値をそのまま使う。
 */
export function shelfSpelling(row: Pick<PinaxSeriesRow, 'title' | 'author' | 'folder'>): {
  title: string;
  author: string | null;
} {
  const fallback = { title: row.title, author: row.author ?? null };
  const m = (row.folder ?? '').match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!m) return fallback;

  const author = m[1].trim();
  const title = m[2].replace(/\s*[(（]完[)）]\s*$/, '').trim();
  const loose = (s: string | null | undefined) => (s ?? '').normalize('NFKC').trim();
  if (loose(title) !== loose(row.title) || loose(author) !== loose(row.author)) return fallback;

  return { title, author };
}

const client = axios.create({ timeout: 8_000 });

/**
 * 作者名・作品名の部分一致で棚を引く。
 *
 * 件数を絞るのは、これが「選ばせる」ための一覧だから。数十件並べると結局読めない。
 */
export async function searchSeries(q: string, limit = 8): Promise<PinaxSeries[]> {
  const query = q.trim();
  if (!query) return [];

  try {
    const res = await client.get<{ items?: PinaxSeriesRow[] }>(`${config.pinax.baseUrl}/api/series`, {
      params: { q: query, limit, sort: 'title' },
    });
    return (res.data.items ?? []).map((row) => ({
      id: row.id,
      ...shelfSpelling(row),
      files: row.fileCount ?? 0,
      shelf: row.shelf?.label ?? null,
    }));
  } catch (err: any) {
    const status = err?.response?.status;
    if (!status) {
      throw new Error(`蔵書 (Pinax) に接続できません (${config.pinax.baseUrl}): ${err?.message || err}`);
    }
    throw new Error(`蔵書 (Pinax) を引けません (${status}): ${err?.response?.data?.error || err?.message || err}`);
  }
}
