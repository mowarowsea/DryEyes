// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FeedModal } from '../components/FeedModal';
import { api } from '../api';
import { FeedCandidateWithState, FeedConfig, WatchModel } from '../types';

// 投入設定の既定値と、保存・投入のあとの後始末 (閉じてトーストで知らせる)。

const watch: WatchModel = {
  id: 'watch-1',
  url: 'https://example.com/works/42',
  title: 'ある漫画',
  fetchBackend: 'html_requests',
  checkIntervalMinutes: 10,
  paused: false,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: ['.items'],
  subtractedFilters: [],
  notificationTopic: 'dryeyes',
};

const baseConfig: FeedConfig = {
  autoSend: false,
  author: '著者',
  title: 'ある漫画',
  itemPattern: null,
  userId: null,
  destDir: 'D:\\old',
};

const pending: FeedCandidateWithState = {
  id: 'p1',
  watchId: watch.id,
  sourceKey: 'watch-1:p1',
  text: 'ある漫画 第2巻',
  urls: ['https://mexa.sh/x'],
  meta: { title: 'ある漫画', author: '著者', volume: '2', rawText: 'ある漫画 第2巻' },
  foundAt: '2026-09-01T00:00:00.000Z',
  status: 'pending',
  sentAt: null,
  resultNote: null,
  powerdowner: { state: 'new', reason: null, volumeFrom: 2, volumeTo: 2 },
};

let config: FeedConfig;
let candidates: FeedCandidateWithState[];

beforeEach(() => {
  config = { ...baseConfig };
  candidates = [];
  vi.spyOn(api, 'getFeedConfig').mockImplementation(async () => config);
  vi.spyOn(api, 'saveFeedConfig').mockImplementation(async (_id, next) => ({ ...config, ...next }));
  vi.spyOn(api, 'listFeedCandidates').mockImplementation(async (status) =>
    status === 'pending' ? candidates : []
  );
  vi.spyOn(api, 'listPowerdownerUsers').mockResolvedValue([
    { id: 1, name: 'mowa', defaultDir: 'D:\\manga' },
    { id: 2, name: 'pinax', defaultDir: 'D:\\pinax' },
  ]);
  vi.spyOn(api, 'searchPinaxSeries').mockResolvedValue([]);
  vi.spyOn(api, 'sendFeedCandidates').mockResolvedValue({ sent: 1, results: [], errors: [], ignored: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('投入設定', () => {
  it('投入先が未設定なら pinax を既定にし、保存すると畳んでトーストで知らせる', async () => {
    const onNotify = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} onNotify={onNotify} />);

    const select = (await screen.findByDisplayValue(/^pinax/)) as HTMLSelectElement;
    expect(select.value).toBe('2');
    // 保存先はユーザーの既定から動かさないので、欄そのものを出さない
    expect(screen.queryByText(/保存先/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('設定を保存'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('設定を保存しました'));
    // 以前の保存先が残っていても、ここで投入先ユーザーの既定に戻す
    expect(vi.mocked(api.saveFeedConfig).mock.calls[0][1]).toMatchObject({ userId: 2, destDir: null });
    expect(screen.queryByText('設定を保存')).not.toBeInTheDocument();
  });

  it('作者・作品名は蔵書と手入力のどちらか一方だけを見せる', async () => {
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} />);

    expect(await screen.findByPlaceholderText('作品名か作者名で探す')).toBeInTheDocument();
    expect(screen.queryByLabelText('作者')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '手入力' }));
    expect(screen.getByLabelText('作者')).toHaveValue('著者');
    expect(screen.queryByPlaceholderText('作品名か作者名で探す')).not.toBeInTheDocument();
  });

  it('投入したらモーダルを閉じて件数をトーストで知らせる', async () => {
    config = { ...baseConfig, userId: 1 };
    candidates = [pending];
    const onClose = vi.fn();
    const onNotify = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={onClose} onNotify={onNotify} />);

    fireEvent.click(await screen.findByText('1 件を投入'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onNotify).toHaveBeenCalledWith('1 件を PowerDowner に投入しました');
  });

  it('失敗が混じったら閉じずに理由を残す', async () => {
    config = { ...baseConfig, userId: 1 };
    candidates = [pending];
    vi.mocked(api.sendFeedCandidates).mockResolvedValue({
      sent: 0,
      results: [],
      errors: [{ id: 'p1', message: 'PowerDowner に繋がりません' }] as any,
      ignored: [],
    });
    const onClose = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={onClose} />);

    fireEvent.click(await screen.findByText('1 件を投入'));
    expect(await screen.findByText(/PowerDowner に繋がりません/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
