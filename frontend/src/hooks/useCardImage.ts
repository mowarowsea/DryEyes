import { useEffect, useState } from 'react';
import { api } from '../api';
import { CardImageCrop } from '../types';

// 監視カードの背景画像を BFF から取ってくる。
//
// <img src> ではなく fetch で取るのは、このエンドポイントが Authorization を要求するため。
// 取れた Blob は object URL にしてセッション中は使い回す（並べ替えや再描画のたびに取り直さない）。

/** カードに敷く絵。crop はユーザーが切り抜きを指定したときだけ入る。 */
export interface CardImageView {
  url: string;
  crop: CardImageCrop | null;
}

// watchId -> 敷く絵（null は「この監視には絵が無い」と確定した印）
const cached = new Map<string, CardImageView | null>();
// 取得中のもの。同じ監視を二重に取りに行かないよう、進行中の Promise を共有する。
const inflight = new Map<string, Promise<CardImageView | null>>();
// 表示中のカードへ「覚えている絵を捨てたから取り直して」と伝えるための購読先。
// 背景を選び直しても、その監視のカードは同じ ID のまま画面に残り続けるため、
// 記録を消すだけでは古い絵が出たままになる。
const listeners = new Map<string, Set<() => void>>();

// 未解決の監視は BFF 側でページを開きに行くので、1 件あたり数十秒かかることがある。
// 一覧を開いた瞬間に全カード分を投げるとブラウザの同時接続を食い潰し、
// 差分の取得など他の操作まで待たされるため、ここで絞る。
const MAX_PARALLEL = 2;
let running = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (running < MAX_PARALLEL) {
    running++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => queue.push(resolve));
}

function release(): void {
  const next = queue.shift();
  if (next) next();
  else running--;
}

async function load(watchId: string): Promise<CardImageView | null> {
  await acquire();
  try {
    const image = await api.getCardImage(watchId);
    return image ? { url: URL.createObjectURL(image.blob), crop: image.crop } : null;
  } catch {
    // ログイン切れなどはカードの見た目の問題ではないので、絵なしとして扱う
    return null;
  } finally {
    release();
  }
}

// 取得は必ず最後までやり切って結果を覚える。
// 呼び出し元が先に消えても捨てないのが要点で、以前はここで捨てていたために
// StrictMode の二重実行や一覧の再描画のたびに取り直しになり、
// 監視の件数が多いと後ろのカードがいつまでも絵にたどり着けなかった。
function acquireImage(watchId: string): Promise<CardImageView | null> {
  if (cached.has(watchId)) return Promise.resolve(cached.get(watchId) ?? null);

  const already = inflight.get(watchId);
  if (already) return already;

  const task = load(watchId).then((resolved) => {
    cached.set(watchId, resolved);
    inflight.delete(watchId);
    return resolved;
  });
  inflight.set(watchId, task);
  return task;
}

/**
 * カード背景の object URL と切り抜き。まだ取れていない・絵が無い監視では null。
 *
 * enabled を落とすと取りに行かない。背景を消している人の分まで
 * BFF がページを開きに行くのは無駄なので、要求そのものを出さない。
 */
export function useCardImage(watchId: string, enabled = true): CardImageView | null {
  const [image, setImage] = useState<CardImageView | null>(() => cached.get(watchId) ?? null);
  // 絵を捨てられたときに、この効果をもう一度走らせるための目印
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    acquireImage(watchId).then((resolved) => {
      if (alive) setImage(resolved);
    });
    return () => {
      alive = false;
    };
  }, [watchId, enabled, reloadToken]);

  useEffect(() => {
    const handler = () => {
      // 捨てた object URL は無効なので、取り直すまでは絵なしの見た目に戻す
      setImage(null);
      setReloadToken((token) => token + 1);
    };
    const subscribed = listeners.get(watchId) ?? new Set<() => void>();
    subscribed.add(handler);
    listeners.set(watchId, subscribed);

    return () => {
      subscribed.delete(handler);
      if (subscribed.size === 0) listeners.delete(watchId);
    };
  }, [watchId]);

  return enabled ? image : null;
}

/** 監視を削除・変更したときに、覚えている絵を捨てて、出ているカードにも取り直させる */
export function forgetCardImage(watchId: string): void {
  const image = cached.get(watchId);
  if (image) URL.revokeObjectURL(image.url);
  cached.delete(watchId);
  inflight.delete(watchId);
  listeners.get(watchId)?.forEach((notify) => notify());
}
