import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-view-test-'));
process.env.DATA_DIR = tmpDir;

const { getViewState, markViewed, hasUnviewedChange, clearViewStates, pruneViewStates } =
  await import('../viewState.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ALICE = 'user-alice';
const BOB = 'user-bob';

describe('viewState', () => {
  it('should treat a never-viewed watch with changes as unread', () => {
    expect(getViewState(ALICE, 'watch-1')).toBeNull();
    expect(hasUnviewedChange(ALICE, 'watch-1', 1_700_000_000)).toBe(true);
  });

  it('should not mark a watch without any recorded change as unread', () => {
    // 初回スナップショットのみの監視は last_changed が 0 になる
    expect(hasUnviewedChange(ALICE, 'watch-1', 0)).toBe(false);
    expect(hasUnviewedChange(ALICE, 'watch-1', null)).toBe(false);
  });

  it('should clear the unread state once the latest snapshot is viewed', () => {
    markViewed(ALICE, 'watch-1', 1_700_000_000);

    expect(hasUnviewedChange(ALICE, 'watch-1', 1_700_000_000)).toBe(false);
    // その後さらに変更されたら再び未読になる
    expect(hasUnviewedChange(ALICE, 'watch-1', 1_700_000_500)).toBe(true);
  });

  it('should keep the viewed state separate per user', () => {
    // alice は watch-1 を確認済みだが bob は未確認
    expect(hasUnviewedChange(ALICE, 'watch-1', 1_700_000_000)).toBe(false);
    expect(hasUnviewedChange(BOB, 'watch-1', 1_700_000_000)).toBe(true);

    markViewed(BOB, 'watch-1', 1_700_000_000);
    expect(hasUnviewedChange(BOB, 'watch-1', 1_700_000_000)).toBe(false);
  });

  it('should record when the user viewed it', () => {
    const state = markViewed(ALICE, 'watch-2', 1_700_000_900);

    expect(state.snapshotTimestamp).toBe(1_700_000_900);
    expect(Number.isNaN(Date.parse(state.viewedAt))).toBe(false);
    expect(getViewState(ALICE, 'watch-2')).toEqual(state);
  });

  it('should persist the viewed state to disk so a BFF restart keeps it', () => {
    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, 'watch-views.json'), 'utf-8'));

    expect(saved.views[`${ALICE}:watch-1`].snapshotTimestamp).toBe(1_700_000_000);
    expect(saved.views[`${BOB}:watch-1`].snapshotTimestamp).toBe(1_700_000_000);
  });

  it('should drop every user state when the watch is deleted', () => {
    clearViewStates('watch-1');

    expect(getViewState(ALICE, 'watch-1')).toBeNull();
    expect(getViewState(BOB, 'watch-1')).toBeNull();
    // 他の監視は残る
    expect(getViewState(ALICE, 'watch-2')).not.toBeNull();
  });

  it('should prune states for watches that no longer exist', () => {
    markViewed(ALICE, 'watch-3', 1_700_001_000);
    pruneViewStates(['watch-2']);

    expect(getViewState(ALICE, 'watch-3')).toBeNull();
    expect(getViewState(ALICE, 'watch-2')).not.toBeNull();
  });
});
