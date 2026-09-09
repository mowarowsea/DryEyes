import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WatchModel } from '../../types/index.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-feedscan-test-'));
process.env.DATA_DIR = tmpDir;

const { scanWatchForFeed } = await import('../feedScan.js');
const { setFeedConfig, listCandidates, getPointer } = await import('../feedStore.js');

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const watchOf = (id: string, includeFilters = ['//div[@class="row"]']): WatchModel => ({
  id,
  url: 'https://example.com/list',
  title: 'テスト監視',
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 180,
  paused: false,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters,
  subtractedFilters: [],
  notificationTopic: 't',
  snapshotCount: 2,
});

/** 履歴は新しい順。snapshots は timestamp -> 本文 */
const sourceOf = (snapshots: Record<number, string>) => ({
  getHistory: async () =>
    Object.keys(snapshots)
      .map(Number)
      .sort((a, b) => b - a)
      .map((timestamp) => ({ timestamp, snapshotId: String(timestamp) })),
  getSnapshot: async (_id: string, timestamp: number | 'latest') => snapshots[Number(timestamp)] ?? '',
});

const extractOf = (items: { text: string; urls: string[] }[]) => vi.fn(async () => items);

describe('scanWatchForFeed', () => {
  it('should do nothing while the watch is not enabled', async () => {
    const extract = extractOf([]);
    const result = await scanWatchForFeed(watchOf('s1'), { source: sourceOf({ 100: 'a' }), extract });
    expect(result.status).toBe('disabled');
    expect(extract).not.toHaveBeenCalled();
  });

  it('should skip a watch that has no selector', async () => {
    setFeedConfig('s2', { enabled: true });
    const result = await scanWatchForFeed(watchOf('s2', []), { source: sourceOf({ 100: 'a' }), extract: extractOf([]) });
    expect(result.status).toBe('no-selector');
  });

  it('should only place the pointer on the first scan', async () => {
    // 登録した時点でページに並んでいるものは「新着」ではない。
    // ここで候補にすると、既に持っている巻がまとめて出てくる
    setFeedConfig('s3', { enabled: true });
    const extract = extractOf([{ text: '[著者] 作品名 第01巻', urls: ['https://a.example/1'] }]);
    const result = await scanWatchForFeed(watchOf('s3'), {
      source: sourceOf({ 100: '[著者] 作品名 第01巻' }),
      extract,
    });
    expect(result.status).toBe('initialized');
    expect(listCandidates({ watchId: 's3' })).toHaveLength(0);
    expect(getPointer('s3')?.snapshotTimestamp).toBe(100);
    expect(extract).not.toHaveBeenCalled();
  });

  it('should turn an increment into candidates', async () => {
    setFeedConfig('s4', {
      enabled: true,
      itemPattern: String.raw`^\[(?<author>[^\]]+)\]\s*(?<title>.+?)\s*第(?<volume>\d+)巻`,
    });
    const source = sourceOf({
      100: '[著者] 作品名 第01巻',
      200: '[著者] 作品名 第02巻\n[著者] 作品名 第01巻',
    });
    const watch = watchOf('s4');

    await scanWatchForFeed(watch, { source: sourceOf({ 100: '[著者] 作品名 第01巻' }), extract: extractOf([]) });

    const result = await scanWatchForFeed(watch, {
      source,
      extract: extractOf([
        { text: '[著者] 作品名 第02巻', urls: ['https://a.example/2', 'https://b.example/2'] },
        { text: '[著者] 作品名 第01巻', urls: ['https://a.example/1'] },
      ]),
    });

    expect(result.status).toBe('scanned');
    expect(result.added).toBe(1);
    const [candidate] = listCandidates({ watchId: 's4' });
    // 増分に対応する行だけが候補になる (第01巻は既にあったので出てこない)
    expect(candidate.meta.volume).toBe('02');
    expect(candidate.meta.author).toBe('著者');
    expect(candidate.meta.title).toBe('作品名');
    expect(candidate.urls).toEqual(['https://a.example/2', 'https://b.example/2']);
    expect(getPointer('s4')?.snapshotTimestamp).toBe(200);
  });

  it('should report unchanged when the pointer is already at the latest snapshot', async () => {
    setFeedConfig('s5', { enabled: true });
    const source = sourceOf({ 100: 'a' });
    await scanWatchForFeed(watchOf('s5'), { source, extract: extractOf([]) });
    const again = await scanWatchForFeed(watchOf('s5'), { source, extract: extractOf([]) });
    expect(again.status).toBe('unchanged');
  });

  it('should not open the page when the diff has no added lines', async () => {
    setFeedConfig('s6', { enabled: true });
    await scanWatchForFeed(watchOf('s6'), { source: sourceOf({ 100: 'a\nb' }), extract: extractOf([]) });

    const extract = extractOf([]);
    const result = await scanWatchForFeed(watchOf('s6'), {
      source: sourceOf({ 100: 'a\nb', 200: 'a' }), // 減っただけ
      extract,
    });
    expect(result.added).toBe(0);
    expect(extract).not.toHaveBeenCalled();
  });

  it('should ignore extracted elements that carry no link', async () => {
    setFeedConfig('s7', { enabled: true });
    await scanWatchForFeed(watchOf('s7'), { source: sourceOf({ 100: '古い行' }), extract: extractOf([]) });

    const result = await scanWatchForFeed(watchOf('s7'), {
      source: sourceOf({ 100: '古い行', 200: '古い行\n[著者] 作品名 第03巻' }),
      extract: extractOf([{ text: '[著者] 作品名 第03巻', urls: [] }]),
    });
    expect(result.added).toBe(0);
    expect(result.addedLines).toBe(1);
  });

  it('should keep rawText when no pattern is configured', async () => {
    setFeedConfig('s8', { enabled: true });
    await scanWatchForFeed(watchOf('s8'), { source: sourceOf({ 100: '古い行' }), extract: extractOf([]) });

    await scanWatchForFeed(watchOf('s8'), {
      source: sourceOf({ 100: '古い行', 200: '古い行\n[著者] 作品名 第04巻' }),
      extract: extractOf([{ text: '[著者] 作品名 第04巻', urls: ['https://a.example/4'] }]),
    });
    const [candidate] = listCandidates({ watchId: 's8' });
    expect(candidate.meta.title).toBeNull();
    expect(candidate.meta.rawText).toBe('[著者] 作品名 第04巻');
  });
});
