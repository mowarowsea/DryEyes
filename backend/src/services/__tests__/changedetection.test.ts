import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { LAZY_LOAD_SCROLL_JS } from '../lazyLoadScroll.js';

vi.mock('axios');

// config は読み込み時に環境変数を解決するため、import より先に通知タップ先を固定する
// （既定値はマシンの LAN IP になるのでテストで固定できない）
process.env.APP_BASE_URL = 'http://192.168.0.10:3010';
const { ChangedetectionClient, NOTIFICATION_TITLE, NOTIFICATION_BODY, NOTIFICATION_FORMAT } =
  await import('../changedetection.js');

const CLICK = 'click=http%3A%2F%2F192.168.0.10%3A3010%2F%3Fwatch%3D{{watch_uuid}}';
const AVATAR =
  'avatar_url=http%3A%2F%2F192.168.0.10%3A3010%2Fapi%2Fpublic%2Fwatches%2F{{watch_uuid}}%2Ffavicon';

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

  it('should list watches from their details so paused and interval are correct', async () => {
    // 一覧 API は paused / time_between_check / フィルタを返さないため、監視ごとの詳細を引く
    mockAxiosInstance.get
      .mockResolvedValueOnce({
        data: {
          'uuid-1': { url: 'https://example.com/item/1', title: 'Example Item', last_error: false },
        },
      })
      .mockResolvedValueOnce({
        data: {
          url: 'https://example.com/item/1',
          title: 'Example Item',
          fetch_backend: 'html_requests',
          time_between_check: { minutes: 15 },
          paused: true,
          last_checked: 1700000000,
          last_changed: 1700000000,
          include_filters: ['#price', '.stock'],
          subtractive_selectors: ['.ads'],
          history_n: 4,
          notification_urls: ['http://localhost:8085/my-topic'],
        },
      });

    const result = await client.listWatches();

    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/watch/uuid-1');
    expect(result).toEqual([
      {
        id: 'uuid-1',
        url: 'https://example.com/item/1',
        title: 'Example Item',
        fetchBackend: 'html_requests',
        checkIntervalMinutes: 15,
        paused: true,
        lastChecked: 1700000000,
        lastChanged: 1700000000,
        hasError: false,
        lastError: null,
        includeFilters: ['#price', '.stock'],
        subtractedFilters: ['.ads'],
        notificationTopic: 'my-topic',
        tag: '',
        snapshotCount: 4,
      },
    ]);
  });

  it('should read the topic out of a notification url that carries click and avatar params', async () => {
    // 通知 URL は ntfy://host/<topic>?click=…&avatar_url=… の形で、パラメータの中身は
    // パーセントエンコード済み（「/」を含まない）。クエリを落とさずに末尾を取ると
    // トピック名にクエリごと入り、設定変更で保存したときに別トピックへ化ける。
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { 'uuid-1': { url: 'https://example.com/', title: 'Example' } } })
      .mockResolvedValueOnce({
        data: {
          url: 'https://example.com/',
          title: 'Example',
          notification_urls: [
            `ntfy://host.docker.internal:8085/dryeyes-mowa-ab12cd-manga?${CLICK}&${AVATAR}`,
          ],
        },
      });

    const [watch] = await client.listWatches();

    expect(watch.notificationTopic).toBe('dryeyes-mowa-ab12cd-manga');
  });

  it('should keep listing a watch whose detail could not be fetched', async () => {
    mockAxiosInstance.get
      .mockResolvedValueOnce({
        data: { 'uuid-1': { url: 'https://example.com/item/1', title: 'Example Item' } },
      })
      .mockRejectedValueOnce(new Error('detail unavailable'));

    const result = await client.listWatches();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'uuid-1', title: 'Example Item', snapshotCount: 0 });
  });

  it('should reuse the cached detail on the next listing', async () => {
    // 100 件規模でも 30 秒ごとのポーリングで毎回全件の詳細を引かないこと
    const listEntry = {
      url: 'https://example.com/item/1',
      title: 'Example Item',
      last_changed: 1700000000,
      last_checked: 1700000000,
      last_error: false,
    };
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { 'uuid-1': listEntry } })
      .mockResolvedValueOnce({
        data: { ...listEntry, paused: true, time_between_check: { minutes: 15 }, history_n: 2 },
      })
      // 2 回目の一覧。チェック時刻だけ進んでいるので詳細は引き直さない
      .mockResolvedValueOnce({ data: { 'uuid-1': { ...listEntry, last_checked: 1700000600 } } });

    await client.listWatches();
    const second = await client.listWatches();

    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(3);
    expect(second[0].paused).toBe(true);
    expect(second[0].checkIntervalMinutes).toBe(15);
    // 時刻は毎回の一覧が返す新しい値を使う
    expect(second[0].lastChecked).toBe(1700000600);
  });

  it('should refetch the detail once the watch has changed', async () => {
    const listEntry = {
      url: 'https://example.com/item/1',
      title: 'Example Item',
      last_changed: 1700000000,
      last_checked: 1700000000,
      last_error: false,
    };
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { 'uuid-1': listEntry } })
      .mockResolvedValueOnce({ data: { ...listEntry, history_n: 2 } })
      .mockResolvedValueOnce({ data: { 'uuid-1': { ...listEntry, last_changed: 1700005000 } } })
      .mockResolvedValueOnce({ data: { ...listEntry, last_changed: 1700005000, history_n: 3 } });

    await client.listWatches();
    const second = await client.listWatches();

    expect(mockAxiosInstance.get).toHaveBeenCalledTimes(4);
    expect(second[0].snapshotCount).toBe(3);
  });

  it('should drop the cached detail after the watch was updated', async () => {
    // 間隔やフィルタの変更は一覧 API の値に出ないため、明示的に捨てないと古い設定が残る
    const listEntry = {
      url: 'https://example.com/item/1',
      title: 'Example Item',
      last_changed: 1700000000,
      last_checked: 1700000000,
      last_error: false,
    };
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { 'uuid-1': listEntry } })
      .mockResolvedValueOnce({ data: { ...listEntry, time_between_check: { minutes: 10 } } })
      // updateWatch が最後に呼ぶ getWatch
      .mockResolvedValueOnce({ data: { ...listEntry, time_between_check: { minutes: 60 } } })
      .mockResolvedValueOnce({ data: { 'uuid-1': listEntry } })
      .mockResolvedValueOnce({ data: { ...listEntry, time_between_check: { minutes: 60 } } });
    mockAxiosInstance.put.mockResolvedValueOnce({ data: {} });

    await client.listWatches();
    await client.updateWatch('uuid-1', { checkIntervalMinutes: 60 }, 'dryeyes-alice-aaaaaa');
    const after = await client.listWatches();

    expect(after[0].checkIntervalMinutes).toBe(60);
    // 間隔を送るだけでは効かず、全体設定の既定を使うフラグを降ろす必要がある
    expect(mockAxiosInstance.put).toHaveBeenCalledWith(
      '/api/v1/watch/uuid-1',
      expect.objectContaining({
        time_between_check: { minutes: 60 },
        time_between_check_use_default: false,
      })
    );
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
      notification_urls: [
        `ntfy://host.docker.internal:8085/dryeyes-alice-aaaaaa-alerts?${CLICK}&${AVATAR}`,
      ],
      notification_title: NOTIFICATION_TITLE,
      notification_body: NOTIFICATION_BODY,
      notification_format: NOTIFICATION_FORMAT,
      time_between_check: { minutes: 30 },
      // これを降ろさないと changedetection.io は全体設定の既定間隔でチェックしてしまう
      time_between_check_use_default: false,
      include_filters: ['.main-content'],
      // 除外は subtractive_selectors。subtracted_filters では検知処理から参照されない。
      subtractive_selectors: ['.footer'],
      // 画面内に入って初めて中身が入る一覧を拾えるよう、クロール時にもスクロールさせる
      webdriver_js_execute_code: LAZY_LOAD_SCROLL_JS,
    }));

    // 差分をそのまま載せると ntfy 側で弾かれるため、本文は必ず切り詰めた平文にする
    expect(NOTIFICATION_BODY).toContain('truncate(');
    expect(NOTIFICATION_FORMAT).toBe('text');
    // 本文は増えた行が主役。増えた行が無い変更のときだけ差分全体に落とす
    expect(NOTIFICATION_BODY).toMatch(/diff_added\(lines=\d+\) or diff\(lines=\d+\)/);
    expect(NOTIFICATION_BODY.indexOf('diff_added')).toBeLessThan(NOTIFICATION_BODY.indexOf('watch_url'));

    expect(created.id).toBe('new-uuid');
  });

  it('should sync click url and notification template without touching their topic', async () => {
    mockAxiosInstance.get
      .mockResolvedValueOnce({ data: { 'uuid-1': {}, 'uuid-2': {} } })
      .mockResolvedValueOnce({
        data: { notification_urls: ['ntfy://host.docker.internal:8085/topic-a'] },
      })
      // click も avatar_url もテンプレートも現行のものになっている監視は更新しない
      .mockResolvedValueOnce({
        data: {
          notification_urls: [`ntfy://host.docker.internal:8085/topic-b?${CLICK}&${AVATAR}`],
          notification_title: NOTIFICATION_TITLE,
          notification_body: NOTIFICATION_BODY,
          notification_format: NOTIFICATION_FORMAT,
        },
      });

    const updated = await client.syncNotificationSettings(
      'http://192.168.0.10:3010/?watch={{watch_uuid}}',
      'http://192.168.0.10:3010/api/public/watches/{{watch_uuid}}/favicon'
    );

    expect(updated).toBe(1);
    expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.put).toHaveBeenCalledWith('/api/v1/watch/uuid-1', {
      notification_urls: [`ntfy://host.docker.internal:8085/topic-a?${CLICK}&${AVATAR}`],
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
