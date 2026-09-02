// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WatchCard } from '../components/WatchCard';
import { forgetCardImage } from '../hooks/useCardImage';
import { api } from '../api';
import { WatchModel } from '../types';

// カード背景の絵まわり。取れたときだけ見た目が変わり、取れなければ従来どおりであることを見る。
describe('WatchCard のカード背景', () => {
  const watch: WatchModel = {
    id: 'card-image-1',
    url: 'https://example.com/works/42',
    title: 'ある漫画',
    fetchBackend: 'html_requests',
    checkIntervalMinutes: 10,
    paused: false,
    lastChecked: 1700000000,
    lastChanged: null,
    hasError: false,
    lastError: null,
    includeFilters: ['//*[@id="episodes"]'],
    subtractedFilters: [],
    notificationTopic: 'dryeyes',
  };

  const renderCard = () =>
    render(
      <WatchCard
        watch={watch}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onReviewRedirect={vi.fn()}
      />
    );

  afterEach(() => {
    cleanup();
    // 取得結果はモジュール側で覚えているので、テスト間に持ち越さない
    forgetCardImage(watch.id);
    vi.restoreAllMocks();
  });

  it('絵が取れたらカードの背景に敷き、右へ向かってはっきりさせる', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card-image');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(api, 'getCardImageBlob').mockResolvedValue(new Blob(['x'], { type: 'image/png' }));

    const { container } = renderCard();

    const layer = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[style*="blob:card-image"]');
      expect(found).not.toBeNull();
      return found!;
    });

    // 左端は完全に透明、右端がいちばんはっきり見える
    expect(layer.style.maskImage).toContain('to right');
    expect(layer.style.maskImage).toContain('transparent 42%');
    expect(layer.style.maskImage).toMatch(/rgb\(0, 0, 0\) 100%\)$/);

    // 絵の上でも操作メニューが読めるよう、下敷きが付く
    expect(screen.getByLabelText('操作メニュー').className).toContain('backdrop-blur-sm');
  });

  it('絵が決められなかった監視は、これまでどおりの見た目のまま', async () => {
    vi.spyOn(api, 'getCardImageBlob').mockResolvedValue(null);

    const { container } = renderCard();

    await waitFor(() => expect(api.getCardImageBlob).toHaveBeenCalledWith(watch.id));

    expect(container.querySelector('[style*="background-image"]')).toBeNull();
    expect(screen.getByLabelText('操作メニュー').className).not.toContain('backdrop-blur-sm');
  });
});

// 取得中にカードが消えても結果を捨てない。捨てていたころは StrictMode の二重実行や
// 一覧の自動更新のたびに取り直しになり、監視が多いと後ろのカードが延々と絵なしのままだった。
describe('取得結果の共有', () => {
  const watch: WatchModel = {
    id: 'shared-1',
    url: 'https://example.com/works/7',
    title: '共有テスト',
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

  const card = () => (
    <WatchCard
      watch={watch}
      onTriggerCheck={vi.fn()}
      onTogglePause={vi.fn()}
      onOpenDiff={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onCopyTo={vi.fn()}
      onReviewRedirect={vi.fn()}
    />
  );

  afterEach(() => {
    cleanup();
    forgetCardImage(watch.id);
    vi.restoreAllMocks();
  });

  it('取得中に外して付け直しても、取りに行くのは 1 回だけ', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    let finish: (blob: Blob) => void = () => undefined;
    const fetching = new Promise<Blob>((resolve) => {
      finish = resolve;
    });
    const spy = vi.spyOn(api, 'getCardImageBlob').mockReturnValue(fetching as Promise<Blob | null>);

    // 取得が終わらないうちにカードを外し、あらためて付け直す
    const first = render(card());
    first.unmount();
    const second = render(card());

    finish(new Blob(['x'], { type: 'image/png' }));

    await waitFor(() =>
      expect(second.container.querySelector('[style*="blob:shared"]')).not.toBeNull()
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
