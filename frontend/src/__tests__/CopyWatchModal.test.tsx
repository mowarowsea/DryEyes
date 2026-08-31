// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CopyWatchModal } from '../components/CopyWatchModal';
import { api } from '../api';
import { WatchModel } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const watch: WatchModel = {
  id: 'watch-1',
  url: 'https://example.com/manga',
  title: 'ぐらんぶる',
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 60,
  paused: false,
  lastChecked: 1_700_000_000,
  lastChanged: 1_700_000_000,
  hasError: false,
  lastError: null,
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: 'dryeyes-mowa-94cf11',
};

const renderModal = (onSubmit = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) => {
  render(<CopyWatchModal watch={watch} isOpen onClose={onClose} onSubmit={onSubmit} />);
  return { onSubmit, onClose };
};

describe('CopyWatchModal', () => {
  it('offers every other user as a button and copies to the one picked', async () => {
    vi.spyOn(api, 'getUsers').mockResolvedValue([
      { id: 'user-2', username: 'uga' },
      { id: 'user-3', username: 'mowa' },
    ]);
    const { onSubmit } = renderModal();

    await waitFor(() => expect(screen.getByText('uga')).toBeInTheDocument());
    expect(screen.getByText('ぐらんぶる')).toBeInTheDocument();

    // 相手を選ぶまでは実行できない
    const submit = screen.getByRole('button', { name: 'コピーを作成' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByText('uga'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('watch-1', 'user-2'));
  });

  it('says so when there is nobody to copy to', async () => {
    vi.spyOn(api, 'getUsers').mockResolvedValue([]);
    renderModal();

    await waitFor(() =>
      expect(screen.getByText('コピーできるユーザーがいません')).toBeInTheDocument()
    );
  });

  it('shows why the copy failed instead of closing', async () => {
    vi.spyOn(api, 'getUsers').mockResolvedValue([{ id: 'user-2', username: 'uga' }]);
    const onSubmit = vi.fn().mockRejectedValue(new Error('そのユーザーは見つかりません'));
    const { onClose } = renderModal(onSubmit);

    await waitFor(() => expect(screen.getByText('uga')).toBeInTheDocument());
    fireEvent.click(screen.getByText('uga'));
    fireEvent.click(screen.getByRole('button', { name: 'コピーを作成' }));

    await waitFor(() =>
      expect(screen.getByText('そのユーザーは見つかりません')).toBeInTheDocument()
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    vi.spyOn(api, 'getUsers').mockResolvedValue([]);
    const { onClose } = renderModal();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'コピーを作成' })).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
