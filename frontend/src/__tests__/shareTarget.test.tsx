// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../App';
import { api, authToken } from '../api';
import { AuthUser, MeResponse } from '../types';

const user: AuthUser = {
  id: 'user-1',
  username: 'mowz',
  ntfyTopic: 'dryeyes-mowz-94cf11',
  createdAt: '2026-08-30T11:00:02.945Z',
};

const me: MeResponse = {
  user,
  ntfy: {
    baseUrl: 'http://localhost:8085',
    topic: user.ntfyTopic,
    subscribeUrl: `http://localhost:8085/${user.ntfyTopic}`,
  },
};

// スマホの共有シート（PWA の share_target）は `…/?shared=…&title=…` で開いてくる
const openedFromShareSheet = (query: string) => window.history.replaceState({}, '', query);

beforeEach(() => {
  vi.restoreAllMocks();
  authToken.set('test-token');
  window.history.replaceState({}, '', '/');

  vi.spyOn(api, 'getMe').mockResolvedValue(me);
  vi.spyOn(api, 'getHealth').mockRejectedValue(new Error('health は本テストでは使わない'));
  vi.spyOn(api, 'getWatches').mockResolvedValue([]);
  vi.spyOn(api, 'getPageInfo').mockResolvedValue({ title: 'ぐらんぶる', url: 'https://example.com/manga' });
});

afterEach(() => {
  cleanup();
  authToken.clear();
});

describe('共有シートからの起動', () => {
  it('opens the element picker for the shared URL without any typing', async () => {
    openedFromShareSheet(
      `/?shared=${encodeURIComponent('https://example.com/manga')}&title=%E3%81%90%E3%82%89`
    );

    render(<App />);

    // 共有された URL が入った状態で、そのまま要素の選択まで進む
    expect(await screen.findByTitle('Page Preview')).toBeInTheDocument();
    expect(screen.getByText('Step 2/3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/manga')).toBeInTheDocument();
    // リロードで開き直さないようにクエリは消えている
    expect(window.location.search).toBe('');
  });

  it('opens the create form even when the share sheet passed no parameters', async () => {
    openedFromShareSheet('/share');

    render(<App />);

    // パラメータが落ちても、共有から来たことはパスで分かる。
    // URL は空のまま登録モーダルを開き、貼り付けから続けられるようにする。
    expect(await screen.findByText('監視対象URLの入力')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://example.com/comics/123')).toHaveValue('');
    expect(screen.getByText(/共有からURLを受け取れませんでした/)).toBeInTheDocument();
  });

  it('opens the empty create form for the home screen shortcut', async () => {
    openedFromShareSheet('/?add=1');

    render(<App />);

    expect(await screen.findByText('監視対象URLの入力')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://example.com/comics/123')).toHaveValue('');
    // URL がないので要素の選択には進めない
    expect(screen.queryByTitle('Page Preview')).not.toBeInTheDocument();
    // ショートカットは意図して空なので、共有失敗の案内は出さない
    expect(screen.queryByText(/共有からURLを受け取れませんでした/)).not.toBeInTheDocument();
  });

  it('does not open the create form when the app is opened normally', async () => {
    render(<App />);

    await waitFor(() => expect(api.getWatches).toHaveBeenCalled());
    expect(screen.queryByText('監視対象URLの入力')).not.toBeInTheDocument();
  });
});
