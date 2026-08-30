import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import {
  buildWatchClickUrl,
  scopeTopicToUser,
  toAppriseNtfyUrl,
  withClickParam,
} from './ntfyTopic.js';
import { CreateWatchDto, UpdateWatchDto, WatchModel, WatchHistoryItem } from '../types/index.js';

// ntfy へ送る通知のテンプレート。
// Apprise の ntfy プラグインは送信 JSON が 8000 文字を超えると本文を .txt 添付へ切り替えるが、
// 添付を許可していない ntfy サーバーは 400 (attachments not allowed) を返し、通知そのものが消える。
// そのため差分が長い監視でも本文に収まるよう、平文フォーマットにした上で diff を切り詰める。
// (JSON 化で日本語は \uXXXX へ展開され 1 文字が 6 文字分を占めるため、上限は小さめに取る)
const NOTIFICATION_DIFF_LIMIT = 600;
export const NOTIFICATION_FORMAT = 'text';
export const NOTIFICATION_TITLE = '[DryEyes] {{ watch_title }} が更新されました';
export const NOTIFICATION_BODY =
  '{{ watch_url }} で変更を検知しました。\nDiff:\n' +
  `{{ diff | truncate(${NOTIFICATION_DIFF_LIMIT}, True, ' …(省略)') }}`;

// changedetection.io が返したエラー本文を握り潰さずに呼び出し元へ伝える
function wrapApiError(err: any, context: string): Error {
  const body = err?.response?.data;
  const detail =
    typeof body === 'string'
      ? body
      : body?.message || body?.error || (body ? JSON.stringify(body) : undefined);
  const wrapped: any = new Error(detail ? `${context}: ${detail}` : `${context}: ${err?.message}`);
  wrapped.status = err?.response?.status;
  return wrapped;
}

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
    const res = await this.client.get('/api/v1/systeminfo');
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
  // ownerTopic は認証済みユーザーのトピック。クライアント側の値では上書きできないよう、
  // DTO とは別の引数としてサーバー側から必ず渡す。
  async createWatch(dto: CreateWatchDto, ownerTopic: string): Promise<WatchModel> {
    const topic = scopeTopicToUser(ownerTopic, dto.notificationTopic);
    // 通知をタップしたら、その監視の差分が開くようにしておく
    const ntfyUrl = toAppriseNtfyUrl(
      config.ntfy.internalUrl,
      topic,
      buildWatchClickUrl(config.app.baseUrl)
    );

    const payload: Record<string, any> = {
      url: dto.url,
      title: dto.title || dto.url,
      fetch_backend: dto.fetchBackend || 'html_webdriver',
      tag: dto.tag || '',
      notification_urls: [ntfyUrl],
      notification_title: NOTIFICATION_TITLE,
      notification_body: NOTIFICATION_BODY,
      notification_format: NOTIFICATION_FORMAT,
    };

    if (dto.checkIntervalMinutes) {
      payload.time_between_check = {
        minutes: dto.checkIntervalMinutes,
      };
    }

    // API スキーマは配列を要求する（改行連結した文字列だと 'is not of type array' で 400 になる）
    if (dto.includeFilters && dto.includeFilters.length > 0) {
      payload.include_filters = dto.includeFilters;
    }

    if (dto.subtractedFilters && dto.subtractedFilters.length > 0) {
      payload.subtracted_filters = dto.subtractedFilters;
    }

    let res;
    try {
      res = await this.client.post('/api/v1/watch', payload);
    } catch (err: any) {
      throw wrapApiError(err, 'changedetection.io への監視作成に失敗しました');
    }
    const uuid = res.data.uuid || res.data.id;
    return this.getWatch(uuid);
  }

  // 監視更新
  async updateWatch(uuid: string, dto: UpdateWatchDto, ownerTopic: string): Promise<WatchModel> {
    const payload: Record<string, any> = {};

    if (dto.url !== undefined) payload.url = dto.url;
    if (dto.title !== undefined) payload.title = dto.title;
    if (dto.fetchBackend !== undefined) payload.fetch_backend = dto.fetchBackend;
    if (dto.paused !== undefined) payload.paused = dto.paused;
    if (dto.tag !== undefined) payload.tag = dto.tag;

    if (dto.notificationTopic !== undefined) {
      const topic = scopeTopicToUser(ownerTopic, dto.notificationTopic);
      payload.notification_urls = [
        toAppriseNtfyUrl(config.ntfy.internalUrl, topic, buildWatchClickUrl(config.app.baseUrl)),
      ];
      // 通知先を触るタイミングで本文テンプレートも現行のものに揃えておく
      payload.notification_title = NOTIFICATION_TITLE;
      payload.notification_body = NOTIFICATION_BODY;
      payload.notification_format = NOTIFICATION_FORMAT;
    }

    if (dto.checkIntervalMinutes !== undefined) {
      payload.time_between_check = {
        minutes: dto.checkIntervalMinutes,
      };
    }

    if (dto.includeFilters !== undefined) {
      payload.include_filters = dto.includeFilters;
    }

    if (dto.subtractedFilters !== undefined) {
      payload.subtracted_filters = dto.subtractedFilters;
    }

    try {
      await this.client.put(`/api/v1/watch/${uuid}`, payload);
    } catch (err: any) {
      throw wrapApiError(err, 'changedetection.io への監視更新に失敗しました');
    }
    return this.getWatch(uuid);
  }

  // 既存監視の通知設定を現在の DryEyes の既定へ揃える。
  //  - 通知タップ先 (click) を現在の APP_BASE_URL に合わせる
  //  - 通知本文・フォーマットを現行テンプレートに合わせる
  //    （diff 全文を送っていた頃の監視は ntfy に弾かれて通知が届かないため）
  // 機能追加前に作られた監視や、APP_BASE_URL を変えたときのために起動時に一度だけ実行する。
  // 一覧 API は notification_urls を返さないため、監視ごとに取得して差分があるものだけ更新する。
  async syncNotificationSettings(clickUrl: string): Promise<number> {
    const res = await this.client.get('/api/v1/watch');
    let updated = 0;

    for (const uuid of Object.keys(res.data as Record<string, any>)) {
      const detail = await this.client.get(`/api/v1/watch/${uuid}`);
      const urls: string[] = Array.isArray(detail.data?.notification_urls)
        ? detail.data.notification_urls
        : [];
      // 通知先が未設定の監視（changedetection.io 側の共通設定を使うもの）は触らない
      if (urls.length === 0) continue;

      const payload: Record<string, any> = {};

      const next = urls.map((url) =>
        /^ntfys?:\/\//.test(url) ? withClickParam(url, clickUrl) : url
      );
      if (next.some((url, i) => url !== urls[i])) payload.notification_urls = next;

      if (detail.data?.notification_title !== NOTIFICATION_TITLE) {
        payload.notification_title = NOTIFICATION_TITLE;
      }
      if (detail.data?.notification_body !== NOTIFICATION_BODY) {
        payload.notification_body = NOTIFICATION_BODY;
      }
      if (detail.data?.notification_format !== NOTIFICATION_FORMAT) {
        payload.notification_format = NOTIFICATION_FORMAT;
      }

      if (Object.keys(payload).length === 0) continue;

      await this.client.put(`/api/v1/watch/${uuid}`, payload);
      updated++;
    }

    return updated;
  }

  // 監視削除
  async deleteWatch(uuid: string): Promise<void> {
    await this.client.delete(`/api/v1/watch/${uuid}`);
  }

  // 手動再チェックトリガー
  async triggerCheck(uuid: string): Promise<void> {
    // 再チェックは監視取得エンドポイントの recheck パラメータで要求する。
    // (0.55 系には /watch/<uuid>/check のような専用エンドポイントは無く 404 になる)
    try {
      await this.client.get(`/api/v1/watch/${uuid}`, { params: { recheck: 1 } });
    } catch (err: any) {
      throw wrapApiError(err, 'changedetection.io への再チェック要求に失敗しました');
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

  // スナップショット本文取得（timestamp に 'latest' を渡すと最新を返す）
  async getSnapshot(uuid: string, timestamp: number | 'latest'): Promise<string> {
    try {
      const res = await this.client.get(`/api/v1/watch/${uuid}/history/${timestamp}`, {
        // 本文は text/plain。数字だけのスナップショットが数値化されないよう変換を無効化する。
        responseType: 'text',
        transformResponse: [(data: any) => data],
      });
      return typeof res.data === 'string' ? res.data : String(res.data ?? '');
    } catch (err: any) {
      throw wrapApiError(err, 'スナップショットの取得に失敗しました');
    }
  }

  // データ変換ヘルパー
  private transformToWatchModel(uuid: string, data: any): WatchModel {
    const includeFilters = data.include_filters
      ? (Array.isArray(data.include_filters) ? data.include_filters : String(data.include_filters).split('\n')).filter(Boolean)
      : [];

    const subtractedFilters = data.subtracted_filters
      ? (Array.isArray(data.subtracted_filters) ? data.subtracted_filters : String(data.subtracted_filters).split('\n')).filter(Boolean)
      : [];

    let topic = '';
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
