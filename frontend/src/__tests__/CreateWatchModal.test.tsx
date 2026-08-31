// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CreateWatchModal } from '../components/CreateWatchModal';
import { api } from '../api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderModal = (
  onClose = vi.fn(),
  onSubmit = vi.fn().mockResolvedValue(undefined),
  initialUrl: string | null = null
) => {
  render(
    <CreateWatchModal
      isOpen
      onClose={onClose}
      onSubmit={onSubmit}
      userTopic="dryeyes-mowa-94cf11"
      initialUrl={initialUrl}
    />
  );
  return { onClose, onSubmit };
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

    expect(screen.getByText('Step 1/3')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.getByText('Step 3/3')).toBeInTheDocument());
    // ページの <title> が表示名の初期値になる
    expect(screen.getByDisplayValue('ぐらんぶる')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /監視を登録する/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/manga',
        title: 'ぐらんぶる',
        checkIntervalMinutes: 60,
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
    expect(screen.getByText('Step 2/3')).toBeInTheDocument();
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

  it('registers the whole page when the picker is skipped', async () => {
    vi.spyOn(api, 'getPageInfo').mockResolvedValue({
      title: 'ぐらんぶる',
      url: 'https://example.com/manga',
    });
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByPlaceholderText('https://example.com/comics/123'), {
      target: { value: 'https://example.com/manga' },
    });
    fireEvent.click(screen.getByRole('button', { name: /ページ全体を見張る/ }));

    await waitFor(() => expect(screen.getByText('登録オプションの設定')).toBeInTheDocument());
    expect(screen.queryByTitle('Page Preview')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('ぐらんぶる')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /監視を登録する/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // ページ全体が対象なので、絞り込みのフィルタは付かない
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/manga',
        title: 'ぐらんぶる',
        includeFilters: [],
        subtractedFilters: [],
      })
    );
  });
});
