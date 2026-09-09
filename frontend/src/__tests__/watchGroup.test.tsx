// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WatchList } from '../components/WatchList';
import { WatchModel } from '../types';
import { groupByWork, isDownloadWatch, modeOf, workKeyOf } from '../watchGroup';

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

/** ダウンロード投入に繋がった監視 */
const linked = (id: string, title: string | null, author: string | null = null) =>
  makeWatch({ id, feed: { userId: 1, title, author } });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('workKeyOf', () => {
  it('should absorb the differences that do not change the work', () => {
    // PowerDowner の seriesKey と同じ考え方。ここがずれると、画面上のまとまりと
    // 向こうの重複判定の単位が食い違う
    expect(workKeyOf('異世界町工場無双')).toBe(workKeyOf('【異世界町工場無双】'));
    expect(workKeyOf('Isekai Machikoba')).toBe(workKeyOf('isekai　machikoba'));
    expect(workKeyOf('作品名 (完全版)')).toBe(workKeyOf('作品名完全版'));
  });

  it('should keep different works apart', () => {
    expect(workKeyOf('作品名')).not.toBe(workKeyOf('作品名2'));
  });
});

describe('isDownloadWatch', () => {
  it('should treat a watch with a PowerDowner user as a download watch', () => {
    expect(isDownloadWatch(linked('a', '作品名'))).toBe(true);
    expect(modeOf(linked('a', '作品名'))).toBe('download');
  });

  it('should leave a watch without a destination in the web list', () => {
    expect(isDownloadWatch(makeWatch({ id: 'b' }))).toBe(false);
    // タイトルだけ入れて投入先を選んでいない途中の状態も Web 監視のまま
    expect(isDownloadWatch(makeWatch({ id: 'c', feed: { userId: null, title: '作品名', author: null } }))).toBe(false);
  });
});

describe('groupByWork', () => {
  it('should put the same work from different sites into one group', () => {
    const groups = groupByWork([
      linked('siteA', '異世界町工場無双', '著者'),
      linked('siteB', '【異世界町工場無双】'),
      linked('other', '別の作品'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].watches.map((w) => w.id)).toEqual(['siteA', 'siteB']);
    expect(groups[0].author).toBe('著者');
    expect(groups[1].watches.map((w) => w.id)).toEqual(['other']);
  });

  it('should fill in the author from a later member', () => {
    // 先に並んだサイトの設定に作者が入っていないことがある
    const [group] = groupByWork([linked('siteA', '作品名'), linked('siteB', '作品名', '著者')]);
    expect(group.author).toBe('著者');
  });

  it('should not merge watches that have no work title', () => {
    // 空どうしを一致とみなすと、設定途中のものが 1 枚に吸い込まれる
    const groups = groupByWork([linked('a', null), linked('b', null)]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.title)).toEqual(['a', 'b']);
  });

  it('should keep the given order (the group sits where its first member was)', () => {
    const groups = groupByWork([
      linked('1', '作品B'),
      linked('2', '作品A'),
      linked('3', '作品B'),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['作品B', '作品A']);
  });
});

const renderList = (watches: WatchModel[]) =>
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
      onReviewRedirect={vi.fn()}
      onChangeImage={vi.fn()}
      onOpenHistory={vi.fn()}
      onOpenFeed={vi.fn()}
      onOpenCreateModal={vi.fn()}
    />
  );

const goToDownloadList = () =>
  fireEvent.click(screen.getByRole('button', { name: /ダウンロード監視/ }));

describe('WatchList: Web 監視 / ダウンロード監視', () => {
  const watches = [
    makeWatch({ id: 'ただの監視' }),
    linked('siteA', '異世界町工場無双', '著者'),
    linked('siteB', '異世界町工場無双'),
  ];

  it('should keep download watches out of the web list', () => {
    renderList(watches);
    expect(screen.getByText('ただの監視')).toBeInTheDocument();
    expect(screen.queryByText('siteA')).not.toBeInTheDocument();
  });

  it('should count each list separately in the tabs', () => {
    renderList(watches);
    expect(screen.getByRole('button', { name: /Web 監視/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /ダウンロード監視/ })).toHaveTextContent('2');
  });

  it('should show the two sites of one work under a single heading', () => {
    renderList(watches);
    goToDownloadList();

    // 作品の見出しと、その下に 2 枚のカード
    expect(screen.getByText('異世界町工場無双')).toBeInTheDocument();
    expect(screen.getByText('2 サイト')).toBeInTheDocument();
    expect(screen.getByText('siteA')).toBeInTheDocument();
    expect(screen.getByText('siteB')).toBeInTheDocument();
  });

  it('should not wrap a work that has only one site', () => {
    renderList([makeWatch({ id: 'ただの監視' }), linked('single', 'ひとりぼっちの作品')]);
    goToDownloadList();

    expect(screen.getByText('single')).toBeInTheDocument();
    // まとめ枠の見出し (「n サイト」) は出さない
    expect(screen.queryByText(/サイト$/)).not.toBeInTheDocument();
  });

  it('should remember which list was open', () => {
    const first = renderList(watches);
    goToDownloadList();
    first.unmount();

    renderList(watches);
    expect(screen.getByText('siteA')).toBeInTheDocument();
    expect(screen.queryByText('ただの監視')).not.toBeInTheDocument();
  });

  it('should explain how to get here when the download list is empty', () => {
    renderList([makeWatch({ id: 'ただの監視' })]);
    goToDownloadList();
    expect(screen.getByText('まだダウンロード監視がありません')).toBeInTheDocument();
    // 作るのは Web 監視から。ここに「最初のページを登録する」は出さない
    expect(screen.queryByRole('button', { name: '最初のページを登録する' })).not.toBeInTheDocument();
  });
});
