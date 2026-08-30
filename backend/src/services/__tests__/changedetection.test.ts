import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChangedetectionClient } from '../changedetection.js';
import axios from 'axios';

vi.mock('axios');

describe('ChangedetectionClient', () => {
  let client: ChangedetectionClient;
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (axios.create as any).mockReturnValue(mockAxiosInstance);
    client = new ChangedetectionClient();
  });

  it('should list watches and transform them correctly', async () => {
    const rawApiData = {
      'uuid-1': {
        url: 'https://example.com/item/1',
        title: 'Example Item',
        fetch_backend: 'html_requests',
        time_between_check: { minutes: 15 },
        paused: false,
        last_checked: 1700000000,
        last_changed: 1700000000,
        include_filters: '#price\n.stock',
        notification_urls: ['http://localhost:8085/my-topic'],
      },
    };

    mockAxiosInstance.get.mockResolvedValueOnce({ data: rawApiData });

    const result = await client.listWatches();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'uuid-1',
      url: 'https://example.com/item/1',
      title: 'Example Item',
      fetchBackend: 'html_requests',
      checkIntervalMinutes: 15,
      paused: false,
      lastChecked: 1700000000,
      lastChanged: 1700000000,
      hasError: false,
      lastError: null,
      includeFilters: ['#price', '.stock'],
      subtractedFilters: [],
      notificationTopic: 'my-topic',
      tag: '',
    });
  });

  it('should format creation payload with ntfy notification and interval', async () => {
    mockAxiosInstance.post.mockResolvedValueOnce({ data: { uuid: 'new-uuid' } });
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        url: 'https://example.com',
        title: 'My Watch',
        fetch_backend: 'html_playwright',
        time_between_check: { minutes: 30 },
      },
    });

    const created = await client.createWatch({
      url: 'https://example.com',
      title: 'My Watch',
      fetchBackend: 'html_playwright',
      checkIntervalMinutes: 30,
      notificationTopic: 'alerts',
      includeFilters: ['.main-content'],
      subtractedFilters: ['.footer'],
    });

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v1/watch', expect.objectContaining({
      url: 'https://example.com',
      title: 'My Watch',
      fetch_backend: 'html_playwright',
      notification_urls: ['http://localhost:8085/alerts'],
      time_between_check: { minutes: 30 },
      include_filters: '.main-content',
      subtracted_filters: '.footer',
    }));

    expect(created.id).toBe('new-uuid');
  });

  it('should fetch watch history and sort chronologically descending', async () => {
    mockAxiosInstance.get.mockResolvedValueOnce({
      data: {
        '1700000000': 'snap-1',
        '1700005000': 'snap-2',
        '1699999000': 'snap-0',
      },
    });

    const history = await client.getHistory('uuid-1');

    expect(history).toEqual([
      { timestamp: 1700005000, snapshotId: 'snap-2' },
      { timestamp: 1700000000, snapshotId: 'snap-1' },
      { timestamp: 1699999000, snapshotId: 'snap-0' },
    ]);
  });
});
