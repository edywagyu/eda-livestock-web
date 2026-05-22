# mcp-freee

Claude Code（および MCP 対応クライアント）から **freee 会計 API** を直接叩くためのローカル MCP サーバです。
`eda-livestock-web` リポジトリ専用の構成として `mcp-freee/` 配下にまとまっています。

## できること

リポジトリのルートに置いた `.mcp.json` により、Claude Code をこのリポジトリで起動すると
自動的に `freee` という MCP サーバが立ち上がり、以下のツールが利用可能になります。

| ツール名 | 内容 | エンドポイント |
| --- | --- | --- |
| `freee_companies_list` | 事業所一覧 | `GET /api/1/companies` |
| `freee_partners_list` | 取引先一覧（権限除外時の注意付き） | `GET /api/1/partners` |
| `freee_partner_get` | 取引先取得 | `GET /api/1/partners/{id}` |
| `freee_partner_create` | 取引先作成 | `POST /api/1/partners` |
| `freee_partner_update` | 取引先更新 | `PUT /api/1/partners/{id}` |
| `freee_partner_update_by_code` | コード指定で更新 | `PUT /api/1/partners/code/{code}` |
| `freee_partner_upsert_by_code` | コード指定 upsert | `PUT /api/1/partners/upsert_by_code` |
| `freee_partner_delete` | 取引先削除 | `DELETE /api/1/partners/{id}` |
| `freee_request` | 汎用フォールバック | 任意の `/api/1/...` |

## 2026/07 の freee API 仕様変更（権限制御強化）への対応

freee 会計 API は、2026/07 上旬に取引先（partner）系 API の権限制御が強化されます
（参考: 2026-05-22 アナウンス「【重要】freee会計API仕様変更のお知らせ」）。

- `GET /api/1/partners`：補助権限が無い取引先は応答から **除外** される
- それ以外の partner 系 API：権限が無いと **403** が返る
- `request` / `response` の形式に変更はなし

本 MCP サーバではこの変更に備えて、以下のハンドリングを最初から組み込んでいます。

1. **403 を捕捉して理由付きでツール結果に変換**。Claude Code 側にエラー内容が表示され、
   モデルが「権限不足である」ことを認識できるようにしています
   （`mcp-freee/src/freeeClient.mjs` の `FreeeApiError`）。
2. `freee_partners_list` の応答で `total_count > 返却件数` を検知した場合、
   `_note` フィールドに権限除外の可能性を明記して返します
   （`mcp-freee/src/tools.mjs` の `buildPartnersListNote`）。

## セットアップ

### 1. 依存をインストール

```sh
cd mcp-freee
npm install
```

### 2. アプリ認証情報を `.env` に保存

`.env.example` をコピーして `.env` を作成し、freee アプリストアで取得した値を入れます。

```sh
cp .env.example .env
# エディタで FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI を埋める
```

> **Note**: `FREEE_REDIRECT_URI` は freee アプリ設定で登録した値と完全一致が必要です。
> CLI ベースで完結させたい場合は `urn:ietf:wg:oauth:2.0:oob` を使い、freee アプリ側にも同じ URI を登録しておくと、
> 認可画面でコードがブラウザに直接表示されてコピペで済みます。
>
> `http://localhost:PORT/...` 形式の URI を指定した場合は、`npm run auth` がそのポートで一時 HTTP サーバを立て、
> ブラウザのリダイレクトから `code` を自動で受信します（コピペ不要）。

### 3. リフレッシュトークンを取得

```sh
npm run auth
```

表示された認可 URL をブラウザで開き、アプリ連携を許可。リダイレクト先に表示される `code=...` の値を貼り付けると、
`mcp-freee/.freee-tokens.json`（gitignored, mode 0600）にトークンが保存されます。
以降は自動でリフレッシュされるため再ログインは不要です。

### 4. 接続確認

```sh
npm run check
```

`GET /api/1/companies` を叩いて、認証情報・リフレッシュトークン・通信経路に問題が無いことを検証します。
事業所が 1 件しか無い場合は `FREEE_COMPANY_ID` の設定値も提案してくれます。

### 5.（任意）既定の事業所 ID を設定

Claude Code から毎回 `company_id` を渡したくない場合は、`.env` に次を追加します。

```env
FREEE_COMPANY_ID=1234567
```

`company_id` の取得は Claude Code から直接できます。

```text
freee_companies_list を呼んで、私が所属する事業所 ID を教えて
```

## 動作確認

stdio 越しに直接叩く簡易テスト:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node src/index.mjs
```

ツール一覧が JSON で返ってくれば OK。Claude Code からは
`/mcp` で `freee` サーバが listed になっていることを確認できます。

## Claude Code 上での使い方サンプル

- `freee_partners_list を limit=50 で叩いて、_note があれば内容を教えて`
- `code=CUST-0001 の取引先を freee_partner_upsert_by_code で追加。name は "江田畜産テスト" にして`
- `id=12345 の取引先を freee_partner_get → 取得できなければ 2026/07 の権限制御の影響かも、と伝えて`

## ファイル構成

```
mcp-freee/
├─ package.json
├─ .env.example
├─ .gitignore
├─ README.md
└─ src/
   ├─ index.mjs        # MCP サーバ本体 (stdio)
   ├─ tools.mjs        # ツール定義
   ├─ freeeClient.mjs  # トークン更新・403 ハンドリング込みの HTTP クライアント
   ├─ tokenStore.mjs   # .freee-tokens.json の読み書き
   ├─ oauth.mjs        # 初回認可コード → トークンのヘルパー CLI（oob / localhost 自動）
   └─ check.mjs        # `npm run check` 接続スモークテスト
```
