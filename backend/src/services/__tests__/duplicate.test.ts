import { describe, it, expect } from 'vitest';
import { duplicateKey, findDuplicateWatch, DuplicateLookupDeps } from '../duplicate.js';
import { WatchModel } from '../../types/index.js';

const watch = (id: string, url: string): WatchModel => ({
  id,
  url,
  title: `watch ${id}`,
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 180,
  paused: false,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters: [],
  subtractedFilters: [],
  notificationTopic: '',
  snapshotCount: 0,
});

const noRedirects: DuplicateLookupDeps = {
  pendingRedirectUrlOf: () => null,
  isAllowedRedirect: () => false,
};

describe('duplicateKey', () => {
  it('https 化・www・末尾スラッシュ・フラグメントの違いは同じページとして扱う', () => {
    const key = duplicateKey('https://example.com/manga/abc');
    expect(duplicateKey('http://www.example.com/manga/abc/')).toBe(key);
    expect(duplicateKey('https://example.com/manga/abc#chapter-3')).toBe(key);
    expect(duplicateKey('  https://example.com/manga/abc  ')).toBe(key);
  });

  it('クエリが違えば別ページ', () => {
    expect(duplicateKey('https://example.com/list?page=1')).not.toBe(
      duplicateKey('https://example.com/list?page=2')
    );
  });

  it('URL として読めないもの・http(s) 以外は鍵を作らない', () => {
    expect(duplicateKey('example.com/manga')).toBeNull();
    expect(duplicateKey('ftp://example.com/x')).toBeNull();
    expect(duplicateKey('')).toBeNull();
  });
});

describe('findDuplicateWatch', () => {
  const watches = [
    watch('a', 'https://example.com/manga/abc'),
    watch('b', 'https://old.example/manga/xyz'),
  ];

  it('同じ URL の監視を見つける（表記ゆれを含む）', () => {
    const match = findDuplicateWatch('http://www.example.com/manga/abc/', watches, noRedirects);
    expect(match).toEqual({ watch: watches[0], reason: 'same' });
  });

  it('見ているページが違えば何も返さない', () => {
    expect(findDuplicateWatch('https://example.com/manga/def', watches, noRedirects)).toBeNull();
    expect(findDuplicateWatch('not a url', watches, noRedirects)).toBeNull();
  });

  it('移転の提案先が一致する監視は重複として扱う', () => {
    const match = findDuplicateWatch('https://new.example/manga/xyz', watches, {
      ...noRedirects,
      pendingRedirectUrlOf: (id) => (id === 'b' ? 'https://new.example/manga/xyz' : null),
    });
    expect(match).toEqual({ watch: watches[1], reason: 'redirect' });
  });

  it('承認済みの転送で結ばれた同じパスは、どちら向きでも重複として扱う', () => {
    const allowed: DuplicateLookupDeps = {
      ...noRedirects,
      isAllowedRedirect: (from, to) =>
        new URL(from).hostname === 'old.example' && new URL(to).hostname === 'new.example',
    };
    // 登録済みが old.example、これから登録するのが new.example
    expect(findDuplicateWatch('https://new.example/manga/xyz', watches, allowed)).toEqual({
      watch: watches[1],
      reason: 'redirect',
    });
    // 逆向き（登録済みが new.example 側）でも同じ組として見る
    const reversed = [watch('c', 'https://new.example/manga/xyz')];
    expect(findDuplicateWatch('https://old.example/manga/xyz', reversed, allowed)).toEqual({
      watch: reversed[0],
      reason: 'redirect',
    });
    // 承認済みでもパスが違えば別ページ
    expect(findDuplicateWatch('https://new.example/manga/other', watches, allowed)).toBeNull();
  });

  it('同じ URL の監視があれば、移転経由より優先する', () => {
    const both = [watch('old', 'https://old.example/p'), watch('new', 'https://new.example/p')];
    const match = findDuplicateWatch('https://new.example/p', both, {
      ...noRedirects,
      isAllowedRedirect: () => true,
    });
    expect(match).toEqual({ watch: both[1], reason: 'same' });
  });
});
