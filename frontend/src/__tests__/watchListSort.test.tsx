// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WatchList } from '../components/WatchList';
import { WatchModel } from '../types';

const makeWatch = (over: Partial<WatchModel> & { id: string }): WatchModel => ({
  url: `https://example.com/${over.id}`,
  title: over.id,
  fetchBackend: 'html_requests',
  checkIntervalMinutes: 10,
  paused: false,
  lastChecked: 1_700_000_000,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: 'dryeyes',
  ...over,
});

// 更新日時・未読数・タイトルがそれぞれ違う 3 件
const watches: WatchModel[] = [
  makeWatch({ id: 'あんず', lastChanged: 1_700_000_100, unviewedCount: 0, hasUnviewed: false }),
  makeWatch({ id: 'いちご', lastChanged: 1_700_000_300, unviewedCount: 5, hasUnviewed: true }),
  makeWatch({ id: 'うめ', lastChanged: 1_700_000_200, unviewedCount: 2, hasUnviewed: true }),
];

const renderList = (props: Partial<React.ComponentProps<typeof WatchList>> = {}) =>
  render(
    <WatchList
      watches={watches}
      loaded
      search=""
      onTriggerCheck={vi.fn()}
      onTogglePause={vi.fn()}
      onOpenDiff={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onCopyTo={vi.fn()}
      onOpenCreateModal={vi.fn()}
      {...props}
    />
  );

// カードの並び順（見出しのテキスト）
const titlesInOrder = () =>
  screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

const openSortMenu = () => fireEvent.click(screen.getByRole('button', { name: /並び替え/ }));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('一覧の並び替え', () => {
  it('defaults to the newest change first', () => {
    renderList();
    expect(titlesInOrder()).toEqual(['いちご', 'うめ', 'あんず']);
  });

  it('sorts by unviewed count, most first', () => {
    renderList();

    openSortMenu();
    fireEvent.click(screen.getByRole('button', { name: '未読の数' }));
    expect(titlesInOrder()).toEqual(['いちご', 'うめ', 'あんず']);
  });

  it('flips the order with the direction toggle', () => {
    renderList();

    openSortMenu();
    fireEvent.click(screen.getByRole('button', { name: '未読の数' }));
    openSortMenu();
    fireEvent.click(screen.getByRole('button', { name: '少ない順' }));

    expect(titlesInOrder()).toEqual(['あんず', 'うめ', 'いちご']);
  });

  it('starts a title sort from the head of the alphabet', () => {
    renderList();

    openSortMenu();
    fireEvent.click(screen.getByRole('button', { name: 'タイトル' }));
    expect(titlesInOrder()).toEqual(['あんず', 'いちご', 'うめ']);
  });

  it('keeps the chosen order after a reload', () => {
    renderList();
    openSortMenu();
    fireEvent.click(screen.getByRole('button', { name: 'タイトル' }));
    cleanup();

    renderList();
    expect(titlesInOrder()).toEqual(['あんず', 'いちご', 'うめ']);
  });

  it('combines the filter with the sort', () => {
    renderList();

    fireEvent.click(screen.getByRole('button', { name: '未読 (2)' }));
    openSortMenu();
    fireEvent.click(screen.getByRole('button', { name: 'タイトル' }));

    expect(titlesInOrder()).toEqual(['いちご', 'うめ']);
  });
});

describe('登録直後の強調', () => {
  it('highlights the new watch and brings it into view', () => {
    const scrollIntoView = vi.fn();
    // jsdom は scrollIntoView を持たないため、呼ばれたことだけ見る
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      writable: true,
      configurable: true,
    });

    const { rerender } = renderList();
    expect(scrollIntoView).not.toHaveBeenCalled();

    const added = makeWatch({ id: 'かき' });
    rerender(
      <WatchList
        watches={[...watches, added]}
        loaded
        search=""
        highlightedId="かき"
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onOpenCreateModal={vi.fn()}
      />
    );

    const card = screen.getByRole('button', { name: 'かき の変更点を見る' });
    expect(card).toHaveClass('animate-justAdded');
    expect(scrollIntoView).toHaveBeenCalled();

    // 他のカードまで光らせない
    const other = screen.getByRole('button', { name: 'いちご の変更点を見る' });
    expect(other).not.toHaveClass('animate-justAdded');
  });

  it('falls back to the all-items filter so the new watch is not hidden', () => {
    const { rerender } = renderList();

    // 「停止中」で絞り込むと、停止していない新規は本来出てこない
    fireEvent.click(screen.getByRole('button', { name: '停止中 (0)' }));
    expect(screen.getByText('該当する監視対象が見つかりません')).toBeInTheDocument();

    const added = makeWatch({ id: 'かき' });
    rerender(
      <WatchList
        watches={[...watches, added]}
        loaded
        search=""
        highlightedId="かき"
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onOpenCreateModal={vi.fn()}
      />
    );

    const list = screen.getByRole('button', { name: 'すべて (4)' });
    expect(list).toHaveAttribute('aria-pressed', 'true');
    expect(within(document.body).getByRole('button', { name: 'かき の変更点を見る' })).toBeInTheDocument();
  });
});
