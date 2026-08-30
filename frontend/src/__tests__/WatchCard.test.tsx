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

  it('renders title, url, interval, and normal status badge', () => {
    render(
      <WatchCard
        watch={mockWatch}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onViewHistory={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('テスト商品監視')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/product')).toBeInTheDocument();
    expect(screen.getByText('10分毎')).toBeInTheDocument();
    expect(screen.getByText('正常')).toBeInTheDocument();
  });

  it('renders paused status badge when paused is true', () => {
    render(
      <WatchCard
        watch={{ ...mockWatch, paused: true }}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onViewHistory={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('停止中')).toBeInTheDocument();
  });

  it('renders error message when hasError is true', () => {
    render(
      <WatchCard
        watch={{ ...mockWatch, hasError: true, lastError: '404 Not Found' }}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onViewHistory={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('エラー')).toBeInTheDocument();
    expect(screen.getByText('404 Not Found')).toBeInTheDocument();
  });

  it('calls onTriggerCheck when play button is clicked', () => {
    const handleCheck = vi.fn().mockResolvedValue(undefined);
    render(
      <WatchCard
        watch={mockWatch}
        onTriggerCheck={handleCheck}
        onTogglePause={vi.fn()}
        onViewHistory={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const checkBtn = screen.getByTitle('今すぐチェック');
    fireEvent.click(checkBtn);

    expect(handleCheck).toHaveBeenCalledWith('test-123');
  });
});
