import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { JsonStore } from './store.js';
import { config } from '../config.js';
import { buildUserTopic } from './ntfyTopic.js';
import { AuthStoreData, PublicUser, UserRecord } from '../types/index.js';

const store = new JsonStore<AuthStoreData>('auth.json', { users: [], sessions: [] });

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function countUsers(): number {
  return store.get().users.length;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    ntfyTopic: user.ntfyTopic,
    createdAt: user.createdAt,
  };
}

export function createUser(username: string, password: string): UserRecord {
  const name = (username || '').trim();
  if (name.length < 2 || name.length > 32) {
    throw new AuthError('ユーザー名は2〜32文字で入力してください');
  }
  const pass = password || '';
  if (findByUsername(name)) {
    throw new AuthError('そのユーザー名は既に使われています', 409);
  }

  const id = randomUUID();
  const user: UserRecord = {
    id,
    username: name,
    passwordHash: hashPassword(pass),
    // ユーザー固有の ntfy トピック。この配下にしか通知が飛ばないので他ユーザーと混ざらない。
    ntfyTopic: buildUserTopic(name, id, config.ntfy.defaultTopic),
    createdAt: new Date().toISOString(),
  };

  store.update((data) => {
    data.users.push(user);
  });
  return user;
}

// 共有先を指定するときのユーザー名検索。存在有無を返すだけで passwordHash は含めない。
export function findPublicUserByUsername(username: string): PublicUser | null {
  const user = findByUsername((username || '').trim());
  return user ? toPublicUser(user) : null;
}

// 共有先一覧を表示するとき、保持している userId から表示用の情報へ引き直す
export function findPublicUserById(id: string): PublicUser | null {
  const user = store.get().users.find((u) => u.id === id);
  return user ? toPublicUser(user) : null;
}

export function verifyCredentials(username: string, password: string): UserRecord {
  const user = findByUsername((username || '').trim());
  // ユーザーの存在有無を漏らさないよう、どちらの失敗も同じ文言にする
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    throw new AuthError('ユーザー名またはパスワードが違います', 401);
  }
  return user;
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(
    Date.now() + config.auth.sessionTtlDays * 24 * 60 * 60 * 1000
  ).toISOString();

  store.update((data) => {
    // 期限切れセッションはこのタイミングで掃除しておく
    data.sessions = data.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
    data.sessions.push({ token, userId, createdAt: new Date().toISOString(), expiresAt });
  });

  return { token, expiresAt };
}

// ブラウザが保持しているトークンからユーザーを復元する（前回ログインの自動再開に使う）
export function resolveSession(token: string): UserRecord | null {
  if (!token) return null;
  const data = store.get();
  const session = data.sessions.find((s) => s.token === token);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    revokeSession(token);
    return null;
  }

  return data.users.find((u) => u.id === session.userId) || null;
}

export function revokeSession(token: string): void {
  if (!token) return;
  store.update((data) => {
    data.sessions = data.sessions.filter((s) => s.token !== token);
  });
}

function findByUsername(name: string): UserRecord | undefined {
  const key = name.toLowerCase();
  return store.get().users.find((u) => u.username.toLowerCase() === key);
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;

  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
