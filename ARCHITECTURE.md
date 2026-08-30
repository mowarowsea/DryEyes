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
  - ステータスバッジ（正常・更新検知・エラー・停止中）の可視化。
- **原則**:
  - `changedetection.io` の内部仕様や複雑なパラメータを直接扱わず、DryEyes BFF のシンプルなモデルのみを操作する。

### 2.2 DryEyes BFF (Backend For Frontend レイヤー)
- **責務**:
  - `changedetection.io` の REST API との通信（Adapter パターン）。
  - クライアントリクエスト（`CreateWatchDto` など）を `changedetection.io` 形式（`time_between_check`, `notification_urls` 等）に相互変換。
  - CORS の回避および API キーの秘匿。
  - ヘルスチェック（BFF 自身の状態 + changedetection.io との疎通確認）。
- **原則**:
  - 将来的に監視エンジンを別システムに置き換える際も、BFF の Adapter を差し替えるだけで UI に影響を与えない境界分離を維持する。

### 2.3 changedetection.io + sockpuppetbrowser (監視エンジンレイヤー)
- **責務**:
  - スケジュールに基づく定周期の HTTP 取得 / ブラウザレンダリング。
  - DOM 差分の検出およびスナップショット履歴の保存。
  - 変更検知時の `ntfy` への通知送信。

---

## 3. ディレクトリ構成

```text
Dry-eyed/
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
│       ├── routes/          # API エンドポイント (watches, health)
│       └── services/        # changedetection クライアント
│           └── __tests__/   # BFF 単体テスト
│
└── frontend/                # DryEyes UI
    ├── package.json
    ├── vite.config.ts       # Vite 設定 (ポート 3010, /api プロキシ)
    ├── tailwind.config.js
    └── src/
        ├── App.tsx          # メインダッシュボード
        ├── api/             # BFF 呼び出しクライアント
        ├── components/      # UI コンポーネント群 (Header, WatchCard, WatchList, Modals)
        └── __tests__/       # UI 単体テスト
```

---

## 4. 運用・起動構成 (LocalLauncher 連携)

監視の信頼性と開発効率を高めるため、**「監視エンジン（常駐）」と「DryEyes アプリ」を分離して管理** します。

- **changedetection.io**: WSL2 Docker 上でバックグラウンド常駐（定期監視・Cron を維持）。
- **DryEyes アプリ**: UI/BFF の開発時や閲覧時に高速起動。
