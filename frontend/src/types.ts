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
  // 投入設定の写し。一覧を「Web 監視 / ダウンロード監視」に分け、
  // 同じ作品の監視を 1 枚にまとめるのに使う
  feed?: FeedSummary;
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

// 登録前の重複確認で見つかった、同じページを見ている監視。
//  - same:     同じ URL（表記ゆれを除く）
//  - redirect: 別ドメインだが、移転で同じページになっている
export interface DuplicateWatch {
  id: string;
  title: string;
  url: string;
  reason: 'same' | 'redirect';
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

// 変更履歴の 1 件分（そのスナップショットと、その直前のスナップショットの比較）
export interface HistoryDiff {
  watchId: string;
  from: number | null; // 直前のスナップショットの時刻 (unix秒)。最初のスナップショットでは null
  to: number; // このスナップショットの時刻 (unix秒)
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
  snapshotPreview?: string[]; // 最初のスナップショット（比べる相手が無い）の内容
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

// 移転の確認に対する答え方
export interface RedirectDecisionOptions {
  // 以後この「転送元 → 転送先」の行き来は確認なしで処理する（自分の監視すべてで）
  always: boolean;
  // 同じ転送で確認待ちの他の監視には手を付けず、この監視だけを処理する（既定はまとめて処理）
  onlyThis: boolean;
}

// 答えた結果。まとめて処理したときは applied が 2 以上になる
export interface RedirectDecisionResult {
  url: string;
  applied: number; // 処理できた監視の数（起点を含む）
  failed: number; // 監視先の差し替えに失敗した監視の数（確認待ちのまま残る）
}

// ---------------------------------------------------------------------------
// カード背景画像（一覧で監視を見分けるための絵）
// ---------------------------------------------------------------------------

// 切り抜きの指定。位置と大きさは元画像に対する割合 (0..1) で持つ。
// カードの箱は端末やエラー帯の有無で大きさが変わるため、ピクセルでは決め打てない。
export interface CardImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  // 切り抜いたときの元画像の縦横比 (naturalWidth / naturalHeight)。
  // 表示側は箱の実寸しか知らないので、これが無いと割合を元の絵へ戻せない。
  ratio: number;
}

// 背景の決め方。auto は自動判定（既定）、none は絵を出さない。
export type CardImageMode = 'auto' | 'none' | 'url' | 'upload';

// 背景に使えそうだと BFF が拾ってきた候補（並び順が確からしさの順）
export interface CardImageChoice {
  url: string;
  current: boolean; // いま実際に敷いている絵か
}

export interface CardImageOptions {
  mode: CardImageMode;
  crop: CardImageCrop | null;
  candidates: CardImageChoice[];
  // 監視対象サイトをブラウザで開けず、OGP しか見られなかった
  browserFailed: boolean;
}

// 「この絵にする」の指定
export interface SaveCardImageRequest {
  mode: CardImageMode;
  url?: string; // mode: 'url'
  dataUrl?: string; // mode: 'upload'
  crop?: CardImageCrop | null;
}

// --- PowerDowner への投入候補 (ARCHITECTURE.md 5 章) -----------------------

export interface FeedCandidate {
  id: string;
  watchId: string;
  sourceKey: string;
  text: string;
  urls: string[];
  meta: {
    title: string | null;
    author: string | null;
    volume: string | null;
    rawText: string;
  };
  foundAt: string;
  /** pending: 投入対象 / sent: 投入済み / dismissed: 対象外 */
  status: 'pending' | 'sent' | 'dismissed';
  sentAt?: string | null;
  resultNote?: string | null;
}

/**
 * 候補に「PowerDowner から見た状態」を添えたもの。
 * 棚もジョブも動くので保存せず、一覧を出すたびに聞き直す。
 * 聞けなかった (PowerDowner が落ちている) ときは null。
 */
export interface FeedCandidateWithState extends FeedCandidate {
  powerdowner: {
    state: 'new' | 'skip' | 'merge';
    reason: string | null;
    /** 向こうが元の文字列から読み取った巻数。取れていなければ null */
    volumeFrom: number | null;
    volumeTo: number | null;
  } | null;
}

/** PowerDowner 側の投入先ユーザー */
export interface PowerdownerUser {
  id: number;
  name: string;
  defaultDir: string | null;
}

/**
 * 蔵書 (Pinax) にある作品。投入設定の作者・作品名を棚の綴りに合わせるために出す。
 * 手で書くと 1 文字違うだけで別フォルダに割れるので、既にある綴りを選ばせる。
 */
export interface PinaxSeries {
  id: number;
  title: string;
  author: string | null;
  /** 手元にある冊数 */
  files: number;
  /** 「続きが出ている — 8〜15巻が未所持」など */
  shelf: string | null;
}

/** 一覧に添えて返る投入設定の写し。まとめ方を決めるのに要るぶんだけ */
export interface FeedSummary {
  /** 投入先の PowerDowner ユーザー。決まっていれば「ダウンロード監視」 */
  userId: number | null;
  author: string | null;
  title: string | null;
}

export interface FeedConfig {
  /** 次の更新分から、人の確認なしで投入する */
  autoSend: boolean;
  /**
   * 作者とタイトル。監視 1 件 = 1 作品なので、行ではなく作品ページの属性として持つ。
   * 行に載っているのは巻数だけ、というサイトが多い。
   */
  author: string | null;
  title: string | null;
  itemPattern: string | null;
  userId: number | null;
  destDir: string | null;
}

export interface FeedScanResult {
  watchId: string;
  status: 'no-selector' | 'no-snapshot' | 'initialized' | 'unchanged' | 'scanned' | 'collected';
  added: number;
  addedLines?: number;
  extracted?: number;
  /** 取れた要素の中身 (先頭数件)。候補が 0 件だった原因の切り分け用 */
  samples?: { text: string; urls: number }[];
}

export interface FeedSendSummary {
  sent: number;
  results: { id: string; note: string }[];
  errors: { watchId: string; message: string }[];
  ignored: { id: string; reason: string }[];
}
