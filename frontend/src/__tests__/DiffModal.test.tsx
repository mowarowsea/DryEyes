// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DiffModal } from '../components/DiffModal';
import { api } from '../api';
import { WatchModel, WatchDiff } from '../types';

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
  notificationTopic: 'dryeyes-alice-abc123',
  hasUnviewed: true,
};

const diff: WatchDiff = {
  watchId: 'watch-1',
  from: 1_700_000_000,
  to: 1_700_000_500,
  lines: [
    { type: 'added', text: '第112話' },
    { type: 'context', text: '第111話' },
    { type: 'gap', text: '', count: 36 },
    { type: 'removed', text: '第001話' },
  ],
  added: 1,
  removed: 1,
  truncated: false,
  hasUnviewed: true,
  lastViewedAt: '2026-08-30T00:00:00.000Z',
  snapshotCount: 3,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('DiffModal', () => {
  it('shows what changed since the user last viewed the watch', async () => {
    vi.spyOn(api, 'getDiff').mockResolvedValue(diff);

    render(<DiffModal watch={watch} isOpen onClose={vi.fn()} onViewed={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('第112話')).toBeInTheDocument());

    expect(api.getDiff).toHaveBeenCalledWith('watch-1');
    expect(screen.getByText('ぐらんぶる')).toBeInTheDocument();
    expect(screen.getByText('第001話')).toBeInTheDocument();
    // 離れた変更なし行はまとめて表示される
    expect(screen.getByText(/変更なし 36 行/)).toBeInTheDocument();
  });

  it('links to the watched site so the user can move on after reading the diff', async () => {
    vi.spyOn(api, 'getDiff').mockResolvedValue(diff);
    const markViewed = vi.spyOn(api, 'markViewed').mockResolvedValue(undefined);
    const onViewed = vi.fn();

    render(<DiffModal watch={watch} isOpen onClose={vi.fn()} onViewed={onViewed} />);
    await waitFor(() => expect(screen.getByText('第112話')).toBeInTheDocument());

    const link = screen.getByRole('link', { name: /サイトを開く/ });
    expect(link).toHaveAttribute('href', 'https://example.com/manga');
    expect(link).toHaveAttribute('target', '_blank');

    // サイトへ移動すると同時に既読になる
    fireEvent.click(link);
    await waitFor(() => expect(markViewed).toHaveBeenCalledWith('watch-1'));
    await waitFor(() => expect(onViewed).toHaveBeenCalled());
  });

  it('marks the watch as read and closes when the user acknowledges the diff', async () => {
    vi.spyOn(api, 'getDiff').mockResolvedValue(diff);
    const markViewed = vi.spyOn(api, 'markViewed').mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<DiffModal watch={watch} isOpen onClose={onClose} onViewed={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('第112話')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /既読にする/ }));

    await waitFor(() => expect(markViewed).toHaveBeenCalledWith('watch-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('explains when there is only an initial snapshot to compare against', async () => {
    vi.spyOn(api, 'getDiff').mockResolvedValue({
      ...diff,
      from: null,
      lines: [],
      added: 0,
      removed: 0,
      hasUnviewed: false,
      snapshotCount: 1,
      currentPreview: ['第111話', '第110話'],
    });

    render(<DiffModal watch={watch} isOpen onClose={vi.fn()} onViewed={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/比較できる変更はありません/)).toBeInTheDocument()
    );
    expect(screen.getByText(/第111話/)).toBeInTheDocument();
  });

  it('shows only the current value once the change has already been viewed', async () => {
    vi.spyOn(api, 'getDiff').mockResolvedValue({
      ...diff,
      from: null,
      lines: [],
      added: 0,
      removed: 0,
      hasUnviewed: false,
      snapshotCount: 3,
      currentPreview: ['第112話', '第111話'],
    });

    render(<DiffModal watch={watch} isOpen onClose={vi.fn()} onViewed={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/すでに確認済み/)).toBeInTheDocument());
    // 見終わった差分は蒸し返さず、いま保持している内容だけを見せる
    expect(screen.getByText(/第112話/)).toBeInTheDocument();
    expect(screen.queryByText(/変更なし/)).not.toBeInTheDocument();
  });

  it('shows the error message when the diff cannot be loaded', async () => {
    vi.spyOn(api, 'getDiff').mockRejectedValue(new Error('差分の取得に失敗しました'));

    render(<DiffModal watch={watch} isOpen onClose={vi.fn()} onViewed={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText('差分の取得に失敗しました')).toBeInTheDocument()
    );
  });
});
