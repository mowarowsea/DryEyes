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
  // リダイレクトを検知して、監視先の変更をユーザーへ確認している状態（承認されるまで URL は変えない）
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
  // 差分を出さない（初回スナップショットのみ／確認済み）ときに、現在保持している内容を数行だけ返す
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

// ---------------------------------------------------------------------------
// リダイレクト追従（監視先の移転）
// ---------------------------------------------------------------------------

// 監視対象がリダイレクトしていたときに、ユーザーへ確認する提案。
// 自動では書き換えず、承認されて初めて監視 URL を差し替える。
export interface RedirectProposal {
  fromUrl: string;
  toUrl: string;
  chain: string[]; // 経由した URL（fromUrl と toUrl を含む）
  status: number; // 最後のリダイレクトのステータス (301/302/307/308 など)
  permanent: boolean; // 301 / 308 か
  hostChanged: boolean; // ホストが変わったか（別ドメインへの移動）
  detectedAt: string; // ISO8601
  // 遷移先で監視中のセレクタが見つかったか。
  // null は「確認していない／セレクタを設定していない監視」。
  selectorFound: boolean | null;
  toTitle: string | null; // 遷移先ページのタイトル（別サイトへ飛ばされていないかの判断材料）
}

// 一度ユーザーが判断したホストは覚えておき、同じ行き来で毎回聞かない。
// 例: example.com ⇄ example.other をちょくちょく往復するミラーサイト。
export interface RedirectDecisions {
  allowedHosts: string[]; // 承認済み。以後このホストへのリダイレクトは自動で追従する
  deniedHosts: string[]; // 却下済み。以後このホストへのリダイレクトは提案しない
}

export interface RedirectStoreData {
  pending: Record<string, RedirectProposal>; // watchId -> 未処理の提案
  decisions: Record<string, RedirectDecisions>; // watchId -> 判断の記録
}

// ---------------------------------------------------------------------------
// カード背景画像（一覧で監視を見分けるための絵）
// ---------------------------------------------------------------------------

// どうやって決めた絵か。
//  - social:  ページ作者が宣言した og:image / twitter:image
//  - element: 監視対象セレクタの近くにあった画像
export type CardImageSource = 'social' | 'element';

export interface CardImageRecord {
  pageUrl: string; // 解決した時点の監視 URL（移転したら採り直す）
  selectorKey: string; // 解決した時点の includeFilters（監視範囲を変えたら採り直す）
  imageUrl: string | null; // 採用した画像の絶対 URL。null は「見つからなかった」
  // og:image の URL。採用しなかった場合も、同一オリジンの重複判定に使うため覚えておく。
  socialImageUrl: string | null;
  source: CardImageSource | null;
  resolvedAt: string; // ISO8601
  // 絵の決め方の版。上げると、URL もセレクタも変えていない記録を採り直させられる。
  // 版を持たない記録は、決め方を変える前に作られたもの。
  resolverVersion?: number;
  // 要素から選ぶつもりがブラウザへ繋げず、OGP のまま置いた記録。
  // 絵は決まっているが確度が低いので、短い間隔で採り直す。
  provisional?: boolean;
}

export interface CardImageStoreData {
  images: Record<string, CardImageRecord>; // watchId -> 解決結果
}
