import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

// config は読み込み時に環境変数を解決するため、import より先に通知タップ先を固定する
// （既定値はマシンの LAN IP になるのでテストで固定できない）
process.env.APP_BASE_URL = 'http://192.168.0.10:3010';
const { ChangedetectionClient, NOTIFICATION_TITLE, NOTIFICATION_BODY, NOTIFICATION_FORMAT } =
  await import('../changedetection.js');

const CLICK = 'click=http%3A%2F%2F192.168.0.10%3A3010%2F%3Fwatch%3D{{watch_uuid}}';

describe('ChangedetectionClient', () => {
  let client: InstanceType<typeof ChangedetectionClient>;
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
        fetch_backend: 'html_webdriver',
        time_between_check: { minutes: 30 },
      },
    });

    const created = await client.createWatch({
      url: 'https://example.com',
      title: 'My Watch',
      fetchBackend: 'html_webdriver',
      checkIntervalMinutes: 30,
      notificationTopic: 'alerts',
      includeFilters: ['.main-content'],
      subtractedFilters: ['.footer'],
    }, 'dryeyes-alice-aaaaaa');

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v1/watch', expect.objectContaining({
      url: 'https://example.com',
      title: 'My Watch',
      fetch_backend: 'html_webdriver',
      notification_urls: [`ntfy://host.docker.internal:8085/dryeyes-alice-aaaaaa-alerts?${CLICK}`],
      notification_title: NOTIFICATION_TITLE,
      notification_body: NOTIFICATION_BODY,
      notification_format: NOTIFICATION_FORMAT,
      time_between_check: { minutes: 30 },
      include_filters: ['.main-content'],
      subtracted_filters: ['.footer'],
    }));

    // 差分をそのまま載せると ntfy 側で弾かれるため、本文は必ず切り詰めた平文にする
    expect(NOTIFICATION_BODY).toContain('truncate(');
    expect(NOTIFICATION_FORMAT).toBe('text');

    expect(created.id).toBe('new-uuid');
  });

  it('should sync click url and notification template without touching their topic', async () => {
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { 'uuid-1': {}, 'uuid-2': {} } })
      .mockResolvedValueOnce({
        data: { notification_urls: ['ntfy://host.docker.internal:8085/topic-a'] },
      })
      // click もテンプレートも現行のものになっている監視は更新しない
      .mockResolvedValueOnce({
        data: {
          notification_urls: [`ntfy://host.docker.internal:8085/topic-b?${CLICK}`],
          notification_title: NOTIFICATION_TITLE,
          notification_body: NOTIFICATION_BODY,
          notification_format: NOTIFICATION_FORMAT,
        },
      });

    const updated = await client.syncNotificationSettings(
      'http://192.168.0.10:3010/?watch={{watch_uuid}}'
    );

    expect(updated).toBe(1);
    expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.put).toHaveBeenCalledWith('/api/v1/watch/uuid-1', {
      notification_urls: [`ntfy://host.docker.internal:8085/topic-a?${CLICK}`],
      notification_title: NOTIFICATION_TITLE,
      notification_body: NOTIFICATION_BODY,
      notification_format: NOTIFICATION_FORMAT,
    });
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
