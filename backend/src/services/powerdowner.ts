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

  try {
    const res = await client.post<SendItemsResponse>(`${config.powerdowner.baseUrl}/api/jobs`, body, {
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
    throw new Error(`PowerDowner が投入を受け付けませんでした (${status}): ${message}`);
  }
}

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
