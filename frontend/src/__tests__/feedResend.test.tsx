// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { FeedModal } from '../components/FeedModal';
import { api } from '../api';
import { FeedCandidateWithState, WatchModel } from '../types';

// 投入済みの入れ直し。
//
// PowerDowner 側でジョブを消してしまうと、DryEyes は「送った」まま、向こうには何も無い
// という状態になる。同じ行は sourceKey で弾かれるので次のスキャンでも候補に戻らない。
// この画面から送り直せることと、消えている行がそれと分かることを見る。

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

/** state を省くと「向こうに見当たらない」= ジョブを消された行になる */
const sentItem = (
  id: string,
  volume: number,
  powerdowner: FeedCandidateWithState['powerdowner'] = {
    state: 'new',
    reason: null,
    volumeFrom: volume,
    volumeTo: volume,
  }
): FeedCandidateWithState => ({
  id,
  watchId: watch.id,
  sourceKey: `watch-1:${id}`,
  text: `ある漫画 第${volume}巻`,
  urls: ['https://mexa.sh/x'],
  meta: { title: 'ある漫画', author: '著者', volume: String(volume), rawText: `ある漫画 第${volume}巻` },
  foundAt: '2026-09-01T00:00:00.000Z',
  status: 'sent',
  sentAt: '2026-09-02T03:04:00.000Z',
  resultNote: '投入しました (ジョブ 3f2a1b9c)',
  powerdowner,
});

let sent: FeedCandidateWithState[] = [];

const renderModal = () => render(<FeedModal watch={watch} isOpen onClose={vi.fn()} />);

beforeEach(() => {
  sent = [];
  vi.spyOn(api, 'getFeedConfig').mockResolvedValue({
    autoSend: false,
    author: '著者',
    title: 'ある漫画',
    itemPattern: null,
    userId: 1,
    destDir: null,
  });
  vi.spyOn(api, 'listFeedCandidates').mockImplementation(async (status) =>
    status === 'sent' ? sent : []
  );
  vi.spyOn(api, 'listPowerdownerUsers').mockResolvedValue([{ id: 1, name: 'mowa', defaultDir: 'D:\manga' }]);
  vi.spyOn(api, 'sendFeedCandidates').mockResolvedValue({ sent: 1, results: [], errors: [], ignored: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('投入済みの再投入', () => {
  it('畳んだ見出しを開くと投入済みが並び、1 件だけ送り直せる', async () => {
    sent = [sentItem('c1', 3, { state: 'merge', reason: null, volumeFrom: 3, volumeTo: 3 })];
    renderModal();

    // 普段は畳んである。件数だけが見えていて中身は出さない
    const header = await screen.findByText('投入済み (1)');
    expect(screen.queryByText('再投入')).not.toBeInTheDocument();

    fireEvent.click(header);
    // 何を送ったのかは巻数と向こうの返答で分かる
    expect(screen.getByText('第3巻')).toBeInTheDocument();
    expect(screen.getByText(/投入しました/)).toBeInTheDocument();
    // 向こうがまだ抱えているものは、そうと分かる
    expect(screen.getByText('取得中')).toBeInTheDocument();

    fireEvent.click(screen.getByText('再投入'));

    await waitFor(() => expect(api.sendFeedCandidates).toHaveBeenCalled());
    // 投入済みを送り直すので resend を立てる。立てないと向こうへ届かず黙って無視される
    expect(vi.mocked(api.sendFeedCandidates).mock.calls[0]).toEqual([['c1'], true]);
  });

  it('向こうに見当たらないものは、畳んだままでも件数が見えてまとめて送り直せる', async () => {
    sent = [
      sentItem('c1', 3),
      sentItem('c2', 4),
      sentItem('c3', 5, { state: 'skip', reason: '取得済み (第5巻)', volumeFrom: 5, volumeTo: 5 }),
    ];
    renderModal();

    // 開かなくても気づけること。ジョブを消したことに気づくのは大抵この画面ではない
    const button = await screen.findByText(/ジョブが無い 2 件を再投入/);
    fireEvent.click(button);

    await waitFor(() => expect(api.sendFeedCandidates).toHaveBeenCalled());
    expect(vi.mocked(api.sendFeedCandidates).mock.calls[0]).toEqual([['c1', 'c2'], true]);
  });

  it('巻数を読めない行は「ジョブなし」とは言わない', async () => {
    // 巻数が取れないと向こうの重なり判定に参加できず、消えていなくても new で返ってくる。
    // これを消えた扱いにすると、押しても何も起きないボタンだけが並ぶ
    sent = [sentItem('c1', 1, { state: 'new', reason: null, volumeFrom: null, volumeTo: null })];
    renderModal();

    fireEvent.click(await screen.findByText('投入済み (1)'));
    expect(screen.queryByText('ジョブなし')).not.toBeInTheDocument();
    expect(screen.queryByText(/ジョブが無い/)).not.toBeInTheDocument();
    // 送り直す口そのものは残す。判定できないだけで、消えている可能性はある
    expect(screen.getByText('再投入')).toBeInTheDocument();
  });
});
