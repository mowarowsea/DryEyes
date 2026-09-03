import {
  WatchModel,
  CreateWatchDto,
  WatchHistoryItem,
  HealthStatus,
  AuthSession,
  MeResponse,
  WatchDiff,
  PublicUser,
  CardImageCrop,
  CardImageOptions,
  SaveCardImageRequest,
} from '../types';
import { parseCropHeader } from '../cardImage';

// 画面はサブパス配下（例: /DryEyes/）に置かれることがあるため、API の URL も
// 配信パスを基準に組み立てる。import.meta.env.BASE_URL は必ず末尾スラッシュ付き。
const API_BASE = `${import.meta.env.BASE_URL}api`;

// 画面から直接 URL を組み立てたい箇所（iframe やファビコンの img）向け。
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
const TOKEN_KEY = 'dryeyes.token';

// ログイントークンはブラウザに保持し、次回アクセス時の自動再ログインに使う。
// プライベートウィンドウなどで localStorage が使えない場合もあるため必ず握り潰す。
export const authToken = {
  get(): string {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* 保存できなくてもセッション中は動作させる */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* noop */
    }
  },
};

// トークンが失効したときにログイン画面へ戻すためのフック（App から登録する）
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const token = authToken.get();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });

  if (res.status === 401) {
    // 期限切れ・別端末でのログアウトなど。保持しているトークンは捨てる。
    authToken.clear();
    onUnauthorized?.();
    throw new Error('ログインの有効期限が切れました。もう一度ログインしてください。');
  }

  return res;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({} as any));
  return body.message || fallback;
}

export const api = {
  // --- 認証 -------------------------------------------------------------
  async getAuthStatus(): Promise<{ hasUsers: boolean }> {
    const res = await fetch(`${API_BASE}/auth/status`);
    if (!res.ok) throw new Error('Failed to fetch auth status');
    return res.json();
  },

  async register(username: string, password: string): Promise<AuthSession> {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'ユーザー登録に失敗しました'));
    const session: AuthSession = await res.json();
    authToken.set(session.token);
    return session;
  },

  async login(username: string, password: string): Promise<AuthSession> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'ログインに失敗しました'));
    const session: AuthSession = await res.json();
    authToken.set(session.token);
    return session;
  },

  // 保存済みトークンから前回のユーザーを復元する
  async getMe(): Promise<MeResponse> {
    const res = await request('/auth/me');
    if (!res.ok) throw new Error('Failed to restore session');
    return res.json();
  },

  async logout(): Promise<void> {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // サーバー側の失効に失敗しても、手元のトークンは必ず捨てる
    }
    authToken.clear();
  },

  // --- 監視 -------------------------------------------------------------
  async getHealth(): Promise<HealthStatus> {
    const res = await request('/health');
    if (!res.ok) throw new Error('Failed to fetch health status');
    return res.json();
  },

  async getPageInfo(url: string): Promise<{ title: string; url: string; renderMode?: 'browser' }> {
    const res = await request(`/proxy/info?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { title: url, url };
    return res.json();
  },

  async getWatches(): Promise<WatchModel[]> {
    const res = await request('/watches');
    if (!res.ok) throw new Error('Failed to fetch watches');
    return res.json();
  },

  async getWatch(id: string): Promise<WatchModel> {
    const res = await request(`/watches/${id}`);
    if (!res.ok) throw new Error('Failed to fetch watch');
    return res.json();
  },

  async createWatch(data: CreateWatchDto): Promise<WatchModel> {
    const res = await request('/watches', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'Failed to create watch'));
    return res.json();
  },

  async updateWatch(id: string, data: Partial<WatchModel>): Promise<WatchModel> {
    const res = await request(`/watches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update watch');
    return res.json();
  },

  async deleteWatch(id: string): Promise<void> {
    const res = await request(`/watches/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete watch');
  },

  // コピー先の選択肢（コンボボックス/ボタン）に使う、自分以外のユーザー一覧
  async getUsers(): Promise<PublicUser[]> {
    const res = await request('/users');
    if (!res.ok) throw new Error('Failed to fetch users');
    return res.json();
  },

  // 同じ設定のまま、別ユーザーの所有物としてコピーを作成する
  async copyWatchTo(id: string, userId: string): Promise<{ title: string; username: string }> {
    const res = await request(`/watches/${id}/copy-to`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, 'コピーの作成に失敗しました'));
    return res.json();
  },

  async triggerCheck(id: string): Promise<void> {
    const res = await request(`/watches/${id}/check`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to trigger check');
  },

  // カードの背景に敷く画像と、その切り抜き指定。決められなかった監視は null を返す。
  // <img src> で直接読めないのは、このエンドポイントが Authorization を要求するため
  // （ファビコンと違い、監視 ID から本人の監視内容が見えることになるので認証を外せない）。
  async getCardImage(id: string): Promise<{ blob: Blob; crop: CardImageCrop | null } | null> {
    // cache: 'no-cache' で必ずサーバーへ問い合わせる。同じ URL のまま中身が変わりうるので、
    // ブラウザのキャッシュに寝かせると絵を採り直しても古いままになる
    // （実際、監視ごとの表紙に直したあとも共通画像が出続けた）。
    // 変わっていなければ ETag で 304 が返るだけなので、転送は起きない。
    const res = await request(`/watches/${id}/card-image`, { cache: 'no-cache' });
    if (!res.ok) return null;
    // 切り抜きは画像と同じ応答のヘッダーに載っている（カードの枚数だけ往復を増やさないため）
    return { blob: await res.blob(), crop: parseCropHeader(res.headers.get('X-Card-Image-Crop')) };
  },

  // 背景に使えそうな画像の候補。BFF が監視対象サイトを実際に開くので数十秒かかることがある。
  async getCardImageOptions(id: string): Promise<CardImageOptions> {
    const res = await request(`/watches/${id}/card-image/candidates`);
    if (!res.ok) throw new Error(await errorMessage(res, '候補の取得に失敗しました'));
    return res.json();
  },

  // 候補のサムネイル。カード背景と同じく BFF が代理で取る。
  async getCardImageCandidateBlob(id: string, url: string): Promise<Blob | null> {
    const res = await request(`/watches/${id}/card-image/candidate?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return res.blob();
  },

  // 背景の絵を決める（候補から選ぶ / 手元の画像を登録する / 絵なし / 自動へ戻す）
  async saveCardImage(id: string, body: SaveCardImageRequest): Promise<void> {
    const res = await request(`/watches/${id}/card-image`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorMessage(res, '背景画像の変更に失敗しました'));
  },

  async getHistory(id: string): Promise<WatchHistoryItem[]> {
    const res = await request(`/watches/${id}/history`);
    if (!res.ok) throw new Error('Failed to fetch history');
    return res.json();
  },

  // 前回この監視を確認した時点から、最新スナップショットまでの差分
  async getDiff(id: string): Promise<WatchDiff> {
    const res = await request(`/watches/${id}/diff`);
    if (!res.ok) throw new Error(await errorMessage(res, '差分の取得に失敗しました'));
    return res.json();
  },

  // 最新スナップショットまでを確認済みとして記録する
  async markViewed(id: string): Promise<void> {
    const res = await request(`/watches/${id}/viewed`, { method: 'POST' });
    if (!res.ok) throw new Error(await errorMessage(res, '既読の記録に失敗しました'));
  },

  // 検知した移転を承認して監視先を差し替える。
  // always を立てると、以後この行き先ドメインへの移動は確認なしで追従する。
  async acceptRedirect(id: string, always: boolean): Promise<{ url: string }> {
    const res = await request(`/watches/${id}/redirect/accept`, {
      method: 'POST',
      body: JSON.stringify({ always }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, '監視先の変更に失敗しました'));
    return res.json();
  },

  // 移転を却下して元の URL のまま監視を続ける。
  // always を立てると、以後この行き先への移動は提案されなくなる。
  async dismissRedirect(id: string, always: boolean): Promise<{ url: string }> {
    const res = await request(`/watches/${id}/redirect/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ always }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, '移転の却下に失敗しました'));
    return res.json();
  },
};
