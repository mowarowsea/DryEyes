// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { takePendingWatchId, takeCreateIntent } from '../deepLink';

const go = (url: string) => window.history.replaceState({}, '', url);

beforeEach(() => {
  go('/');
});

describe('takePendingWatchId', () => {
  it('should pick up the watch id from a notification link', () => {
    go('/?watch=uuid-1');

    expect(takePendingWatchId()).toBe('uuid-1');
  });

  it('should strip the parameter so a reload does not reopen the diff', () => {
    go('/?watch=uuid-1');
    takePendingWatchId();

    expect(window.location.search).toBe('');
    expect(takePendingWatchId()).toBeNull();
  });

  it('should keep other query parameters', () => {
    go('/?watch=uuid-1&tab=changed');
    takePendingWatchId();

    expect(window.location.search).toBe('?tab=changed');
  });

  it('should return null when opened normally', () => {
    expect(takePendingWatchId()).toBeNull();
  });
});

describe('takeCreateIntent', () => {
  it('should pick up a URL shared from the share sheet', () => {
    go('/?shared=' + encodeURIComponent('https://example.com/comics/1'));

    expect(takeCreateIntent()).toEqual({ url: 'https://example.com/comics/1' });
  });

  it('should dig the URL out of the shared text (Android)', () => {
    go('/?text=' + encodeURIComponent('第123話 https://example.com/comics/1 が更新'));

    expect(takeCreateIntent()).toEqual({ url: 'https://example.com/comics/1' });
  });

  it('should report the shortcut launch even without a URL', () => {
    go('/?add=1');

    expect(takeCreateIntent()).toEqual({ url: null });
  });

  it('should strip the shared parameters so a reload does not reopen the form', () => {
    go('/?shared=' + encodeURIComponent('https://example.com/') + '&title=hello&tab=changed');
    takeCreateIntent();

    expect(window.location.search).toBe('?tab=changed');
    expect(takeCreateIntent()).toBeNull();
  });

  it('should return null when opened normally', () => {
    expect(takeCreateIntent()).toBeNull();
  });
});
