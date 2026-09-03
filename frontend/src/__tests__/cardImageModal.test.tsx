// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CardImageModal } from '../components/CardImageModal';
import { api } from '../api';
import { WatchModel } from '../types';

// カード背景の選び直し。候補を選ぶ → 切り抜きを決める → 保存、までを通しで見る。
// 切り抜きは画面で測った箱の大きさから決まるので、jsdom では実寸を持たせてやる必要がある。

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
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: 'dryeyes',
};

const renderModal = () => {
  const onSaved = vi.fn();
  render(
    <CardImageModal watch={watch} isOpen onClose={vi.fn()} onSaved={onSaved} />
  );
  return onSaved;
};

// jsdom はレイアウトも画像の読み込みもしないので、そこだけ手で与える
const restores: (() => void)[] = [];

const withBoxSize = (width: number, height: number) => {
  const original = {
    width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: height });
  restores.push(() => {
    if (original.width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original.width);
    if (original.height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.height);
  });
};

const loadImage = (img: HTMLImageElement, naturalWidth: number, naturalHeight: number) => {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: naturalWidth });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: naturalHeight });
  fireEvent.load(img);
};

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:candidate');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(api, 'getCardImageOptions').mockResolvedValue({
    // 既に候補から選んである監視。ここから選び直す。
    mode: 'url',
    crop: null,
    browserFailed: false,
    candidates: [
      { url: 'https://cdn.example.com/cover.jpg', current: true },
      { url: 'https://cdn.example.com/ogp.png', current: false },
    ],
  });
  vi.spyOn(api, 'getCardImageCandidateBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  vi.spyOn(api, 'saveCardImage').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  while (restores.length) restores.pop()!();
  vi.restoreAllMocks();
});

describe('背景画像を変更', () => {
  it('候補を選ぶと切り抜きの画面になり、決めた範囲ごと保存する', async () => {
    withBoxSize(400, 60);
    const onSaved = renderModal();

    // 候補のサムネイルは BFF 経由でしか読めないので、取れてから押せるようになる
    const tile = await waitFor(() => {
      const found = screen.getByTitle('https://cdn.example.com/cover.jpg');
      expect(found).toBeEnabled();
      return found;
    });

    fireEvent.click(tile);

    // 仕上がりを見ながら決められる
    expect(screen.getByText('カードでの見え方')).toBeInTheDocument();

    // 縦長の絵として読み込ませる（切り抜き枠の縦横比は箱から決まる）
    loadImage(screen.getByAltText('切り抜き対象') as HTMLImageElement, 500, 1000);

    await waitFor(() => expect(screen.getByLabelText('拡大')).toBeEnabled());
    fireEvent.click(screen.getByText('この絵にする'));

    await waitFor(() => expect(api.saveCardImage).toHaveBeenCalled());
    const [id, body] = vi.mocked(api.saveCardImage).mock.calls[0];
    expect(id).toBe('watch-1');
    expect(body.mode).toBe('url');
    expect(body.url).toBe('https://cdn.example.com/cover.jpg');
    // 既定は「今までどおりの見え方」＝幅いっぱいの帯が真ん中
    expect(body.crop?.ratio).toBeCloseTo(0.5, 5);
    expect(body.crop?.width).toBe(1);
    expect(body.crop?.height).toBeCloseTo(0.075, 5);

    expect(onSaved).toHaveBeenCalledWith('watch-1', expect.stringContaining('背景画像'));
  });

  it('「画像なし」と「自動で選ぶ」は、選んだ時点で確定する', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('画像なし')).toBeEnabled());

    fireEvent.click(screen.getByText('画像なし'));
    await waitFor(() => expect(api.saveCardImage).toHaveBeenCalledWith('watch-1', { mode: 'none' }));

    cleanup();
    vi.mocked(api.saveCardImage).mockClear();
    renderModal();
    await waitFor(() => expect(screen.getByText('自動で選ぶ（おまかせ）')).toBeEnabled());

    fireEvent.click(screen.getByText('自動で選ぶ（おまかせ）'));
    await waitFor(() => expect(api.saveCardImage).toHaveBeenCalledWith('watch-1', { mode: 'auto' }));
  });

  it('候補が見つからなくても、手元の画像や画像なしは選べる', async () => {
    vi.mocked(api.getCardImageOptions).mockResolvedValue({
      mode: 'auto',
      crop: null,
      browserFailed: true,
      candidates: [],
    });
    renderModal();

    await waitFor(() =>
      expect(screen.getByText(/背景に使えそうな画像が見つかりませんでした/)).toBeInTheDocument()
    );
    expect(screen.getByText('手元の画像を使う')).toBeEnabled();
    // ブラウザに繋げなかったときは、候補が少ない理由を出す
    expect(screen.getByText(/Docker/)).toBeInTheDocument();
  });
});
