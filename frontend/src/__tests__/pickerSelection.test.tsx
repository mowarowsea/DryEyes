// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { VisualElementPickerModal } from '../components/VisualElementPickerModal';
import type { WatchModel } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderPicker = (
  props: Partial<React.ComponentProps<typeof VisualElementPickerModal>> = {}
) =>
  render(
    <VisualElementPickerModal
      isOpen
      targetUrl="https://example.com/"
      onClose={vi.fn()}
      onSelectXPath={vi.fn()}
      {...props}
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

// 同じサイトの他の監視が見ている場所を引き継ぐ流れ。
// 候補は親（登録モーダル）が渡し、このページに当たるかはプレビューに調べさせる。
describe('同じサイトの監視場所の引き継ぎ', () => {
  const template = {
    host: 'example.com',
    includeFilters: ['//*[@id="list"]/li/a'],
    subtractedFilters: [],
    count: 5,
    sample: { id: 'sample' } as WatchModel,
  };

  const probeResult = (count: number, texts: string[]) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRYEYES_PROBE_RESULT', count, texts },
        })
      );
    });

  it('ページを読み込んだら、候補がこのページにも当たるかをプレビューに調べさせる', () => {
    renderPicker({ template });
    const postMessage = vi.spyOn(previewWindow(), 'postMessage');

    fireEvent.load(screen.getByTitle('Page Preview'));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DRYEYES_PROBE_SELECTORS',
        selectors: ['//*[@id="list"]/li/a'],
      }),
      '*'
    );
    expect(screen.getByText(/このページで探しています/)).toBeInTheDocument();
  });

  it('当たったら件数と例を見せ、「同じ場所で登録する」で親へ渡す', async () => {
    const onApplyTemplate = vi.fn();
    renderPicker({ template, onApplyTemplate });

    probeResult(12, ['第112話', '第111話']);

    expect(screen.getByText(/12 件が当たります（第112話 など）/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /同じ場所で登録する/ }));

    expect(onApplyTemplate).toHaveBeenCalledWith(template, ['第112話', '第111話']);
  });

  it('当たらなければ登録ボタンは出さず、その旨を伝える', () => {
    renderPicker({ template, onApplyTemplate: vi.fn() });

    probeResult(0, []);

    expect(screen.getByText(/見つかりませんでした/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /同じ場所で登録する/ })).not.toBeInTheDocument();
  });

  it('要素を自分で選び始めたら、引き継ぎの案内は引っ込める', async () => {
    renderPicker({ template, onApplyTemplate: vi.fn() });
    probeResult(12, ['第112話']);
    expect(screen.getByRole('button', { name: /同じ場所で登録する/ })).toBeInTheDocument();

    selectElement({});

    await screen.findByRole('button', { name: /類似要素も選択/ });
    expect(screen.queryByRole('button', { name: /同じ場所で登録する/ })).not.toBeInTheDocument();
  });

  it('候補が無ければ何も出さない', () => {
    renderPicker();
    expect(screen.queryByText(/同じ場所を見張れます/)).not.toBeInTheDocument();
  });
});
