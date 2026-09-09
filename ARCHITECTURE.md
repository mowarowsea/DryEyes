# DryEyes — アーキテクチャ設計書 (ARCHITECTURE.md)

## 1. 全体アーキテクチャ概要

DryEyes は、Webクローリング・ブラウザ操作・差分検出などの高負荷かつ壊れやすい処理を既存の OSS エンジン（`changedetection.io` および `ntfy`）に委託し、**ユーザー体験（UX）と監視対象モデルの抽象化に特化した BFF 構成** を採用しています。

```
┌─────────────────────────────────────────────────────────────┐
│ 1. フロントエンド層 (DryEyes UI)                              │
│    • React 18 + Vite + Tailwind CSS + Lucide Icons          │
│    • Mobile-first PWA設計 (ポート: 3010)                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON API (/api)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. BFF層 (DryEyes BFF API)                                  │
│    • Node.js + Express + TypeScript (ポート: 3001)           │
│    • changedetection.io API の抽象化 & データ変換           │
│    • ntfy 通知URLの自動付与 & パラメータ成形                │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST API (/api/v1/watch)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 監視エンジン層 (Docker Compose / WSL2)                   │
│    • changedetection.io (ポート: 5000)                      │
│    • sockpuppetbrowser (Playwright / Chrome Container)      │
└──────────────┬──────────────────────────────┬───────────────┘
               │ 定期クロール (HTTP/Browser)   │ 変更時 Webhook
               ▼                              ▼
      [監視対象 Web サイト]             [ntfy サーバー] (:8085)
                                              │
                                              ▼
                                      📱 スマホ プッシュ通知
```

---

## 2. レイヤー別の責務と設計原則

### 2.1 DryEyes Frontend (UI レイヤー)
- **責務**:
  - モバイル画面に最適化された監視ダッシュボードの提供。
  - 直感的なフォームによる監視設定（CSSセレクタを意識させないUI）。
  - ステータスバッジ（正常・未読の変更・エラー・停止中）の可視化。
  - 監視カードのタップで「前回見てからの変更点」を提示し、そのまま監視対象サイトへ誘導する。
  - ntfy 通知から `?watch=<uuid>` 付きで開かれた場合は、その監視の差分を自動で開く。
  - 起動時のリンク（通知タップ・共有シート）の読み取りは「クエリを読んで URL から消す」副作用を伴うため、
    `useState` の初期化子ではなく、一度きりを保証したエフェクトで行う。
    開発時の `<React.StrictMode>` は初期化を 2 回走らせるため、初期化子に置くと
    2 回目が空振りして通知や共有が無反応になる。
  - **PWA として配信**（`public/manifest.webmanifest` + 最小の Service Worker）。
    インストール済みの端末では OS の共有シートに DryEyes が並び、
    `?shared=<URL>` で開かれると登録モーダルが URL 入力済みの状態で立ち上がる。
    スマホでの登録は「URL を打ち直す」手間が支配的なため、その往復をなくすのが狙い。
    共有シートはインストール済み PWA でしか出ないため、HTTPS 経由での配信が前提になる。
  - **サブパス配信**。Tailscale の 1 ホストに他のツールも並べられるよう、画面は `/DryEyes/` 配下に置く
    （`vite.config.ts` の `base`）。API・iframe・ファビコンの URL は `import.meta.env.BASE_URL` を
    基準に組み立て、manifest と Service Worker も相対パス／配信パス配下に閉じる。
- **原則**:
  - `changedetection.io` の内部仕様や複雑なパラメータを直接扱わず、DryEyes BFF のシンプルなモデルのみを操作する。

### 2.2 DryEyes BFF (Backend For Frontend レイヤー)
- **責務**:
  - `changedetection.io` の REST API との通信（Adapter パターン）。
  - クライアントリクエスト（`CreateWatchDto` など）を `changedetection.io` 形式（`time_between_check`, `notification_urls` 等）に相互変換。
  - CORS の回避および API キーの秘匿。
  - ヘルスチェック（BFF 自身の状態 + changedetection.io との疎通確認）。
  - **ユーザー認証と監視の所有者管理**（ローカル運用前提の簡易認証）。
    `changedetection.io` は所有者という概念を持たないため、「どの監視が誰のものか」は
    BFF が JSON ファイル (`backend/data/`) で保持し、API 応答をユーザー単位でフィルタする。
  - **ユーザーごとの ntfy トピック発行**。監視の通知先は必ず所有者のトピック配下に
    スコープされるため、別ユーザーの通知が混ざらない。
  - **既読状態の管理と差分の生成**。`changedetection.io` の `viewed` フラグは全ユーザー共有に
    なってしまうため、「誰がどのスナップショットまで見たか」は BFF が保持する。
    差分は保持した既読時点と最新スナップショットの本文を取得して BFF 内で行単位に計算する
    （UI にスナップショット本文をそのまま流さない）。
  - **通知タップ先 (ntfy `click`) の管理**。通知から差分へ直行できるよう、監視の通知 URL に
    DryEyes 自身への遷移先を付与する。監視 UUID は `changedetection.io` が展開する Jinja
    トークンとして埋め込むため、監視ごとに URL を作り分けない。遷移先はスマホから到達できる
    必要があるため、BFF が LAN の IPv4 を検出して既定値にする（`APP_BASE_URL` で上書き可）。
  - **通知本文テンプレートの管理**。通知は平文フォーマットで送り、本文に載せる差分は切り詰める。
    Apprise の ntfy プラグインは送信 JSON が 8000 文字を超えると本文を添付ファイルへ切り替えるが、
    添付を許可していない ntfy サーバーはこれを 400 で拒否し、通知そのものが届かなくなるため。
    差分の全文は通知タップ先の DryEyes 側で確認する。
- **原則**:
  - 将来的に監視エンジンを別システムに置き換える際も、BFF の Adapter を差し替えるだけで UI に影響を与えない境界分離を維持する。
  - **新着から取り出したものを選別しない**（下の 5）。何が落とせるかの判断は PowerDowner 側に置く。

### 2.3 changedetection.io + sockpuppetbrowser (監視エンジンレイヤー)
- **責務**:
  - スケジュールに基づく定周期の HTTP 取得 / ブラウザレンダリング。
  - DOM 差分の検出およびスナップショット履歴の保存。
  - 変更検知時の `ntfy` への通知送信（通知 URL 内の Jinja トークンもここで展開される）。

---

## 3. ディレクトリ構成

```text
DryEyes/
├── SPEC.md                  # システム仕様書
├── ARCHITECTURE.md          # アーキテクチャ設計書
├── request.md               # 要求仕様書
├── docker-compose.yml       # changedetection.io + browser コンテナ定義
├── package.json             # ワークスペース管理用
├── start.bat / stop.bat     # 一括起動・停止スクリプト
│
├── backend/                 # DryEyes BFF
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts         # サーバー起動 (ポート 3001)
│       ├── config.ts        # 環境変数定義
│       ├── types/           # 型定義
│       ├── middleware/      # 認証ミドルウェア (Bearer トークン検証)
│       ├── routes/          # API エンドポイント (auth, watches, health, proxy, feed)
│       ├── services/        # changedetection クライアント / ユーザー / 所有者 / 既読 / 差分計算
│       │                    #  + 投入候補 (feedScan / feedMatch / feedStore / itemExtract)
│       │   └── __tests__/   # BFF 単体テスト
│       └── data/            # ユーザー・セッション・所有者・既読状態の永続化 (gitignore)
│
└── frontend/                # DryEyes UI
    ├── package.json
    ├── vite.config.ts       # Vite 設定 (ポート 3010, /api プロキシ)
    ├── tailwind.config.js
    └── src/
        ├── App.tsx          # メインダッシュボード
        ├── deepLink.ts      # 通知タップで開かれた URL から監視 ID を取り出す
        ├── api/             # BFF 呼び出しクライアント
        ├── components/      # UI コンポーネント群 (LoginScreen, Header, WatchCard, WatchList, DiffModal ほか Modals)
        └── __tests__/       # UI 単体テスト
```

---

## 4. 運用・起動構成 (LocalLauncher 連携)

監視の信頼性と開発効率を高めるため、**「監視エンジン（常駐）」と「DryEyes アプリ」を分離して管理** します。

- **changedetection.io**: WSL2 Docker 上でバックグラウンド常駐（定期監視・Cron を維持）。
- **DryEyes アプリ**: UI/BFF の開発時や閲覧時に高速起動。

---

## 5. PowerDowner 連携

`C:\Users\seamo\PowerDowner`（ダウンロード司令塔）。詳細な設計は
[PowerDowner/docs/ROADMAP.md](../PowerDowner/docs/ROADMAP.md) の 2 章にある。ここでは境界だけを示す。

監視で見つけた新着（アップローダへのリンク）を PowerDowner に渡して落とさせる。

### 責務の境界

**「相手には原理的に持てない情報」で切る。**

| | 持っている情報 | 持てない情報 |
|---|---|---|
| DryEyes | 前回スナップショット、既読位置、XPath、監視の文脈 | どのホスターなら落とせるか |
| PowerDowner | ホスター実績表、エンジン振り分け、リトライ、取得済み台帳 | そのページで何が「新しい」のか |

```
DryEyes                                        │  PowerDowner
定期チェック → 差分 → 増分の要素を特定          │
  → その要素配下の <a href> を全部拾う          │
  → 1 件 = { メタ, urls[] } に束ねて候補に積む  │
  → 人が承認 ─── POST /api/jobs ─────────────▶ │ 選別・優先度付け → 台帳と突き合わせ
                                               │  → ダウンロード → リネーム → 通知
```

- **DryEyes はリンクらしきものを全部渡すだけで、選別しない。** ホスターの知識をこちらに
  複製すると PowerDowner の実績表と二重管理になる
- **「同じファイルか」「もう持っているか」の判断は持ち込まない。** 別サイトの監視で同じ巻が
  出た時の重複判定は PowerDowner の台帳が行う。こちらで止めると、投入したが
  ダウンロードに失敗していたケースで二度と落ちてこなくなる
- 渡すのは `title` / `author` / `volume` と、**抽出前の生テキスト `rawText`**。
  抽出ルールは必ずどこかで外れるので、生テキストが残っていれば後から直せる

### PowerDowner の投入 API (実装済み)

PowerDowner 側は受け入れ準備が済んでいる。BFF が叩くのはこの 1 本だけ。

```
POST http://<powerdowner>/api/jobs
Authorization: Bearer <共有トークン>
Content-Type: application/json

{
  "userId": 1,
  "destDir": "省略可。省略するとユーザーの既定フォルダ",
  "items": [
    {
      "urls": ["https://mexa.sh/...", "https://dailyuploads.net/..."],
      "sourceKey": "<watch-uuid>:<行のハッシュ>",
      "source": "dryeyes:<watch-uuid>",
      "meta": {
        "title": "作品名",
        "author": "著者",
        "volume": "3",
        "rawText": "[著者] 作品名 第03巻"
      }
    }
  ]
}
```

応答は `201` で、1 件ごとの処理結果が返る:

```json
{
  "created":   [ { "id": "3f2a1b9c", "url": "...", "meta": { "sourceKey": "...", "mirrors": [] } } ],
  "merged":    [ { "jobId": "...", "sourceKey": "...", "title": "...", "urls": [] } ],
  "skipped":   [ { "sourceKey": "...", "title": "...", "reason": "所持済み (第1-6巻)" } ],
  "invalid":   [ { "sourceKey": "...", "title": "...", "reason": "有効な URL がありません" } ],
  "truncated": 0
}
```

**結果の突き合わせは `sourceKey` で行う。** `title` は重複しうるので目印にならない
(`created` だけは `Job.meta.sourceKey` に入っている)。

BFF 側で押さえておくこと:

- **`skipped` はエラーではない。** 取得済みの巻は落とさないのが正しい動作なので、
  全件スキップでも `201` が返る。画面には「既に持っているので飛ばした」と出す
- **`merged` はジョブが増えない。** 別サイトの同じ巻が既存ジョブのミラー候補に合流した状態。
  これも成功として扱う
- **`truncated` が 0 でなければ切り捨てられている。** 1 リクエスト 20 件が上限。
  残りは次の投入に回す
- `401` はトークン不一致、`400` は `userId` が無い / `items` が空 / 保存先が決まらない
- **同じものを二度送らない責任は DryEyes 側にある。** PowerDowner の台帳は「同じ巻か」を
  作品名と巻数で見るが、巻数を読めない監視 (雑誌・読切) では判定に参加できず素通りする

### 差分テキストから URL は取れない

`changedetection.io` のスナップショットはテキストなので、**増えた行が分かっても href は残らない**。
グローバル設定 `render_anchor_tag_content` を有効にすれば URL 混じりのテキストになるが、
全監視の差分が汚れて人が読めなくなるので採らない。

差分は「どの行が増えたか」の検知だけに使い、**URL は `browserRender.ts` で実ページを開いて
XPath 配下の `<a>` から取る**。`hasAnySelectorMatch()` と同じ仕組みで書ける。

### 実装状況

| 部品 | 役割 | 状態 |
|---|---|---|
| `services/itemExtract.ts` | 実ページを開いて、セレクタに当たった要素とその配下のリンクを取る | 済 |
| `services/feedMatch.ts` | 増分と要素の突き合わせ、正規表現によるメタ抽出 | 済 |
| `services/feedStore.ts` | 候補・監視ごとの設定・投入ポインタ (`watch-feed.json`) | 済 |
| `services/feedScan.ts` | 上の 3 つを繋ぐ。差分 → 抽出 → 候補 | 済 |
| `services/powerdowner.ts` | PowerDowner への POST と、応答を sourceKey ごとの説明に畳む | 済 |
| `services/feedSend.ts` | 監視ごとにまとめ、上限で分割して送り、結果を候補に書き戻す | 済 |
| `routes/feed.ts` | 候補の一覧・見送り・投入、設定の取得と更新、スキャンの実行 | 済 |
| `services/feedAutoScan.ts` | 監視のチェックに追いついて取り込み、`autoSend` が立っていれば自動投入 | 済 |
| `components/FeedModal.tsx` | 設定・取り込み・候補の確認を 1 画面に並べたモーダル | 済 |
| `watchGroup.ts` | 一覧の仕分け (Web 監視 / ダウンロード監視、作品ごとのまとめ) | 済 |
| `components/ListModeTabs.tsx` | 2 つの一覧の切り替え | 済 |
| `components/WorkGroupCard.tsx` | 同じ作品の監視をまとめる枠 | 済 |

API:

```
GET    /api/feed/candidates?status=pending      候補一覧 (自分が持つ監視のものだけ)
POST   /api/feed/candidates/send                選んだ候補を PowerDowner へ送る
POST   /api/feed/candidates/exclude             対象外にする (所持済みなら向こうの台帳へも登録)
POST   /api/feed/candidates/:id/restore         対象外を取り消して戻す
GET    /api/feed/powerdowner/users              投入先に選べる PowerDowner のユーザー
GET    /api/feed/watches/:watchId               投入設定
PUT    /api/feed/watches/:watchId               投入設定の更新 (autoSend / author / title / userId / destDir / itemPattern)
POST   /api/feed/watches/:watchId/scan          増分から候補を作る ({ all: true } でページ全体)
```

### 承認フローと投入ポインタ

**2 段構えで進む。**

1. 登録直後は「全件を洗い出す」でページに並んでいるものを丸ごと候補にする。
   PowerDowner に問い合わせて「もう持っているか」を各候補に添えるので、
   **どれが既にあって・どれを今回落とすか**をその場で決められる。
   落としたくないものは行の × で対象外にする。PowerDowner の台帳へも登録されるので、以後は弾かれる
2. 決まったら `autoSend` を立てる。次の更新分からは自動で投入される

**取り込みの周期は持たない。** 「いつ見に行くか」は監視ごとのチェック間隔
(changedetection.io 側の設定) が既に持っているので、`feedAutoScan.ts` はその結果に
追いつくだけにする — 監視一覧の `lastChanged` が投入ポインタを越えた監視だけを見に行く。
この巡回の間隔は「更新に気づくまでの遅れ」でしかなく、取り込みそのものの周期ではない。

専用の「巡回する / しない」スイッチも持たない。**投入先ユーザーが決まっていること**を連携の印にする —
設定画面で投入先を選ぶこと自体が「この監視はダウンロードに繋ぐ」という意思表示だから。
人が決めるのは「確認してから送るか、そのまま送るか (`autoSend`)」だけ。

投入に失敗した候補は `pending` のまま残る。次の巡回が拾い直すので、リトライ機構は要らない。

**PowerDowner の取得済み台帳はユーザー単位。** 所持の判定 (`/api/items/check`) も
所持の登録 (`/api/items`) も `userId` を要求するので、DryEyes 側は監視ごとの投入先で
束ねてから送る (`groupByPowerdownerUser`)。投入先が未設定の監視の候補は、誰の手元の話か
決まらないので判定を付けずに出す。

- **既読フラグ（`viewState.ts`）を流用しないこと。** 「候補に積んだら既読になって人が気づかない」
  「人が先に見たら候補に積まれない」のどちらかで必ず事故る。専用のポインタを別に持つ
- 監視ごとに「自動 / 確認してから」を持たせ、安定したものから昇格させる
- **巻数の取れない監視（雑誌・読切）は自動にしない。** PowerDowner 側の重複判定に参加できず、
  毎回落ちてしまう
- 一度の投入は 20 件で打ち切る。監視を作り直して全増分が新規に見えた時の安全弁

### 一覧の分け方

1 作品を複数サイトで追いかけるので、監視カードは放っておくと散らばる。軸を 2 つ用意した。

**1. Web 監視 / ダウンロード監視 (`ListModeTabs`)**

目的が違うものを同じ一覧に混ぜない。**投入先ユーザーが決まっている監視をダウンロード監視**とし、
そちらの一覧へ移す。これは定期巡回が追いかける監視の判定 (`feedAutoScan.shouldFollow`) と同じ印で、
「投入先を選ぶ」以外に連携を表すスイッチを増やさないため。未読・エラーなどの絞り込み
(`ListToolbar`) とは軸が違う — あちらは同じ一覧の中で減らす、こちらは別の一覧へ行く。

**2. 作品ごとのまとめ (`WorkGroupCard`)**

ダウンロード監視の一覧では、**投入設定の作品タイトルが一致する監視を 1 枚にまとめる**。
まとめキー (`workKeyOf`) は PowerDowner の `seriesKey` と同じ考え方で記号と空白を落とす —
画面上のまとまりと向こうの重複判定の単位がずれると混乱する。ただし巻数までは落とさない
(作品タイトルは人が入れた値で、巻数は入っていない)。

- **まとめても各カードの操作は畳まない。** サイトごとにチェックも停止も削除も要る
- **1 サイトしか無い作品には見出しを付けない。** 全部に付くとまとまり自体が見えなくなる
- **作品名が空の監視はまとめない。** 空どうしを一致とみなすと、設定途中のものが 1 枚に吸い込まれる
- 並び順は崩さない。まとまりの位置はその作品の最初の 1 件が居た場所になる

一覧に添える投入設定の写しは `WatchModel.feed` (`userId` / `author` / `title`)。
実体は `watch-feed.json` で、ここは仕分けに要るぶんだけの写し。

### 通知

**PowerDowner と二重に出さないこと。** 「新着が出た」「候補が溜まった」は既存の ntfy 通知で
DryEyes の担当。ジョブの完了・人間待ち・失敗は PowerDowner が自分で出す。

### 認証

PowerDowner は `host: 0.0.0.0` で認証を持たないため、投入口には共有トークンを 1 本置く。
BFF は `Authorization: Bearer` を付けて POST する。トークンは BFF の環境変数に持ち、
フロントには渡さない（フロントは BFF の投入 API を叩くだけ）。

```
POWERDOWNER_URL=http://127.0.0.1:3939
POWERDOWNER_TOKEN=   # PowerDowner の config.json の apiToken と同じ値
```

### 投入の単位

監視ごとに投入先ユーザーと保存先が違うので、**監視単位にまとめてから送る**。
1 回の上限 (20 件) を超える分は BFF 側で分割して順に送る — 向こうに切り捨てさせると、
切られた候補が `pending` のまま取り残されて気づけない。

応答に現れなかった候補は送信済みにせず、次の投入に回す。
