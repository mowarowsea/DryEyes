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

const preview = () => screen.getByTitle('Page Preview') as HTMLIFrameElement;

// プレビューのページが <head> で名乗るメッセージ
const announcePreview = (mode: 'static' | 'browser' = 'static') =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'DRYEYES_RENDER_MODE', mode } }));
  });

const FAILURE_TITLE = /プレビューを取得できませんでした/;

// サーバーが止まっていると iframe にはエラーページやオフライン画面が入り、ただ真っ白に見える。
// 「何も届いていない」ことに気づいて理由を出すのがこの画面の役目。
describe('要素ピッカーのプレビューが届かないとき', () => {
  it('読み込み後にプレビューが名乗ってこなければ、取得に失敗した旨と再読み込みを出す', async () => {
    renderPicker();

    fireEvent.load(preview());

    expect(await screen.findByText(FAILURE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/止まっていないか確認/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /再読み込み/ })).toBeInTheDocument();
    // 届いていないページに対して「もっと頑張って描画」を勧めても意味が無い
    expect(screen.queryByText(/もうちょっと頑張って描画する/)).not.toBeInTheDocument();
  });

  it('プレビューが名乗ってくれば、失敗扱いにしない', async () => {
    renderPicker();

    announcePreview();
    fireEvent.load(preview());

    // 名乗り待ちの猶予を過ぎても失敗にならないこと
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText(FAILURE_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText(/もうちょっと頑張って描画する/)).toBeInTheDocument();
  });

  it('遅れて名乗ってきたら失敗の表示を引っ込める', async () => {
    renderPicker();

    fireEvent.load(preview());
    expect(await screen.findByText(FAILURE_TITLE)).toBeInTheDocument();

    announcePreview();

    expect(screen.queryByText(FAILURE_TITLE)).not.toBeInTheDocument();
  });

  it('サーバーが取得に失敗した理由を返してきたら、それをそのまま見せる', async () => {
    renderPicker();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'DRYEYES_PREVIEW_ERROR', message: 'この端末自身を指す URL は取得しません' },
        })
      );
    });
    fireEvent.load(preview());

    expect(await screen.findByText(FAILURE_TITLE)).toBeInTheDocument();
    expect(screen.getByText('この端末自身を指す URL は取得しません')).toBeInTheDocument();
  });

  it('再読み込みを押すと、失敗の表示を消して取り直す', async () => {
    renderPicker();

    fireEvent.load(preview());
    expect(await screen.findByText(FAILURE_TITLE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /再読み込み/ }));

    expect(screen.queryByText(FAILURE_TITLE)).not.toBeInTheDocument();
    expect(screen.getByText(/ページを読み込み中/)).toBeInTheDocument();

    // 取り直した先が名乗ってくれば通常どおり使える
    announcePreview();
    fireEvent.load(preview());
    await waitFor(() => expect(screen.queryByText(/ページを読み込み中/)).not.toBeInTheDocument());
    expect(screen.queryByText(FAILURE_TITLE)).not.toBeInTheDocument();
  });
});
