// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../App';
import { WatchList } from '../components/WatchList';
import { api, authToken } from '../api';
import { AuthUser, MeResponse, WatchModel } from '../types';

const user: AuthUser = {
  id: 'user-1',
  username: 'mowz',
  ntfyTopic: 'dryeyes-mowz-94cf11',
  createdAt: '2026-08-30T11:00:02.945Z',
};

const me: MeResponse = {
  user,
  ntfy: {
    baseUrl: 'http://localhost:8085',
    topic: user.ntfyTopic,
    subscribeUrl: `http://localhost:8085/${user.ntfyTopic}`,
  },
};

const makeWatch = (over: Partial<WatchModel> = {}): WatchModel => ({
  id: 'watch-1',
  url: 'https://example.com/manga',
  title: 'ぐらんぶる',
  fetchBackend: 'html_requests',
  checkIntervalMinutes: 60,
  paused: false,
  lastChecked: 1_700_000_500,
  lastChanged: 1_700_000_500,
  hasError: false,
  lastError: null,
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: user.ntfyTopic,
  ...over,
});

beforeEach(() => {
  vi.restoreAllMocks();
  authToken.set('test-token');
  window.history.replaceState({}, '', '/');

  vi.spyOn(api, 'getMe').mockResolvedValue(me);
  vi.spyOn(api, 'getHealth').mockRejectedValue(new Error('health は本テストでは使わない'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  authToken.clear();
});

describe('30 秒ごとの自動更新', () => {
  it('keeps the list on screen when a background refresh fails', async () => {
    // shouldAdvanceTime: 実時間でも進むタイマー。これが無いと findBy* の待ちが止まってしまう。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const getWatches = vi.spyOn(api, 'getWatches').mockResolvedValue([makeWatch()]);

    render(<App />);
    expect(await screen.findByText('ぐらんぶる')).toBeInTheDocument();

    // 裏の取得だけがこけるケース（BFF の一時的なエラー、ネットワークの瞬断）。
    // ここで一覧を空に落とすと「まだ監視対象がありません」が一瞬出てしまう。
    getWatches.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText('ぐらんぶる')).toBeInTheDocument();
    expect(screen.queryByText('まだ監視対象がありません')).not.toBeInTheDocument();
  });
});

describe('読み込み中の表示', () => {
  it('does not claim the list is empty before the first fetch lands', async () => {
    // 画面が読み込み直された直後の状態。取得が返るまでは何件あるか分からない。
    let release: (watches: WatchModel[]) => void = () => undefined;
    vi.spyOn(api, 'getWatches').mockReturnValue(
      new Promise<WatchModel[]>((resolve) => {
        release = resolve;
      })
    );

    render(<App />);

    // ログイン復元が済んで一覧の枠が出た時点でも、まだ空だと言い切ってはいけない
    expect(await screen.findByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.queryByText('まだ監視対象がありません')).not.toBeInTheDocument();

    await act(async () => {
      release([makeWatch()]);
    });
    expect(await screen.findByText('ぐらんぶる')).toBeInTheDocument();
  });
});

describe('一覧の並び', () => {
  const noop = async () => undefined;

  const renderList = (watches: WatchModel[]) =>
    render(
      <WatchList
        watches={watches}
        loaded
        search=""
        onTriggerCheck={noop}
        onTogglePause={noop}
        onOpenDiff={() => undefined}
        onEdit={() => undefined}
        onDelete={noop}
        onCopyTo={() => undefined}
        onOpenCreateModal={() => undefined}
      />
    );

  it('does not reorder cards when only the last check time moves', () => {
    // まだ一度も変更が検知されていない 2 件。この状態では lastChecked しか差が無い。
    const first = makeWatch({ id: 'a', title: 'ぐらんぶる', lastChanged: null, lastChecked: 1_700_000_000 });
    const second = makeWatch({ id: 'b', title: 'よふかしのうた', lastChanged: null, lastChecked: 1_700_000_100 });

    const { container, rerender } = renderList([first, second]);
    const orderOf = () => {
      const text = container.textContent || '';
      return text.indexOf('ぐらんぶる') < text.indexOf('よふかしのうた') ? 'a-first' : 'b-first';
    };
    const before = orderOf();

    // 裏のチェックが走って lastChecked だけが進んだ状態。
    // これで順番が入れ替わると、見ている最中に一覧が動いてしまう。
    rerender(
      <WatchList
        watches={[{ ...first, lastChecked: 1_700_100_000 }, second]}
        loaded
        search=""
        onTriggerCheck={noop}
        onTogglePause={noop}
        onOpenDiff={() => undefined}
        onEdit={() => undefined}
        onDelete={noop}
        onCopyTo={() => undefined}
        onOpenCreateModal={() => undefined}
      />
    );
    expect(orderOf()).toBe(before);
  });
});
