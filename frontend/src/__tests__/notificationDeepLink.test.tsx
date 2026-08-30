// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../App';
import { api, authToken } from '../api';
import { AuthUser, MeResponse, WatchDiff, WatchModel } from '../types';

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

const watch: WatchModel = {
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
  hasUnviewed: true,
};

const diff: WatchDiff = {
  watchId: 'watch-1',
  from: 1_700_000_000,
  to: 1_700_000_500,
  lines: [{ type: 'added', text: '第112話' }],
  added: 1,
  removed: 0,
  truncated: false,
  hasUnviewed: true,
  lastViewedAt: '2026-08-30T00:00:00.000Z',
  snapshotCount: 3,
};

// ntfy 通知をタップすると `…/?watch=<uuid>` で開かれる
const openedFromNotification = (watchId: string) =>
  window.history.replaceState({}, '', `/?watch=${watchId}`);

beforeEach(() => {
  vi.restoreAllMocks();
  authToken.set('test-token');
  window.history.replaceState({}, '', '/');

  vi.spyOn(api, 'getMe').mockResolvedValue(me);
  vi.spyOn(api, 'getHealth').mockRejectedValue(new Error('health は本テストでは使わない'));
  vi.spyOn(api, 'getWatches').mockResolvedValue([watch]);
});

afterEach(() => {
  cleanup();
  authToken.clear();
});

describe('ntfy 通知からの起動', () => {
  it('opens the diff of the watch the notification came from', async () => {
    const getDiff = vi.spyOn(api, 'getDiff').mockResolvedValue(diff);
    openedFromNotification('watch-1');

    render(<App />);

    await waitFor(() => expect(getDiff).toHaveBeenCalledWith('watch-1'));
    expect(await screen.findByText('変更点')).toBeInTheDocument();
    expect(await screen.findByText('第112話')).toBeInTheDocument();
  });

  it('drops the query so reloading does not reopen the diff', async () => {
    vi.spyOn(api, 'getDiff').mockResolvedValue(diff);
    openedFromNotification('watch-1');

    render(<App />);

    await waitFor(() => expect(screen.getByText('変更点')).toBeInTheDocument());
    expect(window.location.search).toBe('');
  });

  it('tells the user when the watch from the notification is gone', async () => {
    const getDiff = vi.spyOn(api, 'getDiff').mockResolvedValue(diff);
    openedFromNotification('deleted-watch');

    render(<App />);

    expect(await screen.findByText(/通知の監視対象が見つかりませんでした/)).toBeInTheDocument();
    expect(getDiff).not.toHaveBeenCalled();
  });

  it('does not open anything when the app is opened normally', async () => {
    const getDiff = vi.spyOn(api, 'getDiff').mockResolvedValue(diff);

    render(<App />);

    await waitFor(() => expect(screen.getByText('ぐらんぶる')).toBeInTheDocument());
    expect(getDiff).not.toHaveBeenCalled();
    expect(screen.queryByText('変更点')).not.toBeInTheDocument();
  });
});
