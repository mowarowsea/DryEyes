import { config } from '../config.js';
import { FeedCandidate } from '../types/index.js';
import { getCandidate, getFeedConfig, markSent } from './feedStore.js';
import { isOwnedBy } from './ownership.js';
import { notesBySourceKey, sendItems } from './powerdowner.js';

// 選ばれた候補を PowerDowner へ送る。
//
// 監視ごとに投入先ユーザーと保存先が違うので、監視単位にまとめてから送る。
// 1 回の上限 (PowerDowner 側も 20 件で切る) を超える分は分割して順に送る —
// 向こうに切り捨てさせると、切られた候補が pending のまま取り残される。

export interface SendSummary {
  /** PowerDowner が受け取った件数 (スキップ・合流も含む) */
  sent: number;
  results: { id: string; note: string }[];
  errors: { watchId: string; message: string }[];
  /** 送らなかったもの。所有していない / 既に送信済み / 設定が足りない */
  ignored: { id: string; reason: string }[];
}

export interface FeedSendDeps {
  send: typeof sendItems;
}

const defaultDeps: FeedSendDeps = { send: sendItems };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function sendCandidates(
  ids: string[],
  userId: string,
  deps: FeedSendDeps = defaultDeps
): Promise<SendSummary> {
  const summary: SendSummary = { sent: 0, results: [], errors: [], ignored: [] };

  // 監視ごとにまとめる。投入先ユーザーと保存先が監視の設定に付いているため
  const byWatch = new Map<string, FeedCandidate[]>();
  for (const id of ids) {
    const candidate = getCandidate(id);
    if (!candidate) {
      summary.ignored.push({ id, reason: '候補が見つかりません' });
      continue;
    }
    if (!isOwnedBy(candidate.watchId, userId)) {
      summary.ignored.push({ id, reason: '他のユーザーの監視です' });
      continue;
    }
    if (candidate.status === 'sent') {
      summary.ignored.push({ id, reason: '既に投入済みです' });
      continue;
    }
    const list = byWatch.get(candidate.watchId) ?? [];
    list.push(candidate);
    byWatch.set(candidate.watchId, list);
  }

  for (const [watchId, candidates] of byWatch) {
    const feedConfig = getFeedConfig(watchId);
    if (feedConfig.userId === null) {
      // 保存先を決められないまま投入すると、PowerDowner 側で 400 になるだけなので手前で止める
      summary.errors.push({ watchId, message: '投入先の PowerDowner ユーザーが未設定です' });
      for (const c of candidates) summary.ignored.push({ id: c.id, reason: '投入先ユーザーが未設定' });
      continue;
    }

    for (const batch of chunk(candidates, config.powerdowner.batchSize)) {
      try {
        const response = await deps.send({
          userId: feedConfig.userId,
          destDir: feedConfig.destDir,
          candidates: batch,
        });
        const notes = notesBySourceKey(response);

        for (const candidate of batch) {
          // 応答に現れなかったものは、向こうが切り捨てた分。pending のまま残して次の投入に回す
          const note = notes.get(candidate.sourceKey);
          if (!note) {
            summary.ignored.push({ id: candidate.id, reason: '上限を超えたため次回に回します' });
            continue;
          }
          markSent(candidate.id, note);
          summary.results.push({ id: candidate.id, note });
          summary.sent++;
        }
      } catch (err: any) {
        summary.errors.push({ watchId, message: err?.message || String(err) });
        for (const c of batch) summary.ignored.push({ id: c.id, reason: '投入に失敗しました' });
      }
    }
  }

  return summary;
}
