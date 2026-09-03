// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WatchCard } from '../components/WatchCard';
import { WatchModel } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onReviewRedirect={vi.fn()}
        onChangeImage={vi.fn()}
        {...handlers}
      />
    );

  const openMenu = () => fireEvent.click(screen.getByLabelText('操作メニュー'));

  it('renders the title with the site favicon and keeps the card compact', () => {
    const { container } = renderCard();

    expect(screen.getByText('テスト商品監視')).toBeInTheDocument();
    // ファビコンは BFF 経由で取る（サイト直読みでは取れないサイトが多いため）
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      `/api/proxy/favicon?url=${encodeURIComponent('https://example.com/product')}`
    );
    // URL とチェック間隔はカードから省いている
    expect(screen.queryByText('https://example.com/product')).not.toBeInTheDocument();
    expect(screen.queryByText('10分毎')).not.toBeInTheDocument();
    expect(screen.queryByText('タップして変更点を見る')).not.toBeInTheDocument();
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

  it('shows how many updates happened since the last time it was viewed', () => {
    renderCard({ hasUnviewed: true, unviewedCount: 3, lastChanged: 1700000500 });

    expect(screen.getByText('3回更新')).toBeInTheDocument();
  });

  it('shows no update badge once everything has been viewed', () => {
    renderCard({ hasUnviewed: false, unviewedCount: 0, lastChanged: 1700000000 });

    expect(screen.queryByText(/回更新/)).not.toBeInTheDocument();
  });

  it('opens the diff when the card body is tapped', () => {
    const handleOpenDiff = vi.fn();
    renderCard({}, { onOpenDiff: handleOpenDiff });

    fireEvent.click(screen.getByText('テスト商品監視'));

    expect(handleOpenDiff).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-123' }));
  });

  it('does not open the diff when the option menu is used', () => {
    const handleOpenDiff = vi.fn();
    renderCard({}, { onOpenDiff: handleOpenDiff });

    openMenu();

    expect(screen.getByText('今すぐチェック')).toBeInTheDocument();
    expect(handleOpenDiff).not.toHaveBeenCalled();
  });

  it('triggers a check from the option menu', () => {
    const handleCheck = vi.fn().mockResolvedValue(undefined);
    renderCard({}, { onTriggerCheck: handleCheck });

    openMenu();
    fireEvent.click(screen.getByText('今すぐチェック'));

    expect(handleCheck).toHaveBeenCalledWith('test-123');
  });

  it('pauses and resumes from the option menu', () => {
    const handleTogglePause = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderCard({}, { onTogglePause: handleTogglePause });

    openMenu();
    fireEvent.click(screen.getByText('監視を停止'));
    expect(handleTogglePause).toHaveBeenCalledWith('test-123', true);

    rerender(
      <WatchCard
        watch={{ ...mockWatch, paused: true }}
        onTriggerCheck={vi.fn()}
        onTogglePause={handleTogglePause}
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onReviewRedirect={vi.fn()}
        onChangeImage={vi.fn()}
      />
    );

    openMenu();
    fireEvent.click(screen.getByText('監視を再開'));
    expect(handleTogglePause).toHaveBeenLastCalledWith('test-123', false);
  });

  it('opens the settings editor from the option menu', () => {
    const handleEdit = vi.fn();
    renderCard({}, { onEdit: handleEdit });

    openMenu();
    fireEvent.click(screen.getByText('設定を変更'));

    expect(handleEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-123' }));
  });

  it('opens the copy-to modal from the option menu', () => {
    const handleCopyTo = vi.fn();
    renderCard({}, { onCopyTo: handleCopyTo });

    openMenu();
    fireEvent.click(screen.getByText('別ユーザへコピー'));

    expect(handleCopyTo).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-123' }));
  });

  it('deletes from the option menu after confirmation', () => {
    const handleDelete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderCard({}, { onDelete: handleDelete });

    openMenu();
    fireEvent.click(screen.getByText('削除'));

    expect(handleDelete).toHaveBeenCalledWith('test-123');
  });

  it('falls back to a placeholder icon when the favicon cannot be loaded', () => {
    const { container } = renderCard();

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a banner for a detected move and opens the review instead of the diff', () => {
    const handleReview = vi.fn();
    const handleOpenDiff = vi.fn();
    renderCard(
      {
        pendingRedirect: {
          fromUrl: 'https://example.com/product',
          toUrl: 'https://example.other/product',
          chain: ['https://example.com/product', 'https://example.other/product'],
          status: 301,
          permanent: true,
          hostChanged: true,
          detectedAt: '2026-09-01T00:00:00.000Z',
          selectorFound: true,
          toTitle: null,
        },
      },
      { onReviewRedirect: handleReview, onOpenDiff: handleOpenDiff }
    );

    fireEvent.click(screen.getByText(/example.other へ転送されています/));

    expect(handleReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'test-123' }));
    // 帯はカードの中にあるので、素通しだと差分まで開いてしまう
    expect(handleOpenDiff).not.toHaveBeenCalled();
  });
});
