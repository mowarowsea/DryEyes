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
  vi.spyOn(api, 'scanFeed').mockResolvedValue({ status: 'collected', added: 0 } as any);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('投入設定', () => {
  it('投入先が未設定なら pinax を既定にして保存する (トーストは出さない)', async () => {
    const onNotify = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} onNotify={onNotify} />);

    const select = (await screen.findByDisplayValue(/^pinax/)) as HTMLSelectElement;
    expect(select.value).toBe('2');
    // 保存先はユーザーの既定から動かさないので、欄そのものを出さない
    expect(screen.queryByText(/保存先/)).not.toBeInTheDocument();
    // 未保存だと所持の判定も巻数も付かないので、選んだ時点で保存する
    await waitFor(() => expect(api.saveFeedConfig).toHaveBeenCalledWith(watch.id, { userId: 2 }));
    expect(onNotify).not.toHaveBeenCalled();
    // 保存ボタンは無い。変えたその場で保存される
    expect(screen.queryByText('設定を保存')).not.toBeInTheDocument();
  });

  it('投入先を選び直したらその場で保存してトーストで知らせる', async () => {
    const onNotify = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} onNotify={onNotify} />);

    const select = await screen.findByDisplayValue(/^pinax/);
    fireEvent.change(select, { target: { value: '1' } });
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('設定を保存しました'));
    // 以前の保存先が残っていても、ここで投入先ユーザーの既定に戻す
    expect(vi.mocked(api.saveFeedConfig).mock.lastCall![1]).toEqual({ userId: 1, destDir: null });
  });

  it('蔵書から作品を選んだらその場で保存する', async () => {
    config = { ...baseConfig, userId: 1, author: null, title: null };
    vi.mocked(api.searchPinaxSeries).mockResolvedValue([
      { id: 1, title: 'ある漫画', author: '著者', files: 3, shelf: null },
      { id: 2, title: 'ある漫画 外伝', author: '著者', files: 1, shelf: null },
    ] as any);
    const onNotify = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} onNotify={onNotify} />);

    fireEvent.click(await screen.findByText('投入設定'));
    fireEvent.click(await screen.findByText('ある漫画 外伝'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('設定を保存しました'));
    expect(api.saveFeedConfig).toHaveBeenCalledWith(watch.id, { author: '著者', title: 'ある漫画 外伝', destDir: null });
  });

  it('手入力は欄を離れたときに、変わっていれば保存する', async () => {
    config = { ...baseConfig, userId: 1 };
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('投入設定'));
    fireEvent.click(screen.getByRole('tab', { name: '手入力' }));
    const title = screen.getByLabelText('作品タイトル');
    fireEvent.focus(title);
    fireEvent.blur(title);
    expect(api.saveFeedConfig).not.toHaveBeenCalled();

    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: '別の漫画' } });
    fireEvent.blur(title);
    await waitFor(() =>
      expect(api.saveFeedConfig).toHaveBeenCalledWith(watch.id, { title: '別の漫画', destDir: null })
    );
  });

  it('作品名が決まっていなければ投入せず、設定を開いて理由を出す', async () => {
    config = { ...baseConfig, userId: 1, author: null, title: null };
    candidates = [{ ...pending, meta: { ...pending.meta, title: null } }];
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('1 件を投入'));
    expect(await screen.findByText(/作品名が決まっていません/)).toBeInTheDocument();
    expect(api.sendFeedCandidates).not.toHaveBeenCalled();
    expect(screen.getByText('次の更新分からは確認なしで投入する')).toBeInTheDocument();
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

describe('開いたときの洗い出し', () => {
  it('まだ何も取り込んでいなければ、開いた時点で全件を洗い出す', async () => {
    config = { ...baseConfig, userId: 1 };
    vi.mocked(api.scanFeed).mockImplementation(async () => {
      candidates = [pending];
      return { status: 'collected', added: 1, extracted: 1 } as any;
    });
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} />);

    expect(await screen.findByText('1 件を投入')).toBeInTheDocument();
    expect(api.scanFeed).toHaveBeenCalledTimes(1);
    expect(api.scanFeed).toHaveBeenCalledWith(watch.id, true);
    expect(screen.getByText(/ページ全体から 1 件を候補にしました/)).toBeInTheDocument();
  });

  it('洗い出している間も投入設定は保存できる', async () => {
    let finish: () => void = () => {};
    vi.mocked(api.scanFeed).mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ status: 'collected', added: 0 } as any)))
    );
    const onNotify = vi.fn();
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} onNotify={onNotify} />);

    expect(await screen.findByText(/洗い出しています/)).toBeInTheDocument();
    expect(screen.getByText('全件を洗い出す')).toBeDisabled();
    fireEvent.click(screen.getByText('次の更新分からは確認なしで投入する'));
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('設定を保存しました'));
    finish();
    await waitFor(() => expect(screen.queryByText(/洗い出しています/)).not.toBeInTheDocument());
  });

  it('一度でも取り込んだことがあれば勝手には洗い出さない', async () => {
    config = { ...baseConfig, userId: 1 };
    candidates = [pending];
    render(<FeedModal watch={watch} isOpen onClose={vi.fn()} />);

    expect(await screen.findByText('1 件を投入')).toBeInTheDocument();
    expect(api.scanFeed).not.toHaveBeenCalled();
  });
});
