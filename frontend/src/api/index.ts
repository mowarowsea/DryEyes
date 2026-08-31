import {
  WatchModel,
  CreateWatchDto,
  WatchHistoryItem,
  HealthStatus,
  AuthSession,
  MeResponse,
  WatchDiff,
  SharedUser,
} from '../types';

const API_BASE = '/api';
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
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error('Failed to fetch health status');
    return res.json();
  },

  async getPageInfo(url: string): Promise<{ title: string; url: string }> {
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

  async triggerCheck(id: string): Promise<void> {
    const res = await request(`/watches/${id}/check`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to trigger check');
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

  // --- 共有 -------------------------------------------------------------
  async getShares(id: string): Promise<SharedUser[]> {
    const res = await request(`/watches/${id}/shares`);
    if (!res.ok) throw new Error(await errorMessage(res, '共有先の取得に失敗しました'));
    return res.json();
  },

  async shareWatch(id: string, username: string): Promise<SharedUser[]> {
    const res = await request(`/watches/${id}/shares`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, '共有に失敗しました'));
    return res.json();
  },

  async unshareWatch(id: string, userId: string): Promise<void> {
    const res = await request(`/watches/${id}/shares/${userId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await errorMessage(res, '共有の解除に失敗しました'));
  },
};
