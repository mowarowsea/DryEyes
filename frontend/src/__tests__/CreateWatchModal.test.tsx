// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CreateWatchModal } from '../components/CreateWatchModal';
import { api } from '../api';
import { WatchModel } from '../types';

// 登録前の重複確認は、既定では「見つからない」。見つかる場合のテストで個別に差し替える。
beforeEach(() => {
  vi.spyOn(api, 'findDuplicateWatch').mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderModal = (
  onClose = vi.fn(),
  onSubmit = vi.fn().mockResolvedValue(undefined),
  initialUrl: string | null = null,
  onOpenExisting?: (watchId: string) => void,
  watches: WatchModel[] = []
) => {
  render(
    <CreateWatchModal
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      userTopic="dryeyes-mowa-94cf11"
      initialUrl={initialUrl}
      onOpenExisting={onOpenExisting}
      watches={watches}
    />
  );
  return { onClose, onSubmit };
};

const typeUrl = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('https://example.com/comics/123'), {
    target: { value },
  });

// ピッカー内で要素がタップされた体にする
const selectElement = (xpath: string, similarCount = 1) => {
  fireEvent(
    window,
    new MessageEvent('message', {
      data: {
        type: 'DRYEYES_ELEMENT_SELECTED',
        payload: {
          xpath,
          similarXPath: '',
          similarCount,
          selector: '#list',
          text: '第111話',
          tagName: 'DIV',
        },
      },
    })
  );
};

// URL を入れて「次へ」を押すと要素ピッカーが開く
const proceedToPicker = async () => {
  fireEvent.change(screen.getByPlaceholderText('https://example.com/comics/123'), {
    target: { value: 'https://example.com/manga' },
  });
  fireEvent.click(screen.getByRole('button', { name: /次へ/ }));
  await waitFor(() => expect(screen.getByTitle('Page Preview')).toBeInTheDocument());
};

describe('CreateWatchModal', () => {
  it('starts at the URL step', () => {
    renderModal();

    expect(screen.getByText('Step 1/2')).toBeInTheDocument();
    expect(screen.getByText('監視対象URLの入力')).toBeInTheDocument();
  });

  it('closes on Escape while on the URL step', () => {
    const { onClose } = renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('lets Escape close only the element picker stacked on top, not the wizard behind it', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onClose } = renderModal();

    await proceedToPicker();

    // 手前のピッカーだけが閉じ、登録ウィザードは開いたまま残る
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTitle('Page Preview')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('監視対象URLの入力')).toBeInTheDocument();
  });

  it('prefills the title from the page and registers the watch after picking an element', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onSubmit } = renderModal();

    await proceedToPicker();

    // ピッカーから要素が選ばれた体で Step 3 へ進める
    fireEvent(
      window,
      new MessageEvent('message', {
        data: {
          type: 'DRYEYES_ELEMENT_SELECTED',
          payload: {
            xpath: '//*[@id="list"]',
            similarXPath: '',
            similarCount: 1,
            selector: '#list',
            text: '第111話',
            tagName: 'DIV',
          },
        },
      })
    );
    // 設定は同じ画面に畳んである。ページの <title> が表示名の初期値になる。
    fireEvent.click(screen.getByRole('button', { name: /オプション/ }));
    expect(screen.getByDisplayValue('ぐらんぶる')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /監視を登録する/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/manga',
        title: 'ぐらんぶる',
        checkIntervalMinutes: 180,
        includeFilters: ['//*[@id="list"]'],
      })
    );
  });

  // スマホの共有シートから開かれたときの導線
  it('jumps straight to the element picker with the URL shared from the phone', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    renderModal(vi.fn(), vi.fn().mockResolvedValue(undefined), 'https://example.com/manga');

    // URL 入力も「次へ」も踏まずに要素の選択まで進む
    await waitFor(() => expect(screen.getByTitle('Page Preview')).toBeInTheDocument());
    expect(screen.getByText('Step 2/2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/manga')).toBeInTheDocument();
  });

  it('does not reopen the picker after the user closes it', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onClose } = renderModal(
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
      'https://example.com/manga'
    );

    await waitFor(() => expect(screen.getByTitle('Page Preview')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Escape' });

    // ピッカーだけが閉じ、URL 入力済みの Step 1 が残る（自動では開き直さない）
    await waitFor(() => expect(screen.queryByTitle('Page Preview')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('https://example.com/manga')).toBeInTheDocument();
  });

  it('watches the whole page when the picker is confirmed without picking anything', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onSubmit } = renderModal();

    await proceedToPicker();

    // 要素を選ばずに確定するとページ全体が対象になる
    fireEvent.click(screen.getByRole('button', { name: /監視を登録する/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/manga',
        title: 'ぐらんぶる',
        includeFilters: [],
        subtractedFilters: [],
      })
    );
  });

  it('keeps the picker open while excluded elements are added', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onSubmit } = renderModal();

    await proceedToPicker();
    selectElement('//*[@id="ad"]');
    fireEvent.click(screen.getByRole('button', { name: '除外' }));

    // 続けて選べるよう画面は開いたまま。除外はオプションに溜まる。
    expect(screen.getByTitle('Page Preview')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /オプション/ }));
    expect(screen.getByDisplayValue('//*[@id="ad"]')).toBeInTheDocument();
  });
});

// 監視が増えると「これ登録したっけ」が起きる。共有シートから来たときはとくに一覧を見ないので、
// 同じページの監視が既にあれば要素の選択へ進む前に知らせる。
describe('登録前の重複確認', () => {
  const existing = {
    id: 'watch-1',
    title: 'ぐらんぶる',
    url: 'https://example.com/manga',
    reason: 'same' as const,
  };

  it('warns that the page is already watched and can jump to that watch instead', async () => {
    vi.spyOn(api, 'findDuplicateWatch').mockResolvedValue(existing);
    const getPageInfo = vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const onOpenExisting = vi.fn();
    const { onClose } = renderModal(vi.fn(), vi.fn(), null, onOpenExisting);

    typeUrl('https://example.com/manga');
    fireEvent.click(screen.getByRole('button', { name: /次へ/ }));

    expect(await screen.findByText(/すでに監視しています/)).toBeInTheDocument();
    expect(screen.getByText('ぐらんぶる')).toBeInTheDocument();
    // 要素の選択には進まない（ページも読みに行かない）
    expect(screen.queryByTitle('Page Preview')).not.toBeInTheDocument();
    expect(getPageInfo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '登録済みの監視を見る' }));
    expect(onOpenExisting).toHaveBeenCalledWith('watch-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('still lets the user register the same page on purpose', async () => {
    const lookup = vi.spyOn(api, 'findDuplicateWatch').mockResolvedValue(existing);
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    renderModal();

    typeUrl('https://example.com/manga');
    fireEvent.click(screen.getByRole('button', { name: /次へ/ }));
    await screen.findByText(/すでに監視しています/);

    fireEvent.click(screen.getByRole('button', { name: 'それでも登録する' }));

    await waitFor(() => expect(screen.getByTitle('Page Preview')).toBeInTheDocument());
    // 押し切ったあとに同じ確認を繰り返さない
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('clears the warning once the URL is edited', async () => {
    vi.spyOn(api, 'findDuplicateWatch').mockResolvedValue(existing);
    renderModal();

    typeUrl('https://example.com/manga');
    fireEvent.click(screen.getByRole('button', { name: /次へ/ }));
    await screen.findByText(/すでに監視しています/);

    typeUrl('https://example.com/manga-2');

    expect(screen.queryByText(/すでに監視しています/)).not.toBeInTheDocument();
  });

  it('holds a shared URL at the first step when it is already watched via a moved domain', async () => {
    vi.spyOn(api, 'findDuplicateWatch').mockResolvedValue({
      ...existing,
      url: 'https://old.example/manga',
      reason: 'redirect',
    });
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    renderModal(vi.fn(), vi.fn(), 'https://example.com/manga');

    expect(await screen.findByText(/すでに監視しています/)).toBeInTheDocument();
    // 別ドメインで登録済みのときは、どこで登録したかが分かる
    expect(screen.getByText(/old\.example/)).toBeInTheDocument();
    expect(screen.queryByTitle('Page Preview')).not.toBeInTheDocument();
  });
});

// 同じサイトのページは作りが揃っているので、他の監視の監視場所をそのまま使えることが多い。
// 毎回タップし直さずに済むよう、候補がこのページにも当たるなら 1 タップで登録できる。
describe('同じサイトの監視から監視場所を引き継ぐ', () => {
  const LIST = '//*[@id="list"]/li/a';
  const watchOn = (
    id: string,
    url: string,
    includeFilters: string[],
    subtractedFilters: string[] = []
  ): WatchModel => ({
    id,
    url,
    title: id,
    fetchBackend: 'html_webdriver',
    checkIntervalMinutes: 180,
    paused: false,
    lastChecked: null,
    lastChanged: null,
    hasError: false,
    lastError: null,
    includeFilters,
    subtractedFilters,
    notificationTopic: '',
  });
  const sameSite = [
    watchOn('w1', 'https://example.com/manga/a', [LIST]),
    watchOn('w2', 'https://example.com/manga/b', [LIST], ['.ad']),
    watchOn('w3', 'https://example.com/manga/c', [LIST], ['.ad']),
  ];

  // プレビューが「このページで何件に当たったか」を返してきた体にする
  const probeResult = (count: number, texts: string[]) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRYEYES_PROBE_RESULT', count, texts },
        })
      );
    });

  it('registers with the selectors shared by the other watches of the same site in one tap', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onSubmit } = renderModal(vi.fn(), vi.fn().mockResolvedValue(undefined), null, undefined, sameSite);

    await proceedToPicker();
    expect(screen.getByText(/このサイトの他の監視 3 件/)).toBeInTheDocument();
    // このページに当たると分かるまでは登録ボタンを出さない
    expect(screen.queryByRole('button', { name: /同じ場所で登録する/ })).not.toBeInTheDocument();

    probeResult(48, ['第42.1話', '第41話']);
    expect(screen.getByText(/48 件が当たります/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /同じ場所で登録する/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/manga',
        title: 'ぐらんぶる',
        includeFilters: [LIST],
        // 除外は同じ場所を見ている監視の多数派に揃う
        subtractedFilters: ['.ad'],
      })
    );
  });

  it('offers nothing when no other watch of the site has a selector', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    renderModal(vi.fn(), vi.fn(), null, undefined, [
      watchOn('other', 'https://other.example/x', [LIST]),
    ]);

    await proceedToPicker();

    expect(screen.queryByText(/同じ場所を見張れます/)).not.toBeInTheDocument();
  });
});
