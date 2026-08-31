# DryEyes — 仕様書 (SPEC.md)

## 1. 概要 & コンセプト

### 1.1 プロジェクト名
**DryEyes (ドライアイズ)**

### 1.2 コンセプト
> 「人間が見張り続けたらドライアイになるようなWebページ監視を、DryEyesが代わりにずっと見張る。」

DryEyes は、指定したWebページを定期的に監視し、**ユーザーが関心を持つ箇所だけの変化を検知してスマートフォンへ通知する**、モバイルファーストなWebアプリケーションです。

---

## 2. システム機能要件

### 2.1 監視対象 (Watch) 管理
- **一覧表示**: 監視中の全Webサイトをカード形式で一覧表示。
- **ステータス管理**:
  - `正常 (OK)`: 監視中・直近の取得成功。
  - `未読の変更 (Unviewed)`: 変更が検知され、まだ本人が差分を確認していない状態。
  - `エラー (Error)`: サイトアクセス失敗・タイムアウト等（エラー原因を表示）。
  - `停止中 (Paused)`: 一時停止中。
- **新規登録（2ステップ・ウィザードフロー）**:
  - **Step 1: URL入力**
    - 監視対象WebページのURLを入力し、「次へ（要素を選択）」をクリック（対象ページの `<title>` も自動取得）。
    - スマホの共有シートから開かれた場合は、URL 入力済みの状態でそのまま Step 2 へ自動で進む（後述の 2.4）。
    - secure context（https / localhost）では「貼り付け」ボタンからクリップボードの URL を 1 タップで入れられる。
  - **Step 2: ビジュアル要素ピッカー (Visual Element Picker)**
    - プレビュー画面上で見張りたい要素（話数や価格）をタップ。
    - 「類似要素も監視」ボタンで同種要素（全話数など）を一括ハイライトプレビュー。
    - 「監視を登録する」で XPath を確定し、そのまま登録まで終える。
    - ヘッダーに「Step 2/2」を表示し、ウィザードの途中であることを示す
      （設定変更画面から開いた場合は表示しない）。
    - 「類似要素も監視」「除外」「監視を登録する」はスマホの親指で押せる大きさ・配置にする
      （切り替えは横幅いっぱい、確定は下段）。
    - **登録オプション（表示名・チェック間隔・監視/除外要素・通知先）もこの画面に畳んで置く**。
      別画面に送るとタップと画面遷移が増えるだけなので、既定は閉じたアコーディオンにして
      触らなければそのまま登録できるようにする。
    - 「除外」は押しても画面を閉じない。除外はいくつも足せるようにし、選択だけ解除して選び続けられる。
    - 要素を選ばずに「監視を登録する」を押すとページ全体が対象になる。
- **変更点の確認（カードタップ）**:
  - 監視カードをタップすると「**前回そのユーザーが確認した時点から、最新のチェックまで**」の
    差分を行単位で表示する（追加=緑 / 削除=赤）。変更から離れた行はまとめて省略表示する。
  - 差分を確認したうえで「サイトを開く」から監視対象ページへ移動でき、移動と同時に既読になる。
    ホーム画面から起動した PWA の中では、そのまま開くと PWA を所有するブラウザ（Chrome）の
    カスタムタブに閉じ込められてしまうため、Android では `intent:` に包んで
    端末の既定ブラウザ（Brave など）へ渡す。
    移動せずに「既読にする」だけで閉じることもできる。
  - 既読は**明示的な操作でのみ**記録する。モーダルを開いただけでは既読にならないため、
    誤って閉じても差分は残る。
  - 既読状態はユーザーごとに保持されるため、同じ監視を別ユーザーが見ても互いに影響しない。
- **クイック操作**:
  - 即時チェックトリガー（手動再監視）
  - 一時停止 / 再開トグル
  - 変更履歴確認
  - 監視対象の削除

### 2.2 差分検出 & 通知
- **エンジン連携**: `changedetection.io` の差分検出エンジンを利用。
- **通知配信**: `ntfy` サーバー（デフォルト: `http://localhost:8085`）を経由して Android / iOS の ntfy アプリへ即時プッシュ通知。
- **誤検知防止**: ページの取得失敗（HTTPエラー、タイムアウト）を「変更」として誤通知しない。
- **通知タップからの遷移**: 通知には ntfy の `click`（= `<APP_BASE_URL>/?watch=<監視UUID>`）を付ける。
  スマホで通知をタップすると DryEyes が開き、その監視の差分が自動で表示される。
  - 通知 URL は `ntfy://<host>/<topic>?click=<URLエンコードした遷移先>` の形で登録する。
    `changedetection.io` は通知 URL 内の Jinja トークンも展開するため、監視 UUID は
    `{{watch_uuid}}` のまま埋め込む（波括弧をエンコードすると展開されない）。
  - 遷移先はスマホから到達できる必要があるため `localhost` は使えない。既定は BFF が検出した
    LAN の IPv4（`http://<LAN IP>:3010`）で、`APP_BASE_URL` で上書きできる（Tailscale など外出先から使う場合）。
  - BFF は起動時に既存監視の通知 URL の `click` を現在の値へ揃える（トピックや他の設定は変更しない）。

### 2.3 変更履歴 (History) と差分
- スナップショットのタイムライン表示。
- 過去の変更日時およびスナップショットIDの追跡。
- **差分の基準**: 比較元は「そのユーザーが既読にした時点以前で最も新しいスナップショット」。
  未読の変更が複数回ぶんたまっていても、まとめて 1 つの差分として提示する。
  一度も確認していない / すでに全て既読の場合は、直前のスナップショットとの差分を表示する。
- **差分の計算**: BFF がスナップショット本文を取得し、行単位の最長共通部分列 (LCS) で比較する。
  空行は比較対象から除外する。スナップショットが大きすぎて LCS の表を張れない場合は
  「相手側に無い行」を拾う近似差分に切り替える。出力は変更の前後2行だけを残して省略し、
  上限行数を超えた場合は打ち切って `truncated` を立てる。

---

### 2.4 スマホからの登録（PWA / 共有シート）

スマホでの登録は「見ているページの URL を DryEyes に持ち込む」ところが最も面倒なため、
ブラウザの共有シートから直接渡せるようにする。

- **PWA 化**: `frontend/public/manifest.webmanifest` と最小限の Service Worker (`public/sw.js`) を配信し、
  ホーム画面へインストールできるようにする。Service Worker はキャッシュをほぼ持たない
  （監視状況は常に最新を見たい画面であり、古い JS を掴む方が困るため）。
- **共有シート (Web Share Target)**: インストール済み PWA の共有先に DryEyes が並ぶ。
  共有すると `…/share?shared=<URL>&title=…&text=…` で開き、URL 入力済みのまま Step 2（要素ピッカー）まで自動で進む。
  受け口を `start_url` と分けて `<base>share` にしているのは、パラメータが落ちた場合でも
  「共有から開かれた」ことをパスだけで判別するため。その場合は URL 空の登録モーダルを開き、
  受け取れなかった旨を伝えて貼り付けから続けられるようにする
  （何も起きずにホーム画面が出るだけ、という状態を作らない）。
  ピッカーを閉じた場合は URL が入った Step 1 に留まり、自動では開き直さない。
  - パラメータ名が `url` ではなく `shared` なのは、Vite の開発サーバーが `?url` を
    内部用クエリとして横取りし、アプリに届く前に 403 を返してしまうため。
  - Android の共有は URL が `text` に混ざって渡ってくることがあるため、
    `shared` → `url` → `text` の順に最初の http(s) URL を拾う。
  - ログイン前に共有された場合は、ログイン完了まで保持してから登録モーダルを開く。
  - 読み取ったパラメータは即座に URL から除去する（リロードで登録モーダルが開き直さないように）。
- **ホーム画面ショートカット**: アイコン長押しの「監視を追加」から `…/?add=1` で
  空の登録モーダルを直接開ける。
- **前提**: 共有シートへの登録は **インストール済み PWA でのみ** 有効で、
  インストールには secure context（HTTPS）が必要。
  `http://<LAN IP>:3010` では PWA 化されないため、後述のサブパス配信で HTTPS を用意する。
- **インストールは Chrome で行う**。Brave など一部の Chromium 系ブラウザは WebAPK を作らないため、
  そこからインストールしても共有シートに DryEyes が出ない（画面は全画面で開けるので気づきにくい）。
  Chrome でインストールすれば OS 側に共有先として登録され、
  Brave など他のブラウザからの共有先にも DryEyes が並ぶ。
- **マニフェストの変更は既存のインストールに即座には反映されない**。
  WebAPK はインストールした時点のマニフェストで作られ、Chrome の更新チェックは数日おきになる。
  共有シートまわりを直したときは、アンインストール → Chrome のサイトデータ削除 → 再インストールで確認する。

### 2.5 配信パス（サブパス配信）

Tailscale の 1 ホストに DryEyes 以外のツールも並べられるよう、画面はサブパス配下に置く。

- 既定の配信パスは `/DryEyes/`（`vite.config.ts` の `base`。`BASE_PATH=/` でルート直下にもできる）。
- API・iframe プレビュー・ファビコンの URL は、すべて `import.meta.env.BASE_URL` を基準に組み立てる
  （`apiUrl()`）。BFF 自身は従来どおり `/api` で待ち受け、Vite の proxy が base を取り除いて転送する。
- `manifest.webmanifest` の `start_url` / `scope` / `share_target.action` / アイコンはすべて相対 URL にする。
  manifest 自身の URL が基準になるため、どのパスに置いても PWA のスコープが配信パスに一致する。
- Service Worker も配信パス配下（`<base>sw.js`）に登録し、スコープをその配下に閉じる。
- Tailscale の公開設定は次のとおり。`--set-path` はプロキシ時にパスを取り除くため、
  転送先にも同じパスを付けて打ち消す（そうしないと Vite に base なしで届き、
  HTML 内のアセット参照がルート直下を指して 404 になる）。

  ```
  tailscale serve --bg --set-path=/DryEyes http://127.0.0.1:3010/DryEyes
  ```

- `APP_BASE_URL` も同じサブパス込みの URL にする
  （通知タップ先 `<APP_BASE_URL>/?watch=<uuid>` と、通知のファビコン URL がこれを基準に組み立てられるため）。
- ルート直下 (`/`) へのアクセスは Vite が配信パスへリダイレクトする。

## 3. BFF API 仕様書

DryEyes BFF (`http://localhost:3001`) のエンドポイント一覧。

`/api/watches/*` は **ログイン必須**。`Authorization: Bearer <token>` ヘッダを付与する。
トークンが無効・期限切れの場合は `401` を返し、フロントは保持中のトークンを破棄してログイン画面へ戻る。
`/api/health`、`/api/auth/status`、`/api/proxy/*` は認証不要（要素ピッカーの iframe は
ヘッダを付与できないため、ページ取得プロキシは公開のまま）。

### 3.0 認証

ローカル運用前提の簡易認証。パスワードは `node:crypto` の scrypt でハッシュ化して保存し、
ユーザー・セッション・監視の所有者は `backend/data/` 配下の JSON ファイルに永続化する。

| メソッド | パス | 概要 |
| --- | --- | --- |
| `GET` | `/api/auth/status` | `{ "hasUsers": boolean }`。初回起動（未登録）かどうかの判定に使う |
| `POST` | `/api/auth/register` | ユーザー登録。成功時に自動ログインし `201` を返す |
| `POST` | `/api/auth/login` | ログイン |
| `GET` | `/api/auth/me` | 保存済みトークンからユーザーと ntfy 情報を復元 |
| `POST` | `/api/auth/logout` | セッション失効 |

- **register / login のレスポンス**:
  ```json
  {
    "token": "…64桁のhex…",
    "expiresAt": "2026-11-28T00:00:00.000Z",
    "user": {
      "id": "uuid",
      "username": "mowa",
      "ntfyTopic": "dryeyes-mowa-1beb8d",
      "createdAt": "2026-08-30T10:00:00.000Z"
    }
  }
  ```
  フロントはこの `token` を `localStorage` (`dryeyes.token`) に保存し、次回アクセス時は
  `GET /api/auth/me` で自動的に前回のユーザーへ再ログインする。

- **ユーザーごとの通知分離**: 登録時に `dryeyes-<ユーザー名スラグ>-<ID由来ハッシュ>` 形式の
  専用 ntfy トピックを発行する。監視作成・更新時の通知先はサーバー側で必ずこのトピック配下に
  スコープされ、クライアントから他ユーザーのトピックを指定することはできない。

- **監視の所有者**: 監視は作成したユーザーに紐づき、一覧には自分の監視のみが返る。
  他ユーザーの監視への操作は ID の存在を漏らさないよう一律 `404` を返す。

- **既存監視の引き継ぎ**: ログイン機能の導入前に作成された監視は所有者を持たないため、
  **最初に登録したユーザー**がまとめて引き継ぎ、通知先もそのユーザーのトピックへ付け替える。

### 3.1 ヘルスチェック
`GET /api/health`
- **概要**: BFFおよびバックエンドエンジン (`changedetection.io`) との接続状態を返す。
- **レスポンス**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-08-30T07:00:00.000Z",
    "config": {
      "changedetectionUrl": "http://localhost:5000",
      "ntfyUrl": "http://localhost:8085",
      "defaultTopic": "dryeyes"
    },
    "changedetection": {
      "status": "connected",
      "info": { ... }
    }
  }
  ```

### 3.2 監視対象一覧取得
`GET /api/watches`
- **レスポンス**: `WatchModel[]`

### 3.3 監視対象詳細取得
`GET /api/watches/:id`
- **レスポンス**: `WatchModel`

### 3.4 監視対象新規作成
`POST /api/watches`
- **リクエストボディ (`CreateWatchDto`)**:
  ```json
  {
    "url": "https://example.com/product",
    "title": "新商品在庫",
    "fetchBackend": "html_requests",
    "checkIntervalMinutes": 10,
    "notificationTopic": "在庫",       // 省略可。省略時はログインユーザー専用トピックへ通知。
                                      // 指定時も <ユーザートピック>-<スラグ> にスコープされ、
                                      // changedetection.io へは Apprise 形式 (ntfy://host/topic) で登録される
    "includeFilters": [".price", "#stock"],
    "subtractedFilters": [".ad-banner"]
  }
  ```
- **レスポンス**: `201 Created` (`WatchModel`)

### 3.5 監視対象更新
`PATCH /api/watches/:id`
- **リクエストボディ (`UpdateWatchDto`)**: 更新したいフィールドのみ
- **レスポンス**: `200 OK` (`WatchModel`)

### 3.6 監視対象削除
`DELETE /api/watches/:id`
- **レスポンス**: `204 No Content`

### 3.7 手動チェック実行
`POST /api/watches/:id/check`
- **レスポンス**:
  ```json
  { "success": true, "message": "Check triggered successfully" }
  ```

### 3.8 変更履歴取得
`GET /api/watches/:id/history`
- **レスポンス**: `WatchHistoryItem[]` (新しい順)

### 3.9 差分取得
`GET /api/watches/:id/diff`
- **概要**: ログインユーザーが最後に確認した時点から、最新スナップショットまでの差分。
- **レスポンス (`WatchDiff`)**:
  ```json
  {
    "watchId": "uuid",
    "from": 1788090126,          // 比較元スナップショットの時刻 (unix秒)。前回確認時点。
    "to": 1788090165,            // 比較先スナップショットの時刻 (unix秒)。最新。
    "lines": [
      { "type": "added",   "text": "第112話" },
      { "type": "context", "text": "第111話" },
      { "type": "gap",     "text": "", "count": 36 },
      { "type": "removed", "text": "第001話" }
    ],
    "added": 1,
    "removed": 1,
    "truncated": false,          // 行数上限で打ち切ったか
    "hasUnviewed": true,         // まだ確認していない変更があるか
    "lastViewedAt": "2026-08-30T11:41:34.644Z",
    "snapshotCount": 5
  }
  ```
  - `gap` は「変更なしの行を `count` 行省略した」ことを示すマーカー。
  - スナップショットが 1 件しか無い場合は `from: null` / `lines: []` となり、
    代わりに現在の内容が `currentPreview: string[]` として返る。

### 3.10 既読にする
`POST /api/watches/:id/viewed`
- **概要**: 最新スナップショットまでを確認済みとして記録する。以降 `hasUnviewed` は `false` になる。
- **レスポンス**:
  ```json
  { "success": true, "snapshotTimestamp": 1788090165, "viewedAt": "2026-08-30T11:41:34.644Z" }
  ```

---

## 4. データモデル定義

```typescript
export type FetchBackend = 'system' | 'html_requests' | 'html_webdriver';

export interface WatchModel {
  id: string;                    // UUID
  url: string;                   // 監視先URL
  title: string;                 // 表示名
  fetchBackend: FetchBackend;    // 通常 (html_requests) または ブラウザ (html_webdriver = Playwright 経由)
  checkIntervalMinutes: number;  // 監視頻度 (分)
  paused: boolean;               // 一時停止フラグ
  lastChecked: number | null;    // 最終チェック時刻 (UNIX秒)
  lastChanged: number | null;    // 最終変更時刻 (UNIX秒)
  hasError: boolean;             // エラー有無
  lastError: string | null;      // エラーメッセージ
  includeFilters: string[];      // 監視対象セレクタ一覧
  subtractedFilters: string[];   // 除外セレクタ一覧
  notificationTopic: string;     // ntfy トピック名（所有ユーザーのトピック配下）
  tag?: string;                  // タグ/カテゴリ
  // 以下は BFF が付与する DryEyes 側の情報（changedetection.io は所有者も既読も持たない）
  hasUnviewed?: boolean;         // まだ確認していない変更があるか
  lastViewedAt?: string | null;  // 最後に差分を確認した日時 (ISO8601)
}

// 差分表示
export type DiffLineType = 'added' | 'removed' | 'context' | 'gap';

export interface DiffLine {
  type: DiffLineType;
  text: string;
  count?: number;                // gap のときだけ、省略した行数
}

// 認証（ローカル運用前提の簡易ユーザー管理）
export interface AuthUser {
  id: string;                    // UUID
  username: string;              // ログイン名（大文字小文字を区別せず一意）
  ntfyTopic: string;             // このユーザー専用の ntfy トピック
  createdAt: string;             // ISO8601
}

export interface AuthSession {
  token: string;                 // ブラウザの localStorage に保存する 64桁hex
  expiresAt: string;             // ISO8601 (既定 90 日 / SESSION_TTL_DAYS)
  user: AuthUser;
}
```

> `changedetection.io` の一覧 API (`GET /api/v1/watch`) は `notification_urls` を返さないため、
> 一覧取得時の `notificationTopic` は空文字になる。個別取得 (`GET /api/watches/:id`) では
> 実際のトピック名が入る。

> 監視の再チェック要求は `GET /api/v1/watch/<uuid>?recheck=1` で行う。
> `/api/v1/watch/<uuid>/check` のような専用エンドポイントは 0.55 系には存在せず 404 になる。

> 通知タップ先 (`?watch=<uuid>`) を開いたフロントエンドは、監視 ID を読み取ったあとに
> クエリを取り除く（`history.replaceState`）。リロードや戻る操作で同じ差分が開き直すのを防ぐため。
> ログイン済みでない場合はログイン画面を挟み、ログイン後にその差分を開く。
