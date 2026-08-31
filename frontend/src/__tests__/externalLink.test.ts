// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { externalLinkProps } from '../externalLink';

// jsdom には matchMedia が無いので、テストごとに生やして片付ける
const setMatchMedia = (standalone: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) =>
      ({ matches: query === '(display-mode: standalone)' && standalone }) as MediaQueryList,
  });
};

const asAndroidPwa = (standalone: boolean) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
  );
  setMatchMedia(standalone);
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('externalLinkProps', () => {
  it('hands the URL to Android so the default browser opens it', () => {
    asAndroidPwa(true);

    const props = externalLinkProps('https://example.com/comics/123?page=2');

    expect(props.href).toBe(
      'intent://example.com/comics/123?page=2#Intent;scheme=https;action=android.intent.action.VIEW;' +
        'S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fcomics%2F123%3Fpage%3D2;end'
    );
    // intent は同じタブで開く（_blank だと空のタブが残る）
    expect(props.target).toBeUndefined();
  });

  it('keeps a plain link when the app runs in a browser tab', () => {
    asAndroidPwa(false);

    expect(externalLinkProps('https://example.com/')).toEqual({
      href: 'https://example.com/',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  });

  it('keeps a plain link outside Android', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36'
    );

    expect(externalLinkProps('https://example.com/').target).toBe('_blank');
  });

  it('keeps a plain link when the URL has a fragment, which an intent URI cannot carry', () => {
    asAndroidPwa(true);

    expect(externalLinkProps('https://example.com/doc#section-3').target).toBe('_blank');
  });
})
