import { describe, it, expect } from 'vitest';
import {
  assertSafeRedirectTarget,
  baseHost,
  hostChanged,
  isPrivateAddress,
  isTrivialRedirect,
  normalizeForCompare,
} from '../urlSafety.js';

describe('isTrivialRedirect', () => {
  it('should follow https upgrades, www and trailing slash without asking', () => {
    expect(isTrivialRedirect('http://example.com/watch', 'https://example.com/watch')).toBe(true);
    expect(isTrivialRedirect('https://example.com/watch', 'https://www.example.com/watch')).toBe(true);
    expect(isTrivialRedirect('https://www.example.com/watch', 'https://example.com/watch')).toBe(true);
    expect(isTrivialRedirect('https://example.com/watch', 'https://example.com/watch/')).toBe(true);
  });

  it('should not silently downgrade https to http', () => {
    // 中身が同じページでも、暗号化を落とす移動は黙って追わない
    expect(isTrivialRedirect('https://example.com/watch', 'http://example.com/watch')).toBe(false);
  });

  it('should ask before following a different site', () => {
    expect(isTrivialRedirect('https://example.com/watch', 'https://example.other/watch')).toBe(false);
    // サブドメインが変わるものは別サイト扱い。www だけを例外にする。
    expect(isTrivialRedirect('https://example.com/watch', 'https://shop.example.com/watch')).toBe(false);
    expect(isTrivialRedirect('https://example.com/watch', 'https://example.com/moved')).toBe(false);
  });

  it('should ask before following a URL that gained a query string', () => {
    // セッションやトラッキングが付いた URL を掴むと、次のチェックで期限切れになる
    expect(isTrivialRedirect('https://example.com/watch', 'https://example.com/watch?sid=abc')).toBe(
      false
    );
  });

  it('should not throw on malformed URLs', () => {
    expect(isTrivialRedirect('not a url', 'https://example.com/')).toBe(false);
  });
});

describe('normalizeForCompare', () => {
  it('should ignore scheme, www and trailing slash but keep query and hash', () => {
    expect(normalizeForCompare('https://www.example.com/a/')).toBe('example.com/a');
    expect(normalizeForCompare('http://example.com/a')).toBe('example.com/a');
    expect(normalizeForCompare('https://example.com/a?b=1#c')).toBe('example.com/a?b=1#c');
  });
});

describe('hostChanged', () => {
  it('should treat the www prefix as the same host', () => {
    expect(hostChanged('https://example.com/a', 'https://www.example.com/b')).toBe(false);
    expect(hostChanged('https://example.com/a', 'https://example.other/a')).toBe(true);
    expect(hostChanged('https://example.com/a', 'https://shop.example.com/a')).toBe(true);
  });

  it('should treat an unparsable URL as a host change (safer side)', () => {
    expect(hostChanged('https://example.com/a', 'garbage')).toBe(true);
  });
});

describe('baseHost', () => {
  it('should drop only the leading www and lowercase the host', () => {
    expect(baseHost('WWW.Example.COM')).toBe('example.com');
    expect(baseHost('shop.example.com')).toBe('shop.example.com');
    // www を含んでいても先頭でなければ落とさない
    expect(baseHost('a.www.example.com')).toBe('a.www.example.com');
  });
});

describe('isPrivateAddress', () => {
  it('should recognise internal IPv4 ranges', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('192.168.0.5')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true); // クラウドのメタデータ
    expect(isPrivateAddress('100.64.0.1')).toBe(true); // CGNAT / Tailscale
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false); // 172.16/12 の外側
  });

  it('should recognise internal IPv6 ranges', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });
});

describe('assertSafeRedirectTarget', () => {
  it('should refuse non-http(s) schemes', async () => {
    await expect(assertSafeRedirectTarget('ftp://example.com/a')).rejects.toThrow();
    await expect(assertSafeRedirectTarget('file:///etc/passwd')).rejects.toThrow();
  });

  it('should refuse hosts that point inside the network', async () => {
    // 名前解決を待たずに弾けるものだけを見る（DNS に触らないテスト）
    await expect(assertSafeRedirectTarget('http://localhost:5000/a')).rejects.toThrow();
    await expect(assertSafeRedirectTarget('http://changedetection.internal/a')).rejects.toThrow();
    await expect(assertSafeRedirectTarget('http://127.0.0.1/a')).rejects.toThrow();
    await expect(assertSafeRedirectTarget('http://192.168.0.5/a')).rejects.toThrow();
    await expect(assertSafeRedirectTarget('http://[::1]/a')).rejects.toThrow();
  });

  it('should refuse a URL it cannot parse', async () => {
    await expect(assertSafeRedirectTarget('not a url')).rejects.toThrow();
  });
});
