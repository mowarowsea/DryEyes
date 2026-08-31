import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProxyPage } from '../proxy.js';
import axios from 'axios';

vi.mock('axios');

describe('fetchProxyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should inject <base> tag and inspector script into HTML', async () => {
    const rawHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/item/1');

    expect(axios.get).toHaveBeenCalledWith('https://example.com/item/1', expect.any(Object));
    expect(result).toContain('<base href="https://example.com/item/1">');
    expect(result).toContain('DRYEYES_ELEMENT_SELECTED');
    expect(result).toContain('dryeyes-inspect-hover');
  });

  it('should inject the inspector into <head> before the page own scripts', async () => {
    const rawHtml = `<!DOCTYPE html><html><head><script src="/app.js"></script></head><body><a href="/next">Next</a></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/');

    // ページ自身のスクリプトより先に読み込まれないと、リンクの遷移を先回りで止められない
    expect(result.indexOf('DRYEYES_ELEMENT_SELECTED')).toBeLessThan(result.indexOf('/app.js'));
    expect(result.indexOf('DRYEYES_ELEMENT_SELECTED')).toBeLessThan(result.indexOf('<body>'));
  });

  it('should block navigation triggered by links and forms', async () => {
    const rawHtml = `<html><head></head><body></body></html>`;
    (axios.get as any).mockResolvedValueOnce({ data: rawHtml });

    const result = await fetchProxyPage('https://example.com/');

    expect(result).toContain('stopImmediatePropagation');
    expect(result).toContain("'submit'");
    expect(result).toContain('history.pushState');
  });
});
