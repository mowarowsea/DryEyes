// changedetection.io が受け付ける値のみ。docker-compose で PLAYWRIGHT_DRIVER_URL を
// 指定しているため、html_webdriver が Playwright (sockpuppetbrowser) 経由になる。
export type FetchBackend = 'system' | 'html_requests' | 'html_webdriver';

export interface WatchModel {
  id: string;
  url: string;
  title: string;
  fetchBackend: FetchBackend;
  checkIntervalMinutes: number;
  paused: boolean;
  lastChecked: number | null;
  lastChanged: number | null;
  hasError: boolean;
  lastError: string | null;
  includeFilters: string[];
  subtractedFilters: string[];
  notificationTopic: string;
  tag?: string;
  snapshotCount?: number; // これまでに保存されたスナップショット数
  // 以下は BFF が付与する DryEyes 側の情報
  hasUnviewed?: boolean; // まだ確認していない変更があるか
  unviewedCount?: number; // 最後に差分を確認してから更新が検知された回数
  lastViewedAt?: string | null; // 最後に差分を確認した日時 (ISO8601)
}

export interface CreateWatchDto {
  url: string;
  title?: string;
  fetchBackend?: FetchBackend;
  checkIntervalMinutes?: number;
  includeFilters?: string[];
  subtractedFilters?: string[];
  notificationTopic?: string;
  tag?: string;
}

export interface WatchHistoryItem {
  timestamp: number;
  snapshotId: string;
}

// コピー先ユーザーの選択肢
export interface PublicUser {
  id: string;
  username: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  config: {
    changedetectionUrl: string;
    ntfyUrl: string;
    defaultTopic: string;
  };
  changedetection: {
    status: string;
    info: any;
  };
}

// ---------------------------------------------------------------------------
// 認証まわり（ローカル運用前提の簡易ユーザー管理）
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  username: string;
  /** このユーザー専用の ntfy トピック。監視の通知は必ずこの配下に届く。 */
  ntfyTopic: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export interface NtfyInfo {
  baseUrl: string;
  topic: string;
  subscribeUrl: string;
}

export interface MeResponse {
  user: AuthUser;
  ntfy: NtfyInfo;
}

// ---------------------------------------------------------------------------
// 差分表示（前回閲覧時点 → 最新スナップショット）
// ---------------------------------------------------------------------------

// gap は「変更なしの行を N 行省略した」ことを示すマーカー
export type DiffLineType = 'added' | 'removed' | 'context' | 'gap';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  count?: number; // gap のときだけ、省略した行数
}

export interface WatchDiff {
  watchId: string;
  from: number | null; // 比較元スナップショットの時刻 (unix秒)
  to: number | null; // 比較先スナップショットの時刻 (unix秒)
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
  hasUnviewed: boolean;
  lastViewedAt: string | null;
  snapshotCount: number;
  currentPreview?: string[]; // 初回スナップショットのみの場合の現在値
}
