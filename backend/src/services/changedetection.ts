import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { CreateWatchDto, UpdateWatchDto, WatchModel, WatchHistoryItem } from '../types/index.js';

export class ChangedetectionClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.changedetection.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(config.changedetection.apiKey ? { 'x-api-key': config.changedetection.apiKey } : {}),
      },
      timeout: 10000,
    });
  }

  // changedetection.io への接続テスト
  async getSystemInfo(): Promise<any> {
    const res = await this.client.get('/api/v1/system-info');
    return res.data;
  }

  // 監視一覧取得
  async listWatches(): Promise<WatchModel[]> {
    const res = await this.client.get('/api/v1/watch');
    const rawData = res.data; // 通常は { [uuid]: { ... } }

    const watches: WatchModel[] = [];
    for (const [uuid, item] of Object.entries(rawData as Record<string, any>)) {
      watches.push(this.transformToWatchModel(uuid, item));
    }
    return watches;
  }

  // 単一監視取得
  async getWatch(uuid: string): Promise<WatchModel> {
    const res = await this.client.get(`/api/v1/watch/${uuid}`);
    return this.transformToWatchModel(uuid, res.data);
  }

  // 監視作成
  async createWatch(dto: CreateWatchDto): Promise<WatchModel> {
    const topic = dto.notificationTopic || config.ntfy.defaultTopic;
    const ntfyUrl = `${config.ntfy.baseUrl}/${topic}`;

    const payload: Record<string, any> = {
      url: dto.url,
      title: dto.title || dto.url,
      fetch_backend: dto.fetchBackend || 'html_requests',
      tag: dto.tag || '',
      notification_urls: [ntfyUrl],
      notification_title: `[DryEyes] {{ watch_title }} が更新されました`,
      notification_body: `{{ watch_url }} で変更を検知しました。\nDiff:\n{{ diff }}`,
    };

    if (dto.checkIntervalMinutes) {
      payload.time_between_check = {
        minutes: dto.checkIntervalMinutes,
      };
    }

    if (dto.includeFilters && dto.includeFilters.length > 0) {
      payload.include_filters = dto.includeFilters.join('\n');
    }

    if (dto.subtractedFilters && dto.subtractedFilters.length > 0) {
      payload.subtracted_filters = dto.subtractedFilters.join('\n');
    }

    const res = await this.client.post('/api/v1/watch', payload);
    const uuid = res.data.uuid || res.data.id;
    return this.getWatch(uuid);
  }

  // 監視更新
  async updateWatch(uuid: string, dto: UpdateWatchDto): Promise<WatchModel> {
    const payload: Record<string, any> = {};

    if (dto.url !== undefined) payload.url = dto.url;
    if (dto.title !== undefined) payload.title = dto.title;
    if (dto.fetchBackend !== undefined) payload.fetch_backend = dto.fetchBackend;
    if (dto.paused !== undefined) payload.paused = dto.paused;
    if (dto.tag !== undefined) payload.tag = dto.tag;

    if (dto.notificationTopic !== undefined) {
      const topic = dto.notificationTopic || config.ntfy.defaultTopic;
      payload.notification_urls = [`${config.ntfy.baseUrl}/${topic}`];
    }

    if (dto.checkIntervalMinutes !== undefined) {
      payload.time_between_check = {
        minutes: dto.checkIntervalMinutes,
      };
    }

    if (dto.includeFilters !== undefined) {
      payload.include_filters = dto.includeFilters.join('\n');
    }

    if (dto.subtractedFilters !== undefined) {
      payload.subtracted_filters = dto.subtractedFilters.join('\n');
    }

    await this.client.put(`/api/v1/watch/${uuid}`, payload);
    return this.getWatch(uuid);
  }

  // 監視削除
  async deleteWatch(uuid: string): Promise<void> {
    await this.client.delete(`/api/v1/watch/${uuid}`);
  }

  // 手動再チェックトリガー
  async triggerCheck(uuid: string): Promise<void> {
    // changedetection.io のチェックAPI
    try {
      await this.client.get(`/api/v1/watch/${uuid}/check`);
    } catch {
      // 一部のバージョンではエンドポイントが異なる場合があるためフォールバック
      await this.client.get(`/api/v1/watch/check/${uuid}`);
    }
  }

  // 履歴取得
  async getHistory(uuid: string): Promise<WatchHistoryItem[]> {
    const res = await this.client.get(`/api/v1/watch/${uuid}/history`);
    const historyData = res.data; // 通常はタイムスタンプのマップ/リスト
    const items: WatchHistoryItem[] = [];

    if (typeof historyData === 'object' && historyData !== null) {
      for (const [timestamp, snapshotId] of Object.entries(historyData)) {
        items.push({
          timestamp: parseInt(timestamp, 10),
          snapshotId: String(snapshotId),
        });
      }
    }

    // 新しい順にソート
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }

  // データ変換ヘルパー
  private transformToWatchModel(uuid: string, data: any): WatchModel {
    const includeFilters = data.include_filters
      ? (Array.isArray(data.include_filters) ? data.include_filters : String(data.include_filters).split('\n')).filter(Boolean)
      : [];

    const subtractedFilters = data.subtracted_filters
      ? (Array.isArray(data.subtracted_filters) ? data.subtracted_filters : String(data.subtracted_filters).split('\n')).filter(Boolean)
      : [];

    let topic = config.ntfy.defaultTopic;
    if (data.notification_urls && Array.isArray(data.notification_urls) && data.notification_urls.length > 0) {
      const match = String(data.notification_urls[0]).match(/\/([^/]+)$/);
      if (match) topic = match[1];
    }

    let intervalMinutes = 10;
    if (data.time_between_check && typeof data.time_between_check === 'object') {
      const m = data.time_between_check.minutes || 0;
      const h = (data.time_between_check.hours || 0) * 60;
      const d = (data.time_between_check.days || 0) * 1440;
      intervalMinutes = m + h + d || 10;
    }

    return {
      id: uuid,
      url: data.url || '',
      title: data.title || data.url || 'Untitled Watch',
      fetchBackend: data.fetch_backend || 'html_requests',
      checkIntervalMinutes: intervalMinutes,
      paused: Boolean(data.paused),
      lastChecked: data.last_checked ? Number(data.last_checked) : null,
      lastChanged: data.last_changed ? Number(data.last_changed) : null,
      hasError: Boolean(data.has_error || data.last_error),
      lastError: data.last_error || null,
      includeFilters,
      subtractedFilters,
      notificationTopic: topic,
      tag: data.tag || '',
    };
  }
}

export const changedetectionClient = new ChangedetectionClient();
