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
  // リダイレクトを検知して、監視先の変更を確認している状態（承認するまで URL は変わらない）
  pendingRedirect?: RedirectProposal | null;
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
  currentPreview?: string[]; // 差分を出さない（初回のみ／確認済み）場合の現在値
}

// ---------------------------------------------------------------------------
// リダイレクト追従（監視先の移転）
// ---------------------------------------------------------------------------

// 監視対象が別 URL へリダイレクトしていたときに、BFF が積んでおく確認待ちの提案
export interface RedirectProposal {
  fromUrl: string;
  toUrl: string;
  chain: string[]; // 経由した URL（fromUrl と toUrl を含む）
  status: number; // 最初のリダイレクトのステータス (301/302/307/308 など)
  permanent: boolean; // 301 / 308 か（恒久的な移転として案内してよいか）
  hostChanged: boolean; // ホストが変わったか（別ドメインへの移動）
  detectedAt: string; // ISO8601
  selectorFound: boolean | null; // 遷移先で監視中の要素が見つかったか（null は未確認）
  toTitle: string | null; // 遷移先ページのタイトル
}
