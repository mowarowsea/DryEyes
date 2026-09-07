import { describe, it, expect } from 'vitest';
import { suggestSiteTemplate } from '../siteTemplate';
import { WatchModel } from '../types';

const watch = (
  id: string,
  url: string,
  includeFilters: string[] = [],
  subtractedFilters: string[] = []
): WatchModel => ({
  id,
  url,
  title: id,
  fetchBackend: 'html_webdriver',
  checkIntervalMinutes: 180,
  paused: false,
  lastChecked: null,
  lastChanged: null,
  hasError: false,
  lastError: null,
  includeFilters,
  subtractedFilters,
  notificationTopic: '',
});

const LIST = '//*[@id="list"]/li/a';

describe('suggestSiteTemplate', () => {
  it('同じサイトで最も多く使われている監視場所を、使っている数と一緒に返す', () => {
    const template = suggestSiteTemplate('https://example.com/manga/new', [
      watch('a', 'https://example.com/manga/a', [LIST]),
      watch('b', 'https://example.com/manga/b', [LIST]),
      watch('c', 'https://example.com/manga/c', ['//h1']),
    ]);

    expect(template).toEqual({
      host: 'example.com',
      includeFilters: [LIST],
      subtractedFilters: [],
      count: 2,
    });
  });

  it('www. の有無は同じサイトとして扱う', () => {
    const template = suggestSiteTemplate('https://www.example.com/x', [
      watch('a', 'https://example.com/a', [LIST]),
    ]);
    expect(template?.count).toBe(1);
  });

  it('別のサイトや、ページ全体を見ている監視は候補にしない', () => {
    expect(
      suggestSiteTemplate('https://example.com/x', [
        watch('a', 'https://other.example/a', [LIST]),
        watch('b', 'https://shop.example.com/b', [LIST]),
        watch('c', 'https://example.com/c'),
      ])
    ).toBeNull();
  });

  it('除外は、同じ場所を見ている監視の中で最も多い組み合わせに揃える', () => {
    const template = suggestSiteTemplate('https://example.com/x', [
      watch('a', 'https://example.com/a', [LIST], ['.ad']),
      watch('b', 'https://example.com/b', [LIST], ['.ad']),
      watch('c', 'https://example.com/c', [LIST]),
      // 別の場所を見ている監視の除外は関係ない
      watch('d', 'https://example.com/d', ['//h1'], ['.footer']),
    ]);

    expect(template?.subtractedFilters).toEqual(['.ad']);
    expect(template?.count).toBe(3);
  });

  it('URL として読めなければ何も返さない', () => {
    expect(suggestSiteTemplate('example.com/x', [watch('a', 'https://example.com/a', [LIST])])).toBeNull();
    expect(suggestSiteTemplate('', [])).toBeNull();
  });
});
