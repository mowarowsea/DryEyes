import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-sharing-test-'));
process.env.DATA_DIR = tmpDir;

const { shareWatch, unshareWatch, isSharedWith, getSharedUserIds, clearShares, pruneMissing } =
  await import('../sharing.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ALICE = 'user-alice';
const BOB = 'user-bob';

describe('sharing', () => {
  it('should grant access to a shared watch without duplicating entries', () => {
    expect(isSharedWith('watch-1', ALICE)).toBe(false);

    shareWatch('watch-1', ALICE);
    shareWatch('watch-1', ALICE);

    expect(isSharedWith('watch-1', ALICE)).toBe(true);
    expect(getSharedUserIds('watch-1')).toEqual([ALICE]);
  });

  it('should keep shares independent per watch', () => {
    shareWatch('watch-2', BOB);
    expect(isSharedWith('watch-1', BOB)).toBe(false);
    expect(isSharedWith('watch-2', BOB)).toBe(true);
  });

  it('should revoke access without affecting other shared users', () => {
    shareWatch('watch-1', BOB);
    unshareWatch('watch-1', ALICE);

    expect(isSharedWith('watch-1', ALICE)).toBe(false);
    expect(isSharedWith('watch-1', BOB)).toBe(true);
  });

  it('should persist shares to disk so a BFF restart keeps them', () => {
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'watch-shares.json'), 'utf-8'));
    expect(saved.shares['watch-1']).toEqual([BOB]);
  });

  it('should drop every share when the watch is deleted', () => {
    clearShares('watch-1');
    expect(getSharedUserIds('watch-1')).toEqual([]);
    // 他の監視は残る
    expect(isSharedWith('watch-2', BOB)).toBe(true);
  });

  it('should prune shares for watches that no longer exist', () => {
    shareWatch('watch-3', ALICE);
    pruneMissing(['watch-2']);

    expect(getSharedUserIds('watch-3')).toEqual([]);
    expect(getSharedUserIds('watch-2')).toEqual([BOB]);
  });
});
