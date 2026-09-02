import { useEffect, useState } from 'react';
import { api } from '../api';

// 監視カードの背景画像を BFF から取ってくる。
//
// <img src> ではなく fetch で取るのは、このエンドポイントが Authorization を要求するため。
// 取れた Blob は object URL にしてセッション中は使い回す（並べ替えや再描画のたびに取り直さない）。

// watchId -> object URL（null は「この監視には絵が無い」と確定した印）
const cached = new Map<string, string | null>();

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

async function load(watchId: string): Promise<string | null> {
  await acquire();
  try {
    const blob = await api.getCardImageBlob(watchId);
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    // ログイン切れなどはカードの見た目の問題ではないので、絵なしとして扱う
    return null;
  } finally {
    release();
  }
}

/** カード背景の object URL。まだ取れていない・絵が無い監視では null。 */
export function useCardImage(watchId: string): string | null {
  const [url, setUrl] = useState<string | null>(() => cached.get(watchId) ?? null);

  useEffect(() => {
    if (cached.has(watchId)) {
      setUrl(cached.get(watchId) ?? null);
      return;
    }

    let alive = true;
    load(watchId).then((resolved) => {
      // 取得中に別の監視へ差し替わったら、作った object URL は解放して捨てる
      if (!alive) {
        if (resolved) URL.revokeObjectURL(resolved);
        return;
      }
      cached.set(watchId, resolved);
      setUrl(resolved);
    });

    return () => {
      alive = false;
    };
  }, [watchId]);

  return url;
}

/** 監視を削除・変更したときに、覚えている絵を捨てる */
export function forgetCardImage(watchId: string): void {
  const url = cached.get(watchId);
  if (url) URL.revokeObjectURL(url);
  cached.delete(watchId);
}
