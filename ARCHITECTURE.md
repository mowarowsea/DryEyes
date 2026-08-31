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
  - **PWA として配信**（`public/manifest.webmanifest` + 最小の Service Worker）。
    インストール済みの端末では OS の共有シートに DryEyes が並び、
    `?shared=<URL>` で開かれると登録モーダルが URL 入力済みの状態で立ち上がる。
    スマホでの登録は「URL を打ち直す」手間が支配的なため、その往復をなくすのが狙い。
    共有シートはインストール済み PWA でしか出ないため、HTTPS 経由での配信が前提になる。
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
│       ├── routes/          # API エンドポイント (auth, watches, health, proxy)
│       ├── services/        # changedetection クライアント / ユーザー / 所有者 / 既読 / 差分計算
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
