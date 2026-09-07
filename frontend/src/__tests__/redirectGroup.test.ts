import { describe, it, expect } from 'vitest';
import { redirectPairKey, similarRedirectWatches } from '../redirectGroup';
import { RedirectProposal, WatchModel } from '../types';

const proposal = (fromUrl: string, toUrl: string): RedirectProposal => ({
  fromUrl,
  toUrl,
  chain: [fromUrl, toUrl],
  status: 301,
  permanent: true,
  hostChanged: true,
  detectedAt: '2026-09-07T00:00:00.000Z',
  selectorFound: true,
  toTitle: null,
});

const watchOf = (id: string, pendingRedirect: RedirectProposal | null): WatchModel => ({
  id,
  url: 'https://old.example/' + id,
  title: id,
  fetchBackend: 'html_requests',
  checkIntervalMinutes: 60,
  paused: false,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: 'dryeyes',
  pendingRedirect,
});

describe('redirectGroup', () => {
  it('keys a move on the from/to hosts, ignoring path and www', () => {
    expect(redirectPairKey(proposal('https://www.old.example/a?x=1', 'https://new.example/b'))).toBe(
      'old.example -> new.example'
    );
    expect(redirectPairKey(proposal('not a url', 'https://new.example/b'))).toBeNull();
  });

  it('collects the other watches waiting on the same move', () => {
    const target = watchOf('one', proposal('https://old.example/one', 'https://new.example/one'));
    const watches = [
      target,
      watchOf('two', proposal('https://old.example/two', 'https://www.new.example/two')),
      // 転送元が違う移転は別物
      watchOf('other-from', proposal('https://another.example/x', 'https://new.example/x')),
      // 転送先が違う移転も別物
      watchOf('other-to', proposal('https://old.example/y', 'https://parking.example/y')),
      // 確認待ちでない監視は数えない
      watchOf('settled', null),
      watchOf('three', proposal('https://old.example/three', 'https://new.example/three')),
    ];

    expect(similarRedirectWatches(watches, target).map((w) => w.id)).toEqual(['two', 'three']);
  });

  it('finds nothing for a watch without a proposal', () => {
    const watches = [watchOf('one', proposal('https://old.example/one', 'https://new.example/one'))];
    expect(similarRedirectWatches(watches, watchOf('none', null))).toEqual([]);
  });
});
