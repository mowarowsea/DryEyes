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
  // PowerDowner 連携の要約。一覧を「Web 監視 / ダウンロード監視」に分け、
  // 同じ作品の監視を 1 枚にまとめるために添える（設定の実体は watch-feed.json）
  feed?: FeedSummary;
}

/** 一覧に添える投入設定の写し。まとめ方を決めるのに要るぶんだけ */
export interface FeedSummary {
  /** 投入先の PowerDowner ユーザー。決まっていれば「ダウンロード監視」 */
  userId: number | null;
  author: string | null;
  title: string | null;
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

// 変更履歴の 1 件分（そのスナップショットと、その直前のスナップショットの比較）
export interface HistoryDiffResponse extends DiffResult {
  watchId: string;
  from: number | null; // 直前のスナップショットの時刻 (unix秒)。最初のスナップショットでは null
  to: number; // このスナップショットの時刻 (unix秒)
  // 最初のスナップショット（比べる相手が無い）のときに、その内容を数行だけ返す
  snapshotPreview?: string[];
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

// 「転送元ホスト → 転送先ホスト」の組。移転の判断はこの単位で覚える。
export interface RedirectHostPair {
  from: string;
  to: string;
}

// 一度ユーザーが判断した組は覚えておき、同じ行き来で毎回聞かない。
// 例: example.com ⇄ example.other をちょくちょく往復するミラーサイト。
// 監視ごとではなくユーザーごとに持つ。サイト丸ごとの移転では同じ組が何十件も並ぶため。
export interface RedirectDecisions {
  allowed: RedirectHostPair[]; // 承認済み。以後この組の移動は自動で追従する
  denied: RedirectHostPair[]; // 却下済み。以後この組の移動は提案しない
}

export interface RedirectStoreData {
  pending: Record<string, RedirectProposal>; // watchId -> 未処理の提案
  decisions: Record<string, RedirectDecisions>; // userId -> 判断の記録
}

// 移転の確認に対する答え方
export interface RedirectDecisionOptions {
  // 以後この組の移動は確認なしで処理する（承認なら自動で追従、却下なら提案しない）
  always: boolean;
  // 同じ組で確認待ちになっている他の監視には手を付けず、この監視だけを処理する
  onlyThis: boolean;
}

export interface RedirectDecisionResult {
  proposal: RedirectProposal; // 起点にした監視の提案
  applied: number; // 処理できた監視の数（起点を含む）
  failed: number; // 監視先の差し替えに失敗した監視の数（確認待ちのまま残る）
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
  images: Record<string, CardImageRecord>; // watchId -> 自動判定の結果
  // watchId -> ユーザーが自分で決めた背景。自動判定より優先する。
  // 記録が無い監視は今までどおり自動判定に任せる。
  overrides: Record<string, CardImageOverride>;
}

// カード背景の切り抜き。元画像に対する割合 (0..1) で持つ。
// 表示する箱（カードの幅・高さ）は端末や折り返しで変わるので、ピクセルでは持てない。
export interface CardImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  // 切り抜いたときの元画像の縦横比 (naturalWidth / naturalHeight)。
  // 表示側は箱の実寸しか知らないため、これが無いと割合を元の絵へ戻せない。
  ratio: number;
}

// ユーザーが自分で決めた背景。自動判定より優先する。
//  - auto:   自動判定に任せる（既定。記録そのものを消す）
//  - none:   絵を出さない
//  - url:    候補から選んだ、監視対象サイト上の画像
//  - upload: 手元から登録した画像（dataDir/card-images/ に置く）
export type CardImageMode = 'auto' | 'none' | 'url' | 'upload';

export interface CardImageOverride {
  mode: Exclude<CardImageMode, 'auto'>;
  imageUrl?: string | null; // mode: 'url'
  uploadFile?: string | null; // mode: 'upload'（ファイル名だけ。置き場所は BFF が決める）
  crop?: CardImageCrop | null;
  updatedAt: string;
}

// 背景に使えそうな画像の候補（画面の選択肢として返す）。
// 大きさや拾い方は並び順に織り込んであるので、画面へは渡さない。
export interface CardImageChoice {
  url: string;
  current: boolean; // いま実際に敷いている絵か
}

export interface CardImageOptionsResponse {
  mode: CardImageMode;
  crop: CardImageCrop | null;
  candidates: CardImageChoice[];
  // 監視対象サイトをブラウザで開けず、OGP しか見られなかった
  browserFailed: boolean;
}

// 画面から届く「この絵にする」の指定
export interface SaveCardImageDto {
  mode: CardImageMode;
  url?: string; // mode: 'url'
  dataUrl?: string; // mode: 'upload'（data: URL 形式の画像）
  crop?: CardImageCrop | null;
}

// ---------------------------------------------------------------------------
// PowerDowner への投入候補 (ARCHITECTURE.md 5 章)
// ---------------------------------------------------------------------------

/** 監視ページの増分から取り出した 1 件。urls は同一ファイルのミラー */
export interface FeedCandidate {
  id: string;
  watchId: string;
  /** 同じ行を二度候補にしないためのキー。<watchId>:<テキストのハッシュ> */
  sourceKey: string;
  /** 抽出元の要素テキスト (正規化済み) */
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
  /**
   * 対象外にしたときに PowerDowner の台帳へ入れたレコードの ID。
   * 「やっぱり対象だった」と戻すときに、この 1 件だけを向こうから消す。
   */
  libraryItemId?: number | null;
  sentAt?: string | null;
  /** 投入したときの PowerDowner の返答 (スキップ・合流もここに残す) */
  resultNote?: string | null;
}

/**
 * 候補に「PowerDowner から見た状態」を添えたもの。
 * 状態は向こうの台帳が持っていて動くので、DryEyes 側には保存せず、見せるたびに聞き直す。
 * 聞けなかった (PowerDowner が落ちている) ときは null になる。
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

/** 監視ごとの投入設定。changedetection.io は任意フィールドを持てないので DryEyes 側で持つ */
export interface FeedConfig {
  /**
   * 候補を人の確認なしで投入するか。
   * 初回の洗い出しで「何を持っていて何を落とすか」を決めたあと、
   * 次の更新分からはこれを立てて任せる。
   */
  autoSend: boolean;
  /**
   * 作者とタイトル。
   *
   * 監視 1 件 = 1 作品なので、これは行ではなく**作品ページの属性**。
   * 実際、行に載っているのは巻数だけで作者名が無いサイトが多い
   * (`Isekai machikoba muso Shinrai v01-02s.rar katfile rapidgator ...` など)。
   * ここに入れておくと作品名キーが揺れないので、別サイトの監視とも突き合う。
   */
  author: string | null;
  title: string | null;
  /**
   * 行からメタを取り出す正規表現。名前付きキャプチャ (?<author>) (?<title>) (?<volume>) が
   * PowerDowner へ渡るフィールドになる。上の author / title が入っていればそちらが優先。
   * 巻数は PowerDowner 側が元の文字列から読めるので、普通は指定しなくてよい。
   */
  itemPattern: string | null;
  /** PowerDowner 側のユーザー */
  userId: number | null;
  /** 保存先。null なら PowerDowner のユーザー既定フォルダ */
  destDir: string | null;
}

/**
 * どのスナップショットまで候補化したか。
 * 既読 (WatchViewState) とは別に持つ — 同じフラグを使うと「候補に積んだら既読になって
 * 人が気づかない」「人が先に見たら候補に積まれない」のどちらかで必ず事故る。
 */
export interface FeedPointer {
  snapshotTimestamp: number;
  scannedAt: string;
}

export interface FeedStoreData {
  candidates: Record<string, FeedCandidate>;
  configs: Record<string, FeedConfig>;
  pointers: Record<string, FeedPointer>;
}

/** 1 監視ぶんのスキャン結果 */
export interface FeedScanResult {
  watchId: string;
  status:
    | 'no-selector'   // ページ全体を見ている監視。どこを 1 件とみなすか決まらない
    | 'initialized'   // 初回。登録時点の内容を候補にしないため、ポインタだけ置いた
    | 'unchanged'     // 前回スキャンから増分なし
    | 'scanned'       // 増分から候補を作った
    | 'collected';    // 差分を見ずにページ全体から候補を作った (初回の洗い出し)
  /** 積んだ候補の数 */
  added: number;
  /** 差分の増えた行数と、実ページから取れた要素数 (当たり外れの手がかり) */
  addedLines?: number;
  extracted?: number;
  /**
   * 取れた要素の中身 (先頭数件)。候補が 0 件だったときに、
   * セレクタが外れているのか・リンクが取れていないのかを画面で切り分けるため。
   */
  samples?: { text: string; urls: number }[];
}
