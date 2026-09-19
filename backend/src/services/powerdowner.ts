import axios from 'axios';
import { config } from '../config.js';
import { FeedCandidate } from '../types/index.js';

// PowerDowner (ダウンロード司令塔) への投入。
//
// こちらは「見つけたものを素直に渡す」だけで、どのミラーから落とすか・もう持っているかの
// 判断は向こうが持つ (ARCHITECTURE.md 5 章)。

/** POST /api/jobs (items 形式) の応答 */
export interface SendItemsResponse {
  created: { id: string; url: string; meta?: Record<string, unknown> }[];
  merged: { jobId: string; sourceKey: string | null; title: string | null; urls: string[] }[];
  skipped: { sourceKey: string | null; title: string | null; reason: string }[];
  invalid: { sourceKey: string | null; title: string | null; reason: string }[];
  truncated: number;
}

const client = axios.create({ timeout: 20_000 });

export async function sendItems(input: {
  userId: number;
  destDir: string | null;
  candidates: FeedCandidate[];
}): Promise<SendItemsResponse> {
  const body = {
    userId: input.userId,
    destDir: input.destDir || undefined,
    items: input.candidates.map((c) => ({
      urls: c.urls,
      sourceKey: c.sourceKey,
      source: `dryeyes:${c.watchId}`,
      meta: c.meta,
    })),
  };

  return post<SendItemsResponse>('/api/jobs', body, '投入を受け付けませんでした');
}

/** 投入・判定・所持登録で共通の POST。接続不能とトークン違いは原因が分かる文言にする */
async function post<T>(path: string, body: unknown, failure: string): Promise<T> {
  try {
    const res = await client.post<T>(`${config.powerdowner.baseUrl}${path}`, body, {
      headers: {
        'Content-Type': 'application/json',
        ...(config.powerdowner.token ? { Authorization: `Bearer ${config.powerdowner.token}` } : {}),
      },
    });
    return res.data;
  } catch (err: any) {
    const status = err?.response?.status;
    const message = err?.response?.data?.error || err?.message || String(err);
    if (status === 401) {
      throw new Error('PowerDowner に拒否されました。POWERDOWNER_TOKEN が config.json の apiToken と一致しているか確認してください');
    }
    if (!status) {
      throw new Error(`PowerDowner に接続できません (${config.powerdowner.baseUrl}): ${message}`);
    }
    throw new Error(`PowerDowner が${failure} (${status}): ${message}`);
  }
}

/** 投入先として選べるユーザー */
export interface PowerdownerUser {
  id: number;
  name: string;
  defaultDir: string | null;
}

export async function listUsers(): Promise<PowerdownerUser[]> {
  try {
    const res = await client.get<{ users: PowerdownerUser[] }>(`${config.powerdowner.baseUrl}/api/users`, {
      headers: config.powerdowner.token ? { Authorization: `Bearer ${config.powerdowner.token}` } : {},
    });
    return res.data.users ?? [];
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 401) {
      throw new Error('PowerDowner に拒否されました。POWERDOWNER_TOKEN が config.json の apiToken と一致しているか確認してください');
    }
    // 404 は「繋がったが PowerDowner ではない」。同じポートを別のサーバーが先に
    // 握っていると起きる (127.0.0.1 への束縛は 0.0.0.0 より優先される)。
    // ここを「取れません」で済ませると、投入先が ID の手入力に落ちた理由が分からない
    if (status === 404) {
      throw new Error(
        `${config.powerdowner.baseUrl} は応答しますが PowerDowner ではありません (/api/users が 404)。` +
          'そのポートを別のサーバーが握っていないか確認してください'
      );
    }
    throw new Error(`PowerDowner のユーザー一覧を取れません (${config.powerdowner.baseUrl}): ${err?.message || err}`);
  }
}

/** POST /api/items/check の 1 件分。投入せずに「もう持っているか」だけを調べた結果 */
export interface CheckResult {
  sourceKey: string | null;
  /** new: 未取得 / skip: 既に持っている / merge: ダウンロード中のものがある */
  state: 'new' | 'skip' | 'merge';
  reason: string | null;
  seriesKey: string;
  volumeFrom: number | null;
  volumeTo: number | null;
}

/**
 * 候補が既に手元にあるかを調べる。投入はしない。
 *
 * 結果を DryEyes 側に保存しないのは、答えの元 (棚と進行中のジョブ) が動くため。
 * 見せるたびに聞き直す。
 *
 * 判定はユーザー単位 (「落としている最中か」でそのユーザーのジョブを引く) なので、
 * 誰の手元の話かを必ず添える。
 */
export async function checkItems(userId: number, candidates: FeedCandidate[]): Promise<CheckResult[]> {
  if (candidates.length === 0) return [];
  const body = {
    userId,
    items: candidates.map((c) => ({
      urls: c.urls,
      sourceKey: c.sourceKey,
      meta: c.meta,
    })),
  };
  const res = await post<{ results: CheckResult[] }>('/api/items/check', body, '所持の判定に失敗しました');
  return res.results ?? [];
}

// 「これは既に持っている」を向こうへ登録する口 (POST /api/items) は無い。
// PowerDowner の取得済み台帳は廃止され、所持は棚 (pinax) を毎回読んで答えるものに
// なった (PowerDowner の docs/ROADMAP.md 2.5)。こちらから所持を書き込むと棚と
// 食い違うだけなので、対象外は DryEyes 側の印だけで済ませる。

/**
 * 応答を sourceKey ごとの説明に畳む。
 *
 * title は重複しうるので突き合わせに使えない。created だけは Job をそのまま返してくるので
 * meta.sourceKey から拾う。
 */
export function notesBySourceKey(res: SendItemsResponse): Map<string, string> {
  const notes = new Map<string, string>();

  for (const job of res.created ?? []) {
    const key = job.meta?.sourceKey;
    if (typeof key === 'string' && key) notes.set(key, `投入しました (ジョブ ${job.id})`);
  }
  for (const m of res.merged ?? []) {
    if (m.sourceKey) notes.set(m.sourceKey, `既にあるジョブにミラーとして合流しました (${m.jobId})`);
  }
  for (const s of res.skipped ?? []) {
    if (s.sourceKey) notes.set(s.sourceKey, s.reason);
  }
  for (const i of res.invalid ?? []) {
    if (i.sourceKey) notes.set(i.sourceKey, i.reason);
  }
  return notes;
}
