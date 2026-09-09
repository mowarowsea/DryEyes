import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WatchModel } from '../../types/index.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-autoscan-test-'));
process.env.DATA_DIR = tmpDir;

const { runFeedScan, resetFeedAutoScanState } = await import('../feedAutoScan.js');
const { setFeedConfig, addCandidates } = await import('../feedStore.js');
const { assignOwner } = await import('../ownership.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetFeedAutoScanState();
});

const watchOf = (id: string, paused = false): WatchModel => ({
  id,
  url: 'https://example.com/list',
  title: id,
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 180,
  paused,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: ['//div'],
  subtractedFilters: [],
  notificationTopic: 't',
  snapshotCount: 2,
});

const scanned = (added: number) =>
  vi.fn(async (watch: WatchModel) => ({ watchId: watch.id, status: 'scanned' as const, added }));

const sentOk = () =>
  vi.fn(async (ids: string[]) => ({ sent: ids.length, results: [], errors: [], ignored: [] }));

const seedCandidate = (watchId: string) =>
  addCandidates(watchId, [
    {
      text: `[著者] ${watchId} 第01巻`,
      urls: ['https://a.example/1'],
      meta: { title: watchId, author: '著者', volume: '1', rawText: `[著者] ${watchId} 第01巻` },
    },
  ]);

describe('runFeedScan', () => {
  it('should skip watches that are not enabled', async () => {
    const scan = scanned(0);
    const summary = await runFeedScan({
      listWatches: async () => [watchOf('a1')],
      scan,
      send: sentOk() as never,
    });
    expect(scan).not.toHaveBeenCalled();
    expect(summary.scanned).toBe(0);
  });

  it('should skip paused watches (no snapshot will be added anyway)', async () => {
    setFeedConfig('a2', { enabled: true });
    const scan = scanned(1);
    await runFeedScan({ listWatches: async () => [watchOf('a2', true)], scan, send: sentOk() as never });
    expect(scan).not.toHaveBeenCalled();
  });

  it('should collect candidates but not send them while autoSend is off', async () => {
    setFeedConfig('a3', { enabled: true, userId: 1 });
    assignOwner('a3', 'user-1');
    seedCandidate('a3');

    const send = sentOk();
    const summary = await runFeedScan({
      listWatches: async () => [watchOf('a3')],
      scan: scanned(1),
      send: send as never,
    });

    expect(summary.added).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('should send pending candidates once autoSend is on', async () => {
    setFeedConfig('a4', { enabled: true, autoSend: true, userId: 1 });
    assignOwner('a4', 'user-1');
    seedCandidate('a4');

    const send = sentOk();
    const summary = await runFeedScan({
      listWatches: async () => [watchOf('a4')],
      scan: scanned(1),
      send: send as never,
    });

    expect(send).toHaveBeenCalledTimes(1);
    // 投入先ユーザーは監視の所有者から決まる
    expect(send.mock.calls[0][1]).toBe('user-1');
    expect(summary.sent).toBe(1);
  });

  it('should not send when the watch has no owner', async () => {
    setFeedConfig('a5', { enabled: true, autoSend: true, userId: 1 });
    seedCandidate('a5');

    const send = sentOk();
    await runFeedScan({ listWatches: async () => [watchOf('a5')], scan: scanned(1), send: send as never });
    expect(send).not.toHaveBeenCalled();
  });

  it('should keep going when one watch throws', async () => {
    setFeedConfig('a6', { enabled: true });
    setFeedConfig('a7', { enabled: true });
    const scan = vi.fn(async (watch: WatchModel) => {
      if (watch.id === 'a6') throw new Error('ブラウザに接続できません');
      return { watchId: watch.id, status: 'scanned' as const, added: 2 };
    });

    const summary = await runFeedScan({
      listWatches: async () => [watchOf('a6'), watchOf('a7')],
      scan,
      send: sentOk() as never,
    });

    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].watchId).toBe('a6');
    expect(summary.added).toBe(2);
  });

  it('should not start a second pass while one is running', async () => {
    setFeedConfig('a8', { enabled: true });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scan = vi.fn(async (watch: WatchModel) => {
      await gate;
      return { watchId: watch.id, status: 'scanned' as const, added: 0 };
    });

    const first = runFeedScan({ listWatches: async () => [watchOf('a8')], scan, send: sentOk() as never });
    const second = await runFeedScan({
      listWatches: async () => [watchOf('a8')],
      scan,
      send: sentOk() as never,
    });

    expect(second.scanned).toBe(0);
    release();
    await first;
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
