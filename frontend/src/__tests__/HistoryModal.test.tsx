// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HistoryModal, describePace } from '../components/HistoryModal';
import { api } from '../api';
import { HistoryDiff, WatchModel } from '../types';

const watch: WatchModel = {
  id: 'watch-1',
  url: 'https://example.com/manga',
  title: 'ぐらんぶる',
  fetchBackend: 'html_requests',
  checkIntervalMinutes: 60,
  paused: false,
  lastChecked: 1_700_200_000,
  lastChanged: 1_700_200_000,
  hasError: false,
  lastError: null,
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: 'dryeyes-alice-abc123',
};

// 新しい順。初回取得のあと 2 回更新された体。
const history = [
  { timestamp: 1_700_200_000, snapshotId: 'c' },
  { timestamp: 1_700_100_000, snapshotId: 'b' },
  { timestamp: 1_700_000_000, snapshotId: 'a' },
];

const diffs: Record<number, HistoryDiff> = {
  1_700_200_000: {
    watchId: 'watch-1',
    from: 1_700_100_000,
    to: 1_700_200_000,
    lines: [{ type: 'added', text: '第112話' }, { type: 'context', text: '第111話' }],
    added: 1,
    removed: 0,
    truncated: false,
  },
  1_700_100_000: {
    watchId: 'watch-1',
    from: 1_700_000_000,
    to: 1_700_100_000,
    lines: [{ type: 'added', text: '第111話' }, { type: 'removed', text: '第001話' }],
    added: 1,
    removed: 1,
    truncated: false,
  },
  1_700_000_000: {
    watchId: 'watch-1',
    from: null,
    to: 1_700_000_000,
    lines: [],
    added: 0,
    removed: 0,
    truncated: false,
    snapshotPreview: ['第110話', '第109話'],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getHistory').mockResolvedValue(history);
  vi.spyOn(api, 'getHistoryDiff').mockImplementation(async (_id, ts) => diffs[ts]);
});

afterEach(() => {
  cleanup();
});

const renderModal = () => render(<HistoryModal watch={watch} isOpen onClose={vi.fn()} />);

// 履歴の各行（開閉できるボタン）。閉じるボタンなど、開閉と無関係なボタンは含めない。
const historyRows = () =>
  screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));

describe('HistoryModal', () => {
  it('lists every snapshot newest first and opens the latest change right away', async () => {
    renderModal();

    // 最新の回は開いた状態で、その回の差分が見える
    await waitFor(() => expect(screen.getByText('第112話')).toBeInTheDocument());
    expect(api.getHistoryDiff).toHaveBeenCalledTimes(1);
    expect(api.getHistoryDiff).toHaveBeenCalledWith('watch-1', 1_700_200_000);

    const rows = historyRows();
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('最新')).toBeInTheDocument();
    expect(within(rows[2]).getByText('初回取得')).toBeInTheDocument();
    // 最初の 1 件は登録時の取得なので、更新の回数には数えない
    expect(screen.getByLabelText('更新 2 回')).toBeInTheDocument();
  });

  it('loads the diff of a change only when that row is opened', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('第112話')).toBeInTheDocument());

    const rows = historyRows();
    fireEvent.click(rows[1]);

    await waitFor(() => expect(screen.getByText('第001話')).toBeInTheDocument());
    expect(api.getHistoryDiff).toHaveBeenCalledWith('watch-1', 1_700_100_000);
    // 開いた回には増減の数が付く
    expect(within(rows[1]).getByText('+1')).toBeInTheDocument();
    expect(within(rows[1]).getByText('-1')).toBeInTheDocument();
  });

  it('shows the first fetched content instead of a diff for the initial snapshot', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('第112話')).toBeInTheDocument());

    fireEvent.click(historyRows()[2]);

    await waitFor(() => expect(screen.getByText(/最初に取得した内容/)).toBeInTheDocument());
    expect(screen.getByText(/第110話/)).toBeInTheDocument();
  });

  it('shows the error when the history cannot be loaded', async () => {
    vi.spyOn(api, 'getHistory').mockRejectedValue(new Error('履歴の取得に失敗しました'));

    renderModal();

    await waitFor(() => expect(screen.getByText('履歴の取得に失敗しました')).toBeInTheDocument());
  });

  it('explains when nothing has been fetched yet', async () => {
    vi.spyOn(api, 'getHistory').mockResolvedValue([]);

    renderModal();

    await waitFor(() => expect(screen.getByText(/まだ一度も取得していません/)).toBeInTheDocument());
    expect(api.getHistoryDiff).not.toHaveBeenCalled();
  });
});

describe('describePace', () => {
  const DAY = 86400;

  it('needs at least three snapshots to say anything', () => {
    expect(describePace([0, DAY])).toBeNull();
  });

  it('averages the gaps and picks a unit people actually use', () => {
    expect(describePace([0, 7 * DAY, 14 * DAY])).toBe('およそ 7 日おき');
    expect(describePace([0, 3600 * 6, 3600 * 12])).toBe('およそ 6 時間おき');
    expect(describePace([0, 600, 1200])).toBe('およそ 10 分おき');
  });

  it('does not care about the order it receives the timestamps in', () => {
    expect(describePace([14 * DAY, 0, 7 * DAY])).toBe('およそ 7 日おき');
  });
});
