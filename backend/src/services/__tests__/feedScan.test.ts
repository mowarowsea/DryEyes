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
  it('should run even for a watch with no PowerDowner settings yet', async () => {
    // 投入先を決める前に「何が取れるのか」を見たい。画面のボタンから呼ばれたときは、
    // 押した時点で意図がはっきりしているので実行する
    const result = await scanWatchForFeed(
      watchOf('s1'),
      { source: sourceOf({ 100: 'a' }), extract: extractOf([]) },
      { mode: 'all' }
    );
    expect(result.status).toBe('collected');
  });

  it('should skip a watch that has no selector', async () => {
    const result = await scanWatchForFeed(watchOf('s2', []), { source: sourceOf({ 100: 'a' }), extract: extractOf([]) });
    expect(result.status).toBe('no-selector');
  });

  it('should only place the pointer on the first scan', async () => {
    // 登録した時点でページに並んでいるものは「新着」ではない。
    // ここで候補にすると、既に持っている巻がまとめて出てくる
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
    const source = sourceOf({ 100: 'a' });
    await scanWatchForFeed(watchOf('s5'), { source, extract: extractOf([]) });
    const again = await scanWatchForFeed(watchOf('s5'), { source, extract: extractOf([]) });
    expect(again.status).toBe('unchanged');
  });

  it('should not open the page when the diff has no added lines', async () => {
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
    await scanWatchForFeed(watchOf('s7'), { source: sourceOf({ 100: '古い行' }), extract: extractOf([]) });

    const result = await scanWatchForFeed(watchOf('s7'), {
      source: sourceOf({ 100: '古い行', 200: '古い行\n[著者] 作品名 第03巻' }),
      extract: extractOf([{ text: '[著者] 作品名 第03巻', urls: [] }]),
    });
    expect(result.added).toBe(0);
    expect(result.addedLines).toBe(1);
  });

  it('should take author and title from the watch, since rows rarely carry them', async () => {
    // 行に載っているのは巻数だけ、というサイトが多い。
    // 監視 1 件 = 1 作品なので、作者とタイトルは監視の設定を使う
    setFeedConfig('s13', { author: '著者', title: '異世界町工場無双' });
    await scanWatchForFeed(
      watchOf('s13'),
      {
        source: sourceOf({ 100: 'x' }),
        extract: extractOf([
          { text: 'Isekai machikoba muso Shinrai v01-02s.rar katfile', urls: ['https://a.example/1'] },
        ]),
      },
      { mode: 'all' }
    );

    const [candidate] = listCandidates({ watchId: 's13' });
    expect(candidate.meta.author).toBe('著者');
    expect(candidate.meta.title).toBe('異世界町工場無双');
    // 巻数は PowerDowner が元の文字列から読むので、ここでは空のままでよい
    expect(candidate.meta.volume).toBeNull();
    expect(candidate.meta.rawText).toContain('v01-02s.rar');
  });

  it('should let the watch settings win over the pattern', async () => {
    setFeedConfig('s14', {
      title: '決めた作品名',
      itemPattern: String.raw`(?<title>[A-Za-z ]+) v`,
    });
    await scanWatchForFeed(
      watchOf('s14'),
      {
        source: sourceOf({ 100: 'x' }),
        extract: extractOf([{ text: 'Isekai machikoba v01.rar', urls: ['https://a.example/1'] }]),
      },
      { mode: 'all' }
    );

    expect(listCandidates({ watchId: 's14' })[0].meta.title).toBe('決めた作品名');
  });

  it('should collect the whole page when asked, without looking at the diff', async () => {
    // 登録直後の洗い出し。増分を待たずに「何があるか」を一度で出したい
    const extract = extractOf([
      { text: '[著者] 作品名 第01巻', urls: ['https://a.example/1'] },
      { text: '[著者] 作品名 第02巻', urls: ['https://a.example/2'] },
    ]);
    const result = await scanWatchForFeed(
      watchOf('s9'),
      { source: sourceOf({ 100: '[著者] 作品名 第01巻' }), extract },
      { mode: 'all' }
    );

    expect(result.status).toBe('collected');
    expect(result.added).toBe(2);
    expect(listCandidates({ watchId: 's9' })).toHaveLength(2);
    // 次からは増分だけを見られるよう、ポインタも進める
    expect(getPointer('s9')?.snapshotTimestamp).toBe(100);
  });

  it('should not duplicate candidates already collected', async () => {
    const items = [{ text: '[著者] 作品名 第01巻', urls: ['https://a.example/1'] }];
    const deps = { source: sourceOf({ 100: 'x' }), extract: extractOf(items) };

    await scanWatchForFeed(watchOf('s10'), deps, { mode: 'all' });
    const again = await scanWatchForFeed(watchOf('s10'), deps, { mode: 'all' });

    expect(again.added).toBe(0);
    expect(listCandidates({ watchId: 's10' })).toHaveLength(1);
  });

  it('should report what was extracted so a zero-candidate result can be diagnosed', async () => {
    // 「取れた要素 8 / 候補 0」のとき、セレクタが外れているのか
    // リンクが取れていないのかを画面で切り分けられるようにする
    const result = await scanWatchForFeed(
      watchOf('s12'),
      {
        source: sourceOf({ 100: 'x' }),
        extract: extractOf([
          { text: '[著者] 作品名 第01巻', urls: [] },
          { text: '[著者] 作品名 第02巻', urls: [] },
        ]),
      },
      { mode: 'all' }
    );

    expect(result.added).toBe(0);
    expect(result.samples).toEqual([
      { text: '[著者] 作品名 第01巻', urls: 0 },
      { text: '[著者] 作品名 第02巻', urls: 0 },
    ]);
  });

  it('should skip elements without links even in collect mode', async () => {
    const result = await scanWatchForFeed(
      watchOf('s11'),
      {
        source: sourceOf({ 100: 'x' }),
        extract: extractOf([
          { text: '[著者] 作品名 第01巻', urls: [] },
          { text: '[著者] 作品名 第02巻', urls: ['https://a.example/2'] },
        ]),
      },
      { mode: 'all' }
    );
    expect(result.added).toBe(1);
    expect(result.extracted).toBe(2);
  });

  it('should keep rawText when no pattern is configured', async () => {
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
