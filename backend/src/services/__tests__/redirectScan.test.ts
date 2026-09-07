import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RedirectProposal, WatchModel } from '../../types/index.js';

// JsonStore はモジュール読み込み時に config.dataDir を解決するため、
// import より先にテスト用の一時ディレクトリを指しておく
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dryeyes-redirect-scan-test-'));
process.env.DATA_DIR = tmpDir;

// 外へ出て行く処理は全部差し替える。ここで見たいのは「誰の・どの監視に答えが効くか」だけ。
vi.mock('../changedetection.js', () => ({
  changedetectionClient: {
    updateWatchUrl: vi.fn().mockResolvedValue(undefined),
    listWatches: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../redirect.js', () => ({ traceRedirects: vi.fn() }));
vi.mock('../browserRender.js', () => ({
  hasAnySelectorMatch: vi.fn().mockResolvedValue(true),
  RENDER_USER_AGENT: 'test-agent',
}));
vi.mock('../proxy.js', () => ({
  getPageInfo: vi.fn().mockResolvedValue({ title: '転送先のページ' }),
}));

const { changedetectionClient } = await import('../changedetection.js');
const { traceRedirects } = await import('../redirect.js');
const { assignOwner } = await import('../ownership.js');
const {
  getPendingRedirect,
  isAllowedRedirect,
  isDeniedRedirect,
  listPendingRedirects,
  setPendingRedirect,
} = await import('../redirectReview.js');
const { acceptPendingRedirect, dismissPendingRedirect, resetRedirectScanState, scanWatchForRedirect } =
  await import('../redirectScan.js');

const updateWatchUrl = vi.mocked(changedetectionClient.updateWatchUrl);
const trace = vi.mocked(traceRedirects);

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const proposal = (fromUrl: string, toUrl: string): RedirectProposal => ({
  fromUrl,
  toUrl,
  chain: [fromUrl, toUrl],
  status: 301,
  permanent: true,
  hostChanged: true,
  detectedAt: '2026-09-07T00:00:00.000Z',
  selectorFound: true,
  toTitle: null,
});

const watchOf = (id: string, url: string): WatchModel => ({
  id,
  url,
  title: id,
  fetchBackend: 'html_requests',
  checkIntervalMinutes: 60,
  paused: false,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: ['.list'],
  subtractedFilters: [],
  notificationTopic: 'dryeyes',
  snapshotCount: 1,
});

// サイト丸ごとの移転。user-a の監視が 3 件、user-b の監視が 1 件、別の移転が 1 件。
function seedSiteMove(): void {
  for (const entry of listPendingRedirects()) {
    // 前のテストの残りを消す
    dismissPendingRedirect('cleanup', entry.watchId, { always: false, onlyThis: true });
  }
  assignOwner('a-1', 'user-a');
  assignOwner('a-2', 'user-a');
  assignOwner('a-3', 'user-a');
  assignOwner('b-1', 'user-b');
  assignOwner('a-other', 'user-a');
  setPendingRedirect('a-1', proposal('https://old.example/manga/one', 'https://new.example/manga/one'));
  setPendingRedirect('a-2', proposal('https://old.example/manga/two', 'https://www.new.example/manga/two'));
  setPendingRedirect('a-3', proposal('https://old.example/manga/three', 'https://new.example/manga/three'));
  setPendingRedirect('b-1', proposal('https://old.example/manga/b', 'https://new.example/manga/b'));
  setPendingRedirect('a-other', proposal('https://another.example/x', 'https://new.example/x'));
}

beforeEach(() => {
  vi.clearAllMocks();
  updateWatchUrl.mockResolvedValue(undefined);
  resetRedirectScanState();
  seedSiteMove();
});

describe('acceptPendingRedirect', () => {
  it('applies the answer to every pending move of the same host pair owned by the user', async () => {
    const result = await acceptPendingRedirect('user-a', 'a-1', { always: false, onlyThis: false });

    expect(result.applied).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.proposal.toUrl).toBe('https://new.example/manga/one');

    // それぞれ自分の転送先へ（起点の URL を他の監視に書き込まない）
    expect(updateWatchUrl).toHaveBeenCalledWith('a-1', 'https://new.example/manga/one');
    expect(updateWatchUrl).toHaveBeenCalledWith('a-2', 'https://www.new.example/manga/two');
    expect(updateWatchUrl).toHaveBeenCalledWith('a-3', 'https://new.example/manga/three');
    expect(updateWatchUrl).toHaveBeenCalledTimes(3);

    // 他のユーザーの監視と、組の違う移転には手を付けない
    expect(getPendingRedirect('b-1')).not.toBeNull();
    expect(getPendingRedirect('a-other')).not.toBeNull();
    expect(getPendingRedirect('a-1')).toBeNull();
    expect(getPendingRedirect('a-2')).toBeNull();
    expect(getPendingRedirect('a-3')).toBeNull();
  });

  it('touches only the chosen watch when asked to', async () => {
    const result = await acceptPendingRedirect('user-a', 'a-1', { always: false, onlyThis: true });

    expect(result.applied).toBe(1);
    expect(updateWatchUrl).toHaveBeenCalledTimes(1);
    expect(getPendingRedirect('a-2')).not.toBeNull();
    expect(getPendingRedirect('a-3')).not.toBeNull();
  });

  it('remembers the move for the user in both directions when asked not to ask again', async () => {
    await acceptPendingRedirect('user-a', 'a-1', { always: true, onlyThis: false });

    expect(isAllowedRedirect('user-a', 'https://old.example/p', 'https://new.example/p')).toBe(true);
    // 往復するミラーが元へ戻ったときも聞かない
    expect(isAllowedRedirect('user-a', 'https://new.example/p', 'https://old.example/p')).toBe(true);
    // 別のユーザーの判断にはならない
    expect(isAllowedRedirect('user-b', 'https://old.example/p', 'https://new.example/p')).toBe(false);
  });

  it('keeps going when one of the other watches cannot be updated', async () => {
    updateWatchUrl.mockImplementation(async (id: string) => {
      if (id === 'a-2') throw new Error('changedetection.io が応答しません');
    });

    const result = await acceptPendingRedirect('user-a', 'a-1', { always: false, onlyThis: false });

    expect(result.applied).toBe(2);
    expect(result.failed).toBe(1);
    // 失敗した監視は確認待ちのまま残り、あとからやり直せる
    expect(getPendingRedirect('a-2')).not.toBeNull();
    expect(getPendingRedirect('a-3')).toBeNull();
  });

  it('fails outright when the chosen watch itself cannot be updated', async () => {
    updateWatchUrl.mockRejectedValueOnce(new Error('changedetection.io が応答しません'));

    await expect(
      acceptPendingRedirect('user-a', 'a-1', { always: false, onlyThis: false })
    ).rejects.toThrow('応答しません');
    // 起点で失敗したら他の監視にも手を付けない
    expect(updateWatchUrl).toHaveBeenCalledTimes(1);
    expect(getPendingRedirect('a-1')).not.toBeNull();
    expect(getPendingRedirect('a-2')).not.toBeNull();
  });

  it('rejects when there is nothing to accept', async () => {
    await expect(
      acceptPendingRedirect('user-a', 'nothing', { always: false, onlyThis: false })
    ).rejects.toThrow('確認待ちの移転はありません');
  });
});

describe('dismissPendingRedirect', () => {
  it('folds every pending move of the same host pair owned by the user', () => {
    const result = dismissPendingRedirect('user-a', 'a-1', { always: false, onlyThis: false });

    expect(result.applied).toBe(3);
    expect(updateWatchUrl).not.toHaveBeenCalled();
    expect(getPendingRedirect('a-1')).toBeNull();
    expect(getPendingRedirect('a-2')).toBeNull();
    expect(getPendingRedirect('a-3')).toBeNull();
    expect(getPendingRedirect('b-1')).not.toBeNull();
    expect(getPendingRedirect('a-other')).not.toBeNull();
    // 「今回は変更しない」だけなら、次に検知したときはまた聞く
    expect(isDeniedRedirect('user-a', 'https://old.example/p', 'https://new.example/p')).toBe(false);
  });

  it('remembers the rejection for the user when asked not to ask again', () => {
    dismissPendingRedirect('user-a', 'a-1', { always: true, onlyThis: false });

    expect(isDeniedRedirect('user-a', 'https://old.example/p', 'https://new.example/p')).toBe(true);
    expect(isDeniedRedirect('user-b', 'https://old.example/p', 'https://new.example/p')).toBe(false);
  });
});

describe('scanWatchForRedirect', () => {
  const traceTo = (fromUrl: string, toUrl: string) =>
    trace.mockResolvedValue({
      finalUrl: toUrl,
      chain: [fromUrl, toUrl],
      status: 301,
      permanent: true,
      hostChanged: true,
    });

  it('follows silently once the owner has approved the host pair', async () => {
    await acceptPendingRedirect('user-a', 'a-1', { always: true, onlyThis: true });
    assignOwner('a-new', 'user-a');
    traceTo('https://old.example/manga/new', 'https://new.example/manga/new');

    const result = await scanWatchForRedirect(watchOf('a-new', 'https://old.example/manga/new'));

    expect(result).toBe('followed');
    expect(updateWatchUrl).toHaveBeenCalledWith('a-new', 'https://new.example/manga/new');
    expect(getPendingRedirect('a-new')).toBeNull();
  });

  it('still asks another user about the same move', async () => {
    await acceptPendingRedirect('user-a', 'a-1', { always: true, onlyThis: true });
    assignOwner('b-new', 'user-b');
    traceTo('https://old.example/manga/b-new', 'https://new.example/manga/b-new');

    const result = await scanWatchForRedirect(watchOf('b-new', 'https://old.example/manga/b-new'));

    expect(result).toBe('proposed');
    expect(updateWatchUrl).not.toHaveBeenCalledWith('b-new', expect.anything());
    expect(getPendingRedirect('b-new')?.toUrl).toBe('https://new.example/manga/b-new');
  });

  it('stays quiet once the owner has rejected the host pair', async () => {
    dismissPendingRedirect('user-a', 'a-1', { always: true, onlyThis: true });
    assignOwner('a-quiet', 'user-a');
    traceTo('https://old.example/manga/quiet', 'https://new.example/manga/quiet');

    const result = await scanWatchForRedirect(watchOf('a-quiet', 'https://old.example/manga/quiet'));

    expect(result).toBeNull();
    expect(getPendingRedirect('a-quiet')).toBeNull();
  });
});
