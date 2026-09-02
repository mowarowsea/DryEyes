// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RedirectReviewModal } from '../components/RedirectReviewModal';
import { RedirectProposal, WatchModel } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseProposal: RedirectProposal = {
  fromUrl: 'https://example.com/list',
  toUrl: 'https://example.other/list',
  chain: ['https://example.com/list', 'https://example.other/list'],
  status: 301,
  permanent: true,
  hostChanged: true,
  detectedAt: '2026-09-01T00:00:00.000Z',
  selectorFound: true,
  toTitle: 'ミラーサイト - 一覧',
};

const baseWatch: WatchModel = {
  id: 'watch-1',
  url: 'https://example.com/list',
  title: 'テスト監視',
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 10,
  paused: false,
  lastChecked: 1700000000,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: ['.items'],
  subtractedFilters: [],
  notificationTopic: 'dryeyes',
  pendingRedirect: baseProposal,
};

const renderModal = (
  proposal: Partial<RedirectProposal> = {},
  handlers: Partial<React.ComponentProps<typeof RedirectReviewModal>> = {}
) => {
  const onAccept = vi.fn().mockResolvedValue(undefined);
  const onDismiss = vi.fn().mockResolvedValue(undefined);
  render(
    <RedirectReviewModal
      watch={{ ...baseWatch, pendingRedirect: { ...baseProposal, ...proposal } }}
      isOpen
      onClose={vi.fn()}
      onAccept={onAccept}
      onDismiss={onDismiss}
      {...handlers}
    />
  );
  return { onAccept, onDismiss };
};

describe('RedirectReviewModal', () => {
  it('shows the destination host on its own so a domain swap cannot be missed', () => {
    renderModal();

    expect(screen.getByText('別のドメインへ転送されています')).toBeInTheDocument();
    // 転送元と転送先のホストが、URL 全体に埋もれず単体で読める
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('example.other')).toBeInTheDocument();
    expect(screen.getByText(/恒久的な移転 \(301\)/)).toBeInTheDocument();
    expect(screen.getByText('ミラーサイト - 一覧')).toBeInTheDocument();
  });

  it('calls a temporary redirect out as possibly not a real move', () => {
    renderModal({ status: 302, permanent: false });
    expect(screen.getByText(/一時的な転送 \(302\)/)).toBeInTheDocument();
  });

  it('warns when the watched element is missing at the destination', () => {
    renderModal({ selectorFound: false });
    expect(
      screen.getByText(/この監視が見ている要素が見つかりませんでした/)
    ).toBeInTheDocument();
  });

  it('leaves the punycode host unconverted and says why', () => {
    // 元の文字へ戻して表示すると、字面がそっくりな別ドメインを見分けられなくなる
    renderModal({ toUrl: 'https://xn--eckwd4c7c.example/list' });

    expect(screen.getByText('xn--eckwd4c7c.example')).toBeInTheDocument();
    expect(screen.getByText(/変換せずそのまま表示しています/)).toBeInTheDocument();
  });

  it('does not show the selector warning when there is nothing to check', () => {
    renderModal({ selectorFound: null });
    expect(screen.queryByText(/この監視が見ている要素/)).not.toBeInTheDocument();
  });

  it('follows the redirect only for this time by default', async () => {
    const { onAccept } = renderModal();

    fireEvent.click(screen.getByText('監視先を変更'));

    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('watch-1', false));
  });

  it('remembers the decision when asked to stop asking', async () => {
    const { onAccept } = renderModal();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('監視先を変更'));

    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('watch-1', true));
  });

  it('keeps the original URL when the move is declined', async () => {
    const { onAccept, onDismiss } = renderModal();

    fireEvent.click(screen.getByText('変更しない'));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('watch-1', false));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('renders nothing when there is no proposal to review', () => {
    const { container } = render(
      <RedirectReviewModal
        watch={{ ...baseWatch, pendingRedirect: null }}
        isOpen
        onClose={vi.fn()}
        onAccept={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
