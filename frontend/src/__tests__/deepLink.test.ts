// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { takePendingWatchId } from '../deepLink';

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
