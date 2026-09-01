// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { VisualElementPickerModal } from '../components/VisualElementPickerModal';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
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

const previewSrc = () => screen.getByTitle('Page Preview').getAttribute('src') || '';

// ピッカーの枠だけ暗くて中身が真っ白だと目に痛いので、プレビューにも表示テーマを伝える
describe('要素ピッカーのプレビュー', () => {
  it('ライトテーマならライトとして取りに行く', () => {
    renderPicker();
    expect(previewSrc()).toContain('theme=light');
  });

  it('ログイン中のユーザーがダークを選んでいればダークとして取りに行く', () => {
    document.documentElement.classList.add('dark');
    renderPicker();
    expect(previewSrc()).toContain('theme=dark');
  });

  it('開いたままテーマを切り替えたら取り直す', async () => {
    renderPicker();
    expect(previewSrc()).toContain('theme=light');

    act(() => {
      document.documentElement.classList.add('dark');
    });

    await waitFor(() => expect(previewSrc()).toContain('theme=dark'));
  });
});
