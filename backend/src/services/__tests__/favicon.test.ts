import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

const { getFavicon, extractIconHrefs, resetFaviconCache } = await import('../favicon.js');

const html = (body: string) => ({ data: body, headers: { 'content-type': 'text/html' } });
const png = (bytes = [1, 2, 3]) => ({
  data: Buffer.from(bytes),
  headers: { 'content-type': 'image/png' },
});

describe('extractIconHrefs', () => {
  it('collects icon links and leaves apple-touch-icon last', () => {
    const hrefs = extractIconHrefs(`
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="stylesheet" href="/site.css">
      <link rel="shortcut icon" href="/legacy.ico">
      <link rel='icon' type='image/svg+xml' href='/icon.svg'>
    `);

    expect(hrefs).toEqual(['/legacy.ico', '/icon.svg', '/apple.png']);
  });

  it('ignores links without an icon rel', () => {
    expect(extractIconHrefs('<link rel="canonical" href="/x">')).toEqual([]);
  });
});

describe('getFavicon', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFaviconCache();
  });

  it('uses the icon declared in the page, resolved against the page URL', async () => {
    (axios.get as any)
      .mockResolvedValueOnce(html('<link rel="icon" href="/assets/icon.png">'))
      .mockResolvedValueOnce(png());

    const asset = await getFavicon('https://example.com/manga/1');

    expect(asset).toEqual({ contentType: 'image/png', data: Buffer.from([1, 2, 3]) });
    expect((axios.get as any).mock.calls[1][0]).toBe('https://example.com/assets/icon.png');
  });

  it('falls back to /favicon.ico when the page declares no icon', async () => {
    (axios.get as any)
      .mockResolvedValueOnce(html('<html><head><title>no icon</title></head></html>'))
      .mockResolvedValueOnce({
        data: Buffer.from([9]),
        headers: { 'content-type': 'application/octet-stream' },
      });

    const asset = await getFavicon('https://example.com/page');

    expect((axios.get as any).mock.calls[1][0]).toBe('https://example.com/favicon.ico');
    expect(asset?.contentType).toBe('application/octet-stream');
  });

  it('still tries /favicon.ico when the page itself cannot be fetched', async () => {
    (axios.get as any)
      .mockRejectedValueOnce(new Error('403 Forbidden'))
      .mockResolvedValueOnce(png());

    const asset = await getFavicon('https://example.com/page');

    expect((axios.get as any).mock.calls[1][0]).toBe('https://example.com/favicon.ico');
    expect(asset?.contentType).toBe('image/png');
  });

  it('rejects a 404 HTML page served as the icon', async () => {
    (axios.get as any)
      .mockResolvedValueOnce(html('<html></html>'))
      .mockResolvedValueOnce(html('<h1>Not Found</h1>'));

    expect(await getFavicon('https://example.com/page')).toBeNull();
  });

  it('serves later requests for the same origin from the cache', async () => {
    (axios.get as any)
      .mockResolvedValueOnce(html('<link rel="icon" href="/icon.png">'))
      .mockResolvedValueOnce(png());

    await getFavicon('https://example.com/a');
    const second = await getFavicon('https://example.com/b');

    expect(second?.contentType).toBe('image/png');
    expect((axios.get as any)).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request between simultaneous callers', async () => {
    (axios.get as any)
      .mockResolvedValueOnce(html('<link rel="icon" href="/icon.png">'))
      .mockResolvedValueOnce(png());

    const [a, b] = await Promise.all([
      getFavicon('https://example.com/a'),
      getFavicon('https://example.com/b'),
    ]);

    expect(a).toBe(b);
    expect((axios.get as any)).toHaveBeenCalledTimes(2);
  });

  it('ignores URLs that are not http(s)', async () => {
    expect(await getFavicon('ftp://example.com/x')).toBeNull();
    expect(await getFavicon('not a url')).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });
});
