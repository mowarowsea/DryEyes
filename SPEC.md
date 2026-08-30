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
  - `更新検知 (Changed)`: 変更が検知された状態。
  - `エラー (Error)`: サイトアクセス失敗・タイムアウト等（エラー原因を表示）。
  - `停止中 (Paused)`: 一時停止中。
- **新規登録**:
  - URL (必須)
  - 表示名 (任意)
  - **ビジュアル要素ピッカー (Visual Element Picker)**:
    - URLを入力して「画面から要素をタップ選択」を押すと、DevToolsライクなインスペクタープレビューが起動。
    - 画面上の見張りたい要素（価格、在庫、テキスト等）をタップするだけで、一意な **XPath** を自動計算して設定。
    - 「監視対象に設定」または「除外対象に設定」をワンタップで反映。
  - 監視頻度 (5分, 10分, 30分, 1時間, 6時間, 24時間)
  - ntfy 通知トピック (デフォルト: `dryeyes`)
  - 特定要素監視フィルタ (CSS Selector / XPath)
  - 除外要素フィルタ (広告やタイムスタンプの除外)
- **クイック操作**:
  - 即時チェックトリガー（手動再監視）
  - 一時停止 / 再開トグル
  - 変更履歴確認
  - 監視対象の削除

### 2.2 差分検出 & 通知
- **エンジン連携**: `changedetection.io` の差分検出エンジンを利用。
- **通知配信**: `ntfy` サーバー（デフォルト: `http://localhost:8085`）を経由して Android / iOS の ntfy アプリへ即時プッシュ通知。
- **誤検知防止**: ページの取得失敗（HTTPエラー、タイムアウト）を「変更」として誤通知しない。

### 2.3 変更履歴 (History)
- スナップショットのタイムライン表示。
- 過去の変更日時およびスナップショットIDの追跡。

---

## 3. BFF API 仕様書

DryEyes BFF (`http://localhost:3001`) のエンドポイント一覧。

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
    "notificationTopic": "dryeyes",
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

---

## 4. データモデル定義

```typescript
export type FetchBackend = 'html_requests' | 'html_webdriver' | 'html_playwright';

export interface WatchModel {
  id: string;                    // UUID
  url: string;                   // 監視先URL
  title: string;                 // 表示名
  fetchBackend: FetchBackend;    // 通常 (html_requests) または ブラウザ (html_playwright)
  checkIntervalMinutes: number;  // 監視頻度 (分)
  paused: boolean;               // 一時停止フラグ
  lastChecked: number | null;    // 最終チェック時刻 (UNIX秒)
  lastChanged: number | null;    // 最終変更時刻 (UNIX秒)
  hasError: boolean;             // エラー有無
  lastError: string | null;      // エラーメッセージ
  includeFilters: string[];      // 監視対象セレクタ一覧
  subtractedFilters: string[];   // 除外セレクタ一覧
  notificationTopic: string;     // ntfy トピック名
  tag?: string;                  // タグ/カテゴリ
}
```
