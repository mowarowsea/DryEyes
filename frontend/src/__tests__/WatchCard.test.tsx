// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WatchCard } from '../components/WatchCard';
import { WatchModel } from '../types';

afterEach(() => {
  cleanup();
});

describe('WatchCard', () => {
  const mockWatch: WatchModel = {
    id: 'test-123',
    url: 'https://example.com/product',
    title: 'テスト商品監視',
    fetchBackend: 'html_requests',
    checkIntervalMinutes: 10,
    paused: false,
    lastChecked: 1700000000,
    lastChanged: null,
    hasError: false,
    lastError: null,
    includeFilters: [],
    subtractedFilters: [],
    notificationTopic: 'dryeyes',
  };

  // 必須ハンドラーを埋めるヘルパー（テストごとに必要なものだけ差し替える）
  const renderCard = (
    watch: Partial<WatchModel> = {},
    handlers: Partial<React.ComponentProps<typeof WatchCard>> = {}
  ) =>
    render(
      <WatchCard
        watch={{ ...mockWatch, ...watch }}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onViewHistory={vi.fn()}
        onOpenDiff={vi.fn()}
        onDelete={vi.fn()}
        {...handlers}
      />
    );

  it('renders title, url, interval, and normal status badge', () => {
    renderCard();

    expect(screen.getByText('テスト商品監視')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/product')).toBeInTheDocument();
    expect(screen.getByText('10分毎')).toBeInTheDocument();
    expect(screen.getByText('正常')).toBeInTheDocument();
  });

  it('renders paused status badge when paused is true', () => {
    renderCard({ paused: true });

    expect(screen.getByText('停止中')).toBeInTheDocument();
  });

  it('renders error message when hasError is true', () => {
    renderCard({ hasError: true, lastError: '404 Not Found' });

    expect(screen.getByText('エラー')).toBeInTheDocument();
    expect(screen.getByText('404 Not Found')).toBeInTheDocument();
  });

  it('calls onTriggerCheck when play button is clicked', () => {
    const handleCheck = vi.fn().mockResolvedValue(undefined);
    renderCard({}, { onTriggerCheck: handleCheck });

    fireEvent.click(screen.getByTitle('今すぐチェック'));

    expect(handleCheck).toHaveBeenCalledWith('test-123');
  });

  it('opens the diff when the card body is tapped', () => {
    const handleOpenDiff = vi.fn();
    renderCard({}, { onOpenDiff: handleOpenDiff });

    fireEvent.click(screen.getByText('テスト商品監視'));

    expect(handleOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-123' }));
  });

  it('does not open the diff when an action button is tapped', () => {
    const handleOpenDiff = vi.fn();
    renderCard({}, { onOpenDiff: handleOpenDiff, onTriggerCheck: vi.fn().mockResolvedValue(undefined) });

    // 操作ボタンやリンクのタップでカードのタップ扱いにならないこと
    fireEvent.click(screen.getByTitle('今すぐチェック'));
    fireEvent.click(screen.getByText('https://example.com/product'));

    expect(handleOpenDiff).not.toHaveBeenCalled();
  });

  it('shows the unread badge when the BFF reports unviewed changes', () => {
    renderCard({ hasUnviewed: true, lastChanged: 1700000500 });

    expect(screen.getByText('未読の変更')).toBeInTheDocument();
  });

  it('shows the normal badge once the change has been viewed', () => {
    renderCard({ hasUnviewed: false, lastChanged: 1700000000, lastChecked: 1700000000 });

    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(screen.queryByText('未読の変更')).not.toBeInTheDocument();
  });
});
