// changedetection.io が受け付ける値のみ。docker-compose で PLAYWRIGHT_DRIVER_URL を
// 指定しているため、html_webdriver が Playwright (sockpuppetbrowser) 経由になる。
export type FetchBackend = 'system' | 'html_requests' | 'html_webdriver';

export interface WatchModel {
  id: string; // uuid
  url: string;
  title: string;
  fetchBackend: FetchBackend;
  checkIntervalMinutes: number;
  paused: boolean;
  lastChecked: number | null; // unix timestamp
  lastChanged: number | null; // unix timestamp
  hasError: boolean;
  lastError: string | null;
  includeFilters: string[]; // css selectors / xpath
  subtractedFilters: string[]; // ignore selectors
  notificationTopic: string;
  tag?: string;
  snapshotCount: number; // これまでに保存されたスナップショット数 (changedetection.io の history_n)
  // 以下は DryEyes 側で付与する情報（changedetection.io は所有者や既読を持たない）
  hasUnviewed?: boolean; // 未読の変更があるか
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

export interface UpdateWatchDto {
  url?: string;
  title?: string;
  fetchBackend?: FetchBackend;
  checkIntervalMinutes?: number;
  paused?: boolean;
  includeFilters?: string[];
  subtractedFilters?: string[];
  notificationTopic?: string;
  tag?: string;
}

export interface WatchHistoryItem {
  timestamp: number;
  snapshotId: string;
}

// ---------------------------------------------------------------------------
// 認証まわり（ローカル運用前提の簡易ユーザー管理）
// ---------------------------------------------------------------------------

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string; // scrypt$<salt>$<hash>
  ntfyTopic: string; // このユーザー専用の ntfy トピック
  createdAt: string;
}

export interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

// 本人へ返す表現（passwordHash は絶対に含めない）
export interface PublicUser {
  id: string;
  username: string;
  ntfyTopic: string;
  createdAt: string;
}

// 他人へ見せる表現。
// ntfy のトピックは「名前を知っていれば誰でも購読・投稿できる」実質的な合鍵なので、
// 他ユーザーの一覧にはトピック名も登録日時も載せない。
export interface UserSummary {
  id: string;
  username: string;
}

export interface AuthStoreData {
  users: UserRecord[];
  sessions: SessionRecord[];
}

export interface OwnershipStoreData {
  owners: Record<string, string>; // watchId -> userId
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

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean; // 行数上限で打ち切ったか
}

export interface WatchDiffResponse extends DiffResult {
  watchId: string;
  from: number | null; // 比較元スナップショットの時刻 (unix秒)。前回閲覧時点。
  to: number | null; // 比較先スナップショットの時刻 (unix秒)。最新。
  hasUnviewed: boolean; // まだ確認していない変更があるか
  lastViewedAt: string | null; // 最後に既読にした日時 (ISO8601)
  snapshotCount: number;
  // 比較対象が無い（初回スナップショットのみ）ときに現在の内容を数行だけ返す
  currentPreview?: string[];
}

// ユーザーごと・監視ごとの既読状態
export interface WatchViewState {
  snapshotTimestamp: number; // 既読にしたスナップショットの時刻 (unix秒)
  viewedAt: string; // ISO8601
  // 既読にした時点のスナップショット数。現在の数との差が「未読の更新回数」になる。
  // この項目を導入する前に記録された状態には存在しない。
  snapshotCount?: number;
}

export interface ViewStateStoreData {
  views: Record<string, WatchViewState>; // `${userId}:${watchId}`
}
