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
});
