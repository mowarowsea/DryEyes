// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { VisualElementPickerModal } from '../components/VisualElementPickerModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderPicker = () =>
  render(
    <VisualElementPickerModal
      isOpen
      targetUrl="https://example.com/"
      onClose={vi.fn()}
      onSelectXPath={vi.fn()}
    />
  );

// プレビューの中で要素を選んだときに飛んでくるメッセージを再現する
const selectElement = (payload: Record<string, unknown>) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'DRYEYES_ELEMENT_SELECTED',
          payload: {
            xpath: '/html/body/div[1]/ul/li[1]/a',
            similarXPath: '//a[contains(@class, "episode")]',
            similarCount: 12,
            similarTexts: ['第112話'],
            selector: 'a.episode',
            text: '第112話',
            tagName: 'a',
            canExpand: true,
            ...payload,
          },
        },
      })
    );
  });

const previewWindow = () =>
  (screen.getByTitle('Page Preview') as HTMLIFrameElement).contentWindow!;

describe('要素ピッカーの選択操作', () => {
  it('類似要素をまとめて選べることを件数付きで見せる', async () => {
    renderPicker();
    selectElement({});

    const button = await screen.findByRole('button', { name: /類似要素も選択/ });
    // 押すかどうかで結果が変わるので、件数まで読めるようにしておく
    expect(button).toHaveTextContent('12件');
  });

  it('類似要素が1件しかないならまとめる意味がないので出さない', async () => {
    renderPicker();
    selectElement({ similarCount: 1 });

    await screen.findByRole('button', { name: /選択範囲を拡大/ });
    expect(screen.queryByRole('button', { name: /類似要素も選択/ })).not.toBeInTheDocument();
  });

  it('選択範囲を拡大するとプレビューへ拡大を頼む', async () => {
    renderPicker();
    const postMessage = vi.spyOn(previewWindow(), 'postMessage');
    selectElement({});

    fireEvent.click(await screen.findByRole('button', { name: /選択範囲を拡大/ }));

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ type: 'DRYEYES_EXPAND_SELECTION' }, '*')
    );
  });

  it('これ以上外側が無い要素では拡大ボタンを出さない', async () => {
    renderPicker();
    selectElement({ canExpand: false });

    await screen.findByRole('button', { name: /類似要素も選択/ });
    expect(screen.queryByRole('button', { name: /選択範囲を拡大/ })).not.toBeInTheDocument();
  });

  it('要素を選ぶまではどちらのボタンも出さない', () => {
    renderPicker();
    expect(screen.queryByRole('button', { name: /選択範囲を拡大/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /類似要素も選択/ })).not.toBeInTheDocument();
  });
});
