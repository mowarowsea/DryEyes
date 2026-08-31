// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EditWatchModal } from '../components/EditWatchModal';
import { WatchModel } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const watch: WatchModel = {
  id: 'watch-1',
  url: 'https://example.com/manga/1',
  title: 'ぐらんぶる',
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 60,
  paused: false,
  lastChecked: 1700000000,
  lastChanged: 1700000000,
  hasError: false,
  lastError: null,
  includeFilters: ['//*[@id="list"]'],
  subtractedFilters: [],
  notificationTopic: 'dryeyes-mowa-94cf11-manga',
};

const renderModal = (onSubmit = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <EditWatchModal
      watch={watch}
      isOpen
      userTopic="dryeyes-mowa-94cf11"
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
};

const save = () => fireEvent.click(screen.getByText('変更を保存する'));

describe('EditWatchModal', () => {
  it('prefills every current setting, URL included', () => {
    renderModal();

    expect(screen.getByDisplayValue('https://example.com/manga/1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ぐらんぶる')).toBeInTheDocument();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();
    expect(screen.getByDisplayValue('//*[@id="list"]')).toBeInTheDocument();
    // 通知トピックはユーザートピックを除いた識別子だけを見せる
    expect(screen.getByDisplayValue('manga')).toBeInTheDocument();
  });

  it('saves a new URL and asks for a recheck so the new content becomes a diff', async () => {
    const onSubmit = renderModal();

    fireEvent.change(screen.getByDisplayValue('https://example.com/manga/1'), {
      target: { value: 'https://example.com/manga/2' },
    });
    save();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      'watch-1',
      expect.objectContaining({ url: 'https://example.com/manga/2' }),
      { recheck: true }
    );
  });

  it('warns that the history is kept when the URL is changed', () => {
    renderModal();

    expect(screen.queryByText(/これまでの履歴は残る/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('https://example.com/manga/1'), {
      target: { value: 'https://example.com/manga/2' },
    });

    expect(screen.getByText(/これまでの履歴は残る/)).toBeInTheDocument();
  });

  it('asks for a recheck when the monitored elements changed', async () => {
    const onSubmit = renderModal();

    fireEvent.change(screen.getByDisplayValue('//*[@id="list"]'), {
      target: { value: '//*[@id="chapters"]' },
    });
    save();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][2]).toEqual({ recheck: true });
  });

  it('does not recheck when only the title or interval changed', async () => {
    const onSubmit = renderModal();

    fireEvent.change(screen.getByDisplayValue('ぐらんぶる'), {
      target: { value: 'ぐらんぶる（更新チェック）' },
    });
    fireEvent.click(screen.getByText('30分'));
    save();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      'watch-1',
      expect.objectContaining({
        title: 'ぐらんぶる（更新チェック）',
        checkIntervalMinutes: 30,
        url: 'https://example.com/manga/1',
      }),
      { recheck: false }
    );
  });
});
