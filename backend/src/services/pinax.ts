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
  fileCount?: number;
  shelf?: { label?: string | null } | null;
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
      title: row.title,
      author: row.author ?? null,
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
