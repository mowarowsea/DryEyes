// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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
        onChangeImage={vi.fn()}
        onOpenHistory={vi.fn()}
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
    vi.spyOn(api, 'getCardImage').mockResolvedValue({
      blob: new Blob(['x'], { type: 'image/png' }),
      crop: null,
    });

    const { container } = renderCard();

    const layer = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[style*="blob:card-image"]');
      expect(found).not.toBeNull();
      return found!;
    });

    // 絵はカードの右側だけに敷く。全幅の箱に cover で敷くと拡大率が上がりすぎて、
    // 縦長の表紙だと真ん中の細い帯しか出てこない。
    expect(layer.style.width).toBe('58%');
    expect(layer.className).toContain('right-0');
    expect(layer.className).toContain('bg-cover');

    // レイヤーの左端は完全に透明、右端がいちばんはっきり見える
    expect(layer.style.maskImage).toContain('to right');
    expect(layer.style.maskImage).toContain('transparent 0%');
    expect(layer.style.maskImage).toMatch(/rgb\(0, 0, 0\) 100%\)$/);

    // 絵の上でも操作メニューが読めるよう、下敷きが付く
    expect(screen.getByLabelText('操作メニュー').className).toContain('backdrop-blur-sm');
  });

  it('絵が決められなかった監視は、これまでどおりの見た目のまま', async () => {
    vi.spyOn(api, 'getCardImage').mockResolvedValue(null);

    const { container } = renderCard();

    await waitFor(() => expect(api.getCardImage).toHaveBeenCalledWith(watch.id));

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
      onChangeImage={vi.fn()}
      onOpenHistory={vi.fn()}
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

    let finish: (image: { blob: Blob; crop: null }) => void = () => undefined;
    const fetching = new Promise<{ blob: Blob; crop: null }>((resolve) => {
      finish = resolve;
    });
    const spy = vi
      .spyOn(api, 'getCardImage')
      .mockReturnValue(fetching as ReturnType<typeof api.getCardImage>);

    // 取得が終わらないうちにカードを外し、あらためて付け直す
    const first = render(card());
    first.unmount();
    const second = render(card());

    finish({ blob: new Blob(['x'], { type: 'image/png' }), crop: null });

    await waitFor(() =>
      expect(second.container.querySelector('[style*="blob:shared"]')).not.toBeNull()
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// 背景の絵はアカウント画面で切れる。切っているあいだは取りにも行かない
// （BFF がページを開きに行くのは、絵を出す人の分だけで足りる）。
describe('背景を切っているとき', () => {
  const watch: WatchModel = {
    id: 'hidden-1',
    url: 'https://example.com/works/9',
    title: '背景オフ',
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

  afterEach(() => {
    cleanup();
    forgetCardImage(watch.id);
    vi.restoreAllMocks();
  });

  it('絵を取りに行かず、カードも従来どおりの見た目のまま', async () => {
    const spy = vi.spyOn(api, 'getCardImage').mockResolvedValue({
      blob: new Blob(['x'], { type: 'image/png' }),
      crop: null,
    });

    const { container } = render(
      <WatchCard
        watch={watch}
        showImage={false}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onReviewRedirect={vi.fn()}
        onChangeImage={vi.fn()}
        onOpenHistory={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('背景オフ')).toBeInTheDocument());

    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('[style*="background-image"]')).toBeNull();
    expect(screen.getByLabelText('操作メニュー').className).not.toContain('backdrop-blur-sm');
  });
});

// 切り抜きを指定した監視は、割合で持っている指定をカードの箱の実寸へ戻して敷く。
// ここがずれると、選んだ範囲と実際に出る範囲が食い違う。
describe('切り抜きの指定があるとき', () => {
  const watch: WatchModel = {
    id: 'cropped-1',
    url: 'https://example.com/works/3',
    title: '切り抜きあり',
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

  // jsdom はレイアウトしないので、絵を敷く箱の大きさを測れない。
  // 実寸へ戻す計算を確かめたいので、ここだけ大きさを持たせる。
  const withBoxSize = (width: number, height: number) => {
    const original = {
      width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
      height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: height });
    return () => {
      if (original.width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original.width);
      if (original.height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original.height);
    };
  };

  afterEach(() => {
    cleanup();
    forgetCardImage(watch.id);
    vi.restoreAllMocks();
  });

  it('割合で受け取った切り抜きを、箱の実寸に合わせて敷く', async () => {
    const restore = withBoxSize(400, 60);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cropped');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(api, 'getCardImage').mockResolvedValue({
      blob: new Blob(['x'], { type: 'image/png' }),
      // 縦長 (0.5) の絵の、上から 2 割だけを敷く
      crop: { x: 0, y: 0, width: 1, height: 0.2, ratio: 0.5 },
    });

    try {
      const { container } = render(
        <WatchCard
          watch={watch}
          onTriggerCheck={vi.fn()}
          onTogglePause={vi.fn()}
          onOpenDiff={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onCopyTo={vi.fn()}
          onReviewRedirect={vi.fn()}
          onChangeImage={vi.fn()}
          onOpenHistory={vi.fn()}
        />
      );

      const layer = await waitFor(() => {
        const found = container.querySelector<HTMLElement>('[style*="blob:cropped"]');
        expect(found?.style.backgroundSize).toBeTruthy();
        return found!;
      });

      // 幅 400 の箱を覆う倍率まで拡大し、選んだ帯の中心を箱の中心に合わせる
      expect(layer.style.backgroundSize).toBe('400px 800px');
      expect(layer.style.backgroundPosition).toBe('0px -50px');
    } finally {
      restore();
    }
  });
});

// 背景の絵は機械の推測なので、当たらなかったときに選び直せる入口が要る。
describe('背景画像を変更のメニュー', () => {
  const watch: WatchModel = {
    id: 'menu-1',
    url: 'https://example.com/works/5',
    title: 'メニュー',
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

  const renderCard = (showImage: boolean, onChangeImage = vi.fn()) => {
    render(
      <WatchCard
        watch={watch}
        showImage={showImage}
        onTriggerCheck={vi.fn()}
        onTogglePause={vi.fn()}
        onOpenDiff={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopyTo={vi.fn()}
        onReviewRedirect={vi.fn()}
        onChangeImage={onChangeImage}
        onOpenHistory={vi.fn()}
      />
    );
    return onChangeImage;
  };

  afterEach(() => {
    cleanup();
    forgetCardImage(watch.id);
    vi.restoreAllMocks();
  });

  it('メニューから選び直せる', async () => {
    vi.spyOn(api, 'getCardImage').mockResolvedValue(null);
    const onChangeImage = renderCard(true);

    fireEvent.click(screen.getByLabelText('操作メニュー'));
    fireEvent.click(screen.getByText('背景画像を変更'));

    expect(onChangeImage).toHaveBeenCalledWith(watch);
  });

  it('絵を出さない設定のときは出さない（変えても見えないため）', async () => {
    renderCard(false);

    fireEvent.click(screen.getByLabelText('操作メニュー'));
    expect(screen.queryByText('背景画像を変更')).toBeNull();
  });
});
