import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import {
  buildWatchClickUrl,
  buildWatchFaviconUrl,
  scopeTopicToUser,
  toAppriseNtfyUrl,
  withAvatarUrlParam,
  withClickParam,
} from './ntfyTopic.js';
import { LAZY_LOAD_SCROLL_JS } from './lazyLoadScroll.js';
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

// 一覧表示のために監視ごとの詳細を引くときの並列数
const DETAIL_CONCURRENCY = 6;

// 監視ごとの詳細レスポンスを使い回す時間。
// 一覧 API が設定値を返さない都合で監視の数だけ詳細を引く必要があり、
// 100 件規模になると 30 秒ごとのポーリングで毎回 100 リクエストになってしまう。
// 設定値はめったに変わらないので短時間キャッシュし、下のいずれかで捨てる。
//   - この TTL を過ぎた
//   - 一覧 API 側で last_changed / last_error / url / title が変わった（履歴が増えた等）
//   - DryEyes から更新・再チェック・削除した（明示的に破棄）
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;

// 全件の TTL が同時に切れて取り直しが一斉に走らないよう、有効期限を ±20% ばらけさせる
const nextExpiry = (): number => Date.now() + DETAIL_CACHE_TTL_MS * (0.8 + Math.random() * 0.4);

// Cloudflare の Bot 対策による 403 を検知したときに差し替える User-Agent。
// システム全体のデフォルトは変えず、該当監視の headers にだけ設定する。
const CLOUDFLARE_RETRY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
// 差し替えても直らなかった監視を毎回叩き直さないための待機時間
const CLOUDFLARE_RETRY_COOLDOWN_MS = 60 * 60 * 1000;
// html_webdriver の再チェックが完了するまでの待ち時間（実測 7〜17 秒程度かかるため余裕を見る）
const CLOUDFLARE_RETRY_RECHECK_WAIT_MS = 20 * 1000;

interface CachedWatchDetail {
  data: any;
  expiresAt: number;
  signature: string;
}

// 一覧 API が返す値のうち「これが変わったなら詳細も変わっている」ものを鍵にする。
// last_checked は変更が無くてもチェックのたびに動くので含めない。
function detailSignature(listEntry: any): string {
  return JSON.stringify([
    listEntry?.last_changed ?? null,
    listEntry?.last_error ?? null,
    listEntry?.url ?? null,
    listEntry?.title ?? null,
  ]);
}

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
  private detailCache = new Map<string, CachedWatchDetail>();
  // Cloudflare UA 差し替えに失敗した監視の再試行禁止期限 (uuid -> Date.now() 比較用の時刻)
  private cloudflareRetryCooldownUntil = new Map<string, number>();
  private cloudflareRetryRunning = false;

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

  // 監視一覧取得。
  // 一覧 API は title / url / last_checked など一部の項目しか返さず、paused・チェック間隔・
  // フィルタ・履歴件数は含まれない。停止中の表示や設定編集にはそれらが必要なので、
  // 監視ごとの詳細も取得して合成する。詳細は DETAIL_CACHE_TTL_MS の間だけ使い回す。
  async listWatches(): Promise<WatchModel[]> {
    const res = await this.client.get('/api/v1/watch');
    const rawData = (res.data || {}) as Record<string, any>; // 通常は { [uuid]: { ... } }
    const uuids = Object.keys(rawData);

    // changedetection.io 側で消された監視のキャッシュを落とす
    for (const uuid of this.detailCache.keys()) {
      if (!(uuid in rawData)) this.detailCache.delete(uuid);
    }

    const now = Date.now();
    const watches: WatchModel[] = new Array(uuids.length);
    const staleIndexes: number[] = [];

    uuids.forEach((uuid, index) => {
      const listEntry = rawData[uuid];
      const cached = this.detailCache.get(uuid);

      if (cached && cached.expiresAt > now && cached.signature === detailSignature(listEntry)) {
        // 設定値はキャッシュから、時刻など一覧が毎回返す値は今回の取得結果を優先する
        watches[index] = this.transformToWatchModel(uuid, { ...cached.data, ...listEntry });
      } else {
        staleIndexes.push(index);
      }
    });

    // ローカル運用でも監視が増えると直列取得では待たされるため、数本だけ並行させる
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < staleIndexes.length) {
        const index = staleIndexes[cursor++];
        const uuid = uuids[index];
        const listEntry = rawData[uuid];
        try {
          const detail = await this.client.get(`/api/v1/watch/${uuid}`);
          this.detailCache.set(uuid, {
            data: detail.data,
            expiresAt: nextExpiry(),
            signature: detailSignature(listEntry),
          });
          watches[index] = this.transformToWatchModel(uuid, detail.data);
        } catch {
          // 詳細が取れない監視も一覧からは落とさず、一覧 API の情報だけで表示する
          this.detailCache.delete(uuid);
          watches[index] = this.transformToWatchModel(uuid, listEntry);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(DETAIL_CONCURRENCY, staleIndexes.length) }, () => worker())
    );

    return watches;
  }

  // 設定を書き換えたときなど、次の一覧取得で詳細を引き直させたいときに呼ぶ
  private invalidateDetail(uuid: string): void {
    this.detailCache.delete(uuid);
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
    // 通知をタップしたら、その監視の差分が開くようにしておく。
    // アイコンは監視対象サイトの favicon を DryEyes 経由で配信する
    const ntfyUrl = toAppriseNtfyUrl(
      config.ntfy.internalUrl,
      topic,
      buildWatchClickUrl(config.app.baseUrl),
      buildWatchFaviconUrl(config.app.baseUrl)
    );

    const payload: Record<string, any> = {
      url: dto.url,
      title: dto.title || dto.url,
      fetch_backend: dto.fetchBackend || 'html_webdriver',
      // changedetection.io はページを開いて待つだけでスクロールしない。
      // 画面内に入って初めて中身が入る一覧（少年ジャンプ＋の話数一覧など）は
      // それだと最後まで「ローディング中…」のままなので、こちらから降りて起こす。
      // ピッカーの描画と同じスクリプトを使い、見えている絵と拾う内容を一致させる。
      webdriver_js_execute_code: LAZY_LOAD_SCROLL_JS,
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

    // 除外要素のフィールド名は subtractive_selectors。
    // subtracted_filters も API には受け付けられるが検知処理からは参照されず、除外が効かない。
    if (dto.subtractedFilters && dto.subtractedFilters.length > 0) {
      payload.subtractive_selectors = dto.subtractedFilters;
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
    // 遅延読み込みを起こすスクロールは、保存のたびに現行のものへ揃えておく。
    // DryEyes より前に作った監視も、設定を開いて保存し直せば拾えるようになる。
    const payload: Record<string, any> = { webdriver_js_execute_code: LAZY_LOAD_SCROLL_JS };

    if (dto.url !== undefined) payload.url = dto.url;
    if (dto.title !== undefined) payload.title = dto.title;
    if (dto.fetchBackend !== undefined) payload.fetch_backend = dto.fetchBackend;
    if (dto.paused !== undefined) payload.paused = dto.paused;
    if (dto.tag !== undefined) payload.tag = dto.tag;

    if (dto.notificationTopic !== undefined) {
      const topic = scopeTopicToUser(ownerTopic, dto.notificationTopic);
      payload.notification_urls = [
        toAppriseNtfyUrl(
          config.ntfy.internalUrl,
          topic,
          buildWatchClickUrl(config.app.baseUrl),
          buildWatchFaviconUrl(config.app.baseUrl)
        ),
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
      payload.subtractive_selectors = dto.subtractedFilters;
    }

    try {
      await this.client.put(`/api/v1/watch/${uuid}`, payload);
    } catch (err: any) {
      throw wrapApiError(err, 'changedetection.io への監視更新に失敗しました');
    }
    // 間隔やフィルタだけの変更は一覧 API の値に出ないので、キャッシュは明示的に捨てる
    this.invalidateDetail(uuid);
    return this.getWatch(uuid);
  }

  // 既存監視の通知設定を現在の DryEyes の既定へ揃える。
  //  - 通知タップ先 (click) を現在の APP_BASE_URL に合わせる
  //  - 通知アイコン (avatar_url) を favicon 配信 URL に合わせる
  //  - 通知本文・フォーマットを現行テンプレートに合わせる
  //    （diff 全文を送っていた頃の監視は ntfy に弾かれて通知が届かないため）
  // 機能追加前に作られた監視や、APP_BASE_URL を変えたときのために起動時に一度だけ実行する。
  // 一覧 API は notification_urls を返さないため、監視ごとに取得して差分があるものだけ更新する。
  async syncNotificationSettings(clickUrl: string, avatarUrl: string): Promise<number> {
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
        /^ntfys?:\/\//.test(url)
          ? withAvatarUrlParam(withClickParam(url, clickUrl), avatarUrl)
          : url
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
      this.invalidateDetail(uuid);
      updated++;
    }

    return updated;
  }

  // 監視先 URL だけを差し替える（リダイレクト追従で使う）。
  // フィルタも通知も触らないため、これまでの履歴とスナップショットはそのまま引き継がれる。
  // 移転先が同じ内容のミラーなら、差し替えても差分は出ない ＝ 監視が途切れない。
  async updateWatchUrl(uuid: string, url: string): Promise<void> {
    try {
      await this.client.put(`/api/v1/watch/${uuid}`, { url });
    } catch (err: any) {
      throw wrapApiError(err, 'changedetection.io への監視 URL 更新に失敗しました');
    }
    // URL は一覧 API にも出るが、更新直後に必ず引き直させるため明示的に捨てる
    this.invalidateDetail(uuid);
  }

  // 監視削除
  async deleteWatch(uuid: string): Promise<void> {
    await this.client.delete(`/api/v1/watch/${uuid}`);
    this.invalidateDetail(uuid);
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
    // 結果が返ってくるのは少し後だが、エラー状態などをすぐ拾えるようキャッシュは捨てておく
    this.invalidateDetail(uuid);
  }

  // Cloudflare の Bot 対策で 403 になっている監視を探し、汎用 User-Agent に差し替えて再チェックする。
  //   ① システムデフォルトの User-Agent（headers 未設定）でのチェック結果を見る
  //   ② 403 かつ remote_server_reply が cloudflare の監視だけを対象に、User-Agent を差し替えて再チャレンジ
  //   ③ それで直ったら、以後もその監視は差し替えた User-Agent を使い続ける（システム既定は変えない）
  // 直らなかった監視は headers を元に戻し、しばらく（CLOUDFLARE_RETRY_COOLDOWN_MS）再試行しない。
  async retryCloudflareBlockedWatches(): Promise<void> {
    if (this.cloudflareRetryRunning) return; // 前回の実行が長引いている間は重複起動しない
    this.cloudflareRetryRunning = true;
    try {
      let listRes;
      try {
        listRes = await this.client.get('/api/v1/watch');
      } catch (err: any) {
        console.warn('[Cloudflare UA retry] 監視一覧の取得に失敗しました:', err.message);
        return;
      }

      const rawData = (listRes.data || {}) as Record<string, any>;
      const now = Date.now();

      for (const uuid of Object.keys(rawData)) {
        const lastError = String(rawData[uuid]?.last_error || '');
        if (!lastError.includes('403')) continue;

        const cooldownUntil = this.cloudflareRetryCooldownUntil.get(uuid);
        if (cooldownUntil && cooldownUntil > now) continue;

        await this.retryOneCloudflareBlockedWatch(uuid);
      }
    } finally {
      this.cloudflareRetryRunning = false;
    }
  }

  private async retryOneCloudflareBlockedWatch(uuid: string): Promise<void> {
    let detail: any;
    try {
      detail = (await this.client.get(`/api/v1/watch/${uuid}`)).data;
    } catch {
      return;
    }

    // Cloudflare 以外が返す 403（認証必須・IP 制限など）は User-Agent を変えても直らないので触らない
    if (detail.remote_server_reply !== 'cloudflare') return;
    // 既に差し替え済みでまだ 403 なら他の要因なので、無限に打ち直さない
    if (detail.headers?.['User-Agent']) return;

    const title = detail.title || detail.url || uuid;
    const originalHeaders = detail.headers || {};
    console.log(
      `[Cloudflare UA retry] "${title}" が 403 (Cloudflare) のため User-Agent を差し替えて再チェックします`
    );

    try {
      await this.client.put(`/api/v1/watch/${uuid}`, {
        headers: { ...originalHeaders, 'User-Agent': CLOUDFLARE_RETRY_USER_AGENT },
      });
      await this.client.get(`/api/v1/watch/${uuid}`, { params: { recheck: 1 } });
    } catch (err: any) {
      console.warn(`[Cloudflare UA retry] "${title}" の再チェック要求に失敗しました:`, err.message);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, CLOUDFLARE_RETRY_RECHECK_WAIT_MS));

    let after: any;
    try {
      after = (await this.client.get(`/api/v1/watch/${uuid}`)).data;
    } catch {
      return;
    }

    this.invalidateDetail(uuid);

    if (String(after.last_error || '').includes('403')) {
      // 直らなかったので差し替えを取り消し、しばらく再試行しない
      try {
        await this.client.put(`/api/v1/watch/${uuid}`, { headers: originalHeaders });
      } catch (err: any) {
        console.warn(`[Cloudflare UA retry] "${title}" の User-Agent 取り消しに失敗しました:`, err.message);
      }
      this.cloudflareRetryCooldownUntil.set(uuid, Date.now() + CLOUDFLARE_RETRY_COOLDOWN_MS);
      console.warn(`[Cloudflare UA retry] "${title}" は User-Agent 差し替えでも 403 のままでした`);
    } else {
      this.cloudflareRetryCooldownUntil.delete(uuid);
      console.log(
        `[Cloudflare UA retry] "${title}" の 403 が解消しました。以後この監視は差し替えた User-Agent を使います`
      );
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

    // 現行は subtractive_selectors。subtracted_filters はこのフィールド名に気づく前に
    // 作られた監視が持っているため、読み出し時のフォールバックとしてのみ見る。
    const rawSubtracted = data.subtractive_selectors ?? data.subtracted_filters;
    const subtractedFilters = rawSubtracted
      ? (Array.isArray(rawSubtracted) ? rawSubtracted : String(rawSubtracted).split('\n')).filter(Boolean)
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
      // 一覧 API には含まれないため、詳細を引けなかった監視では 0 になる
      snapshotCount: Math.max(0, Math.floor(Number(data.history_n)) || 0),
    };
  }
}

export const changedetectionClient = new ChangedetectionClient();
