import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-auth-test-'));
process.env.DATA_DIR = tmpDir;

const {
  createUser,
  verifyCredentials,
  createSession,
  resolveSession,
  revokeSession,
  countUsers,
  toPublicUser,
  findPublicUserById,
  listOtherUsers,
  AuthError,
} = await import('../users.js');
const { assignOwner, isOwnedBy, releaseOwner, claimUnowned, pruneMissing, getOwner } =
  await import('../ownership.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('users', () => {
  beforeAll(() => {
    expect(countUsers()).toBe(0);
  });

  it('should register a user with a hashed password and a personal ntfy topic', () => {
    const user = createUser('alice', 'password');

    expect(user.username).toBe('alice');
    expect(user.passwordHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    // 平文が保存されていないこと
    expect(user.passwordHash).not.toContain('password');
    // ntfy が受け付ける文字だけのユーザー固有トピック
    expect(user.ntfyTopic).toMatch(/^[-_A-Za-z0-9]{1,64}$/);

    // クライアントへ返す表現に passwordHash が混入しない
    expect(toPublicUser(user)).not.toHaveProperty('passwordHash');
  });

  it('should give each user a different ntfy topic', () => {
    const bob = createUser('bob', 'password');
    const alice = verifyCredentials('alice', 'password');
    expect(bob.ntfyTopic).not.toBe(alice.ntfyTopic);
  });

  it('should reject duplicate usernames case-insensitively', () => {
    expect(() => createUser('ALICE', 'password')).toThrow(AuthError);
    expect(() => createUser('ALICE', 'password')).toThrow('既に使われています');
  });

  it('should validate username length but not password length', () => {
    expect(() => createUser('a', 'password')).toThrow('ユーザー名は2〜32文字');
    expect(() => createUser('carol', '')).not.toThrow();
  });

  it('should reject wrong credentials with the same message for unknown users', () => {
    expect(() => verifyCredentials('alice', 'wrong')).toThrow('ユーザー名またはパスワードが違います');
    expect(() => verifyCredentials('nobody', 'password')).toThrow('ユーザー名またはパスワードが違います');
  });

  it('should restore the previous user from a stored token, and drop it on logout', () => {
    const alice = verifyCredentials('alice', 'password');
    const { token } = createSession(alice.id);

    // ブラウザに保存したトークンで再ログインできる
    expect(resolveSession(token)?.id).toBe(alice.id);

    revokeSession(token);
    expect(resolveSession(token)).toBeNull();
    expect(resolveSession('')).toBeNull();
    expect(resolveSession('bogus-token')).toBeNull();
  });

  it('should persist users to disk so a BFF restart keeps them', () => {
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'auth.json'), 'utf-8'));
    expect(saved.users.map((u: any) => u.username)).toEqual(['alice', 'bob', 'carol']);
    expect(saved.users[0].passwordHash).toMatch(/^scrypt\$/);
  });

  it('should look up a public user by id without leaking the password hash', () => {
    const alice = verifyCredentials('alice', 'password');

    expect(findPublicUserById(alice.id)).not.toHaveProperty('passwordHash');
    expect(findPublicUserById(alice.id)?.username).toBe('alice');
    expect(findPublicUserById('no-such-id')).toBeNull();
  });

  it('should list every other user as copy-target candidates, sorted by name', () => {
    const alice = verifyCredentials('alice', 'password');
    const others = listOtherUsers(alice.id);

    expect(others.map((u) => u.username)).toEqual(['bob', 'carol']);
    expect(others.every((u) => !('passwordHash' in u))).toBe(true);
  });
});

describe('watch ownership', () => {
  it('should scope watches to their owner', () => {
    assignOwner('watch-1', 'user-a');
    assignOwner('watch-2', 'user-b');

    expect(isOwnedBy('watch-1', 'user-a')).toBe(true);
    expect(isOwnedBy('watch-1', 'user-b')).toBe(false);
    // 未登録の監視は誰のものでもない
    expect(isOwnedBy('watch-unknown', 'user-a')).toBe(false);

    releaseOwner('watch-1');
    expect(getOwner('watch-1')).toBeNull();
  });

  it('should let the first user adopt watches created before login existed', () => {
    assignOwner('watch-owned', 'user-b');
    const claimed = claimUnowned(['watch-orphan-1', 'watch-orphan-2', 'watch-owned'], 'user-a');

    expect(claimed).toEqual(['watch-orphan-1', 'watch-orphan-2']);
    // 既に所有者がいる監視は奪わない
    expect(getOwner('watch-owned')).toBe('user-b');
  });

  it('should forget owners of watches deleted outside DryEyes', () => {
    assignOwner('watch-gone', 'user-a');
    pruneMissing(['watch-owned']);
    expect(getOwner('watch-gone')).toBeNull();
    expect(getOwner('watch-owned')).toBe('user-b');
  });
});
