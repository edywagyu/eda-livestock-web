# 🚀 江田畜産オンラインショップ — デプロイガイド

**最終更新**: 2026-05-12
**対象**: 30名デモ → 本番ローンチまでの完全セットアップ手順

このドキュメントの **「✏️ 必須入力箇所」** を順に埋めれば、Stripe 実決済を含む全機能が動作します。

---

## ✅ デプロイ前チェックリスト

実装済み（完了）:
- [x] HTML / CSS / JavaScript（すべてのページ）
- [x] GAS バックエンド全エンドポイント実装 (`gas/Code.gs`)
- [x] Stripe Checkout / Subscriptions 連携コード
- [x] 法的ページ（プライバシー / 利用規約 / 特商法 / 404）
- [x] エラートラッキング / OGP / robots / sitemap

必須入力（残作業）:
- [ ] **1. Stripe アカウント作成 + API キー取得**
- [ ] **2. Google Apps Script デプロイ + URL 取得**
- [ ] **3. `public/js/eda-config.js` の URL 書き換え**
- [ ] **4. 食肉販売業 許可番号・適格請求書登録番号 を tokushoho.html に記入**
- [ ] **5. GitHub Pages 反映確認**

---

## 1️⃣ Stripe アカウント作成 + 商品登録

### 1-1. アカウント作成 (本人実施)

[Stripe Dashboard](https://dashboard.stripe.com/register) で**江田畜産株式会社**名義のアカウントを作成。
ビジネス情報（法人番号、銀行口座、代表者本人確認書類）が必要です。

> ⚠️ Claude はアカウント作成・本人認証は行えません。Tom さん本人で実施してください。

### 1-2. API キー取得

[Dashboard → 開発者 → API キー](https://dashboard.stripe.com/apikeys)

| キー種別 | 値 |
|---|---|
| 公開可能キー | `pk_live_…` または `pk_test_…` |
| **シークレットキー** | `sk_live_…` または `sk_test_…` ← GAS で使用 |

> **デモは `_test_` キーで開始 → 本番ローンチ時に `_live_` へ切替**を推奨。

### 1-3. 定期便プラン（Subscription Price）登録

[Dashboard → 商品カタログ](https://dashboard.stripe.com/products) から以下3商品を作成：

| 商品名 | 価格（税込） | 課金頻度 | 用途 |
|---|---|---|---|
| Eda Subscription mini | ¥9,800 | 月次 | mini プラン |
| Eda Subscription pro | ¥19,800 | 月次 | pro プラン |
| Eda Subscription VIP | ¥39,800 | 月次 | VIP プラン |

作成後、各商品の **Price ID**（`price_…` で始まる文字列）をメモ。GAS 設定で使用します。

### 1-4. 初月50%OFF クーポン作成

[Dashboard → クーポン](https://dashboard.stripe.com/coupons) で：
- 名称: `初月50%OFF`
- 割引種別: パーセントオフ → **50%**
- 期間: **1回のみ**（最初の請求のみ適用）
- クーポン ID をメモ（例: `WELCOME50`）

### 1-5. Webhook エンドポイント登録

[Dashboard → 開発者 → Webhooks](https://dashboard.stripe.com/webhooks) で新規追加：

- エンドポイント URL: `https://script.google.com/macros/s/{後述のGASデプロイID}/exec?action=stripe_webhook`
- イベント: 以下4種を選択
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`

> Webhook は **GAS デプロイ完了後** に登録します（順序: GAS → Webhook）

---

## 2️⃣ Google Apps Script デプロイ

### 2-1. スプレッドシート作成

[Google Drive](https://drive.google.com/) で新規スプレッドシート `江田畜産_EC_オペレーション` を作成。
URL 末尾の `/d/{ID}/edit` から **スプレッドシート ID** をメモ。

### 2-2. Apps Script プロジェクトを開く

スプレッドシートの **拡張機能 → Apps Script** から GAS エディタを開く。

`コード.gs` を全削除し、本リポジトリの `/gas/Code.gs` を**全文コピペ**して保存。

### 2-3. スクリプトプロパティ設定

GAS エディタの **プロジェクトの設定 → スクリプトプロパティ** で以下を登録：

| プロパティキー | 値 | 取得元 |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` または `sk_live_…` | 1-2 |
| `SPREADSHEET_ID` | スプレッドシートID | 2-1 |
| `STRIPE_PRICE_MINI` | `price_…` | 1-3 mini |
| `STRIPE_PRICE_PRO` | `price_…` | 1-3 pro |
| `STRIPE_PRICE_VIP` | `price_…` | 1-3 VIP |
| `STRIPE_COUPON_50OFF` | `WELCOME50` | 1-4 |
| `SUCCESS_URL` | `https://edywagyu.github.io/eda-livestock-web/order-complete.html?session_id={CHECKOUT_SESSION_ID}` | 固定 |
| `CANCEL_URL` | `https://edywagyu.github.io/eda-livestock-web/checkout.html` | 固定 |
| `STAFF_NOTIFICATION_EMAIL` | `backoffice@eda-livestock.com` | 固定 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | 2-5 取得後に追加 |

### 2-4. 初回セットアップ実行

GAS エディタで `initSheets()` 関数を選択 → **実行**。
シート（orders / customers / subscriptions / otps / 等）が自動作成されます。

### 2-5. デプロイ（ウェブアプリ）

GAS エディタの **デプロイ → 新しいデプロイ** で：
- 種類: **ウェブアプリ**
- 実行ユーザー: **自分**
- アクセスできるユーザー: **全員**（匿名 POST が必要）
- → デプロイ

完了後に表示される **ウェブアプリ URL** をメモ。これが `GAS_URL` です。
例: `https://script.google.com/macros/s/AKfycb…/exec`

### 2-6. ping テスト

ブラウザで `{GAS_URL}?action=ping` にアクセス。
```json
{"ok":true,"ts":"2026-05-12T..","version":"1.0.0"}
```
が返れば成功。

### 2-7. Webhook シークレット取得

Stripe Dashboard で 1-5 の Webhook 編集画面 →
**「シークレットを表示」** → `whsec_…` を取得 → GAS スクリプトプロパティ `STRIPE_WEBHOOK_SECRET` に登録。

---

## 3️⃣ フロントエンドの URL 書き換え

`public/js/eda-config.js` を開き、`GAS_URL` の値を 2-5 で取得した URL に置き換え：

```js
// Before
const GAS_URL = 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec';

// After
const GAS_URL = 'https://script.google.com/macros/s/AKfycb...{あなたのID}.../exec';
```

> このファイルは **全ページで読み込まれる単一の設定ファイル**です。書き換えはここ1箇所のみ。

---

## 4️⃣ 法的表示の最終確認

### 4-1. `tokushoho.html` の必須記入

以下 2 件の `{プレースホルダ}` を実値に置き換えてください：

```html
<!-- 食肉販売業 許可番号 -->
西諸県保健所 食肉販売業 許可番号：<strong>{許可番号を記載してください}</strong>

<!-- 適格請求書 登録番号 -->
登録番号：<strong>T{インボイス制度の登録番号を記載してください}</strong>
```

> 食肉販売業許可番号は **食品衛生法上必須**です。未取得の場合は EC 営業ができません。

### 4-2. 連絡先メールアドレス

すべて `backoffice@eda-livestock.com` に統一済み。LINE は `@706sgiuq`。
変更がある場合は以下を一括置換してください：
- `tokushoho.html` / `privacy.html` / `terms.html` / `mypage.html`

---

## 5️⃣ GitHub Pages 反映

リポジトリは `edywagyu/eda-livestock-web` で運用中。`main` ブランチに push すると 1-3 分で公開反映されます。

```bash
git add -A
git commit -m "deploy: 本番デプロイ準備完了"
git push origin main
```

公開 URL: `https://edywagyu.github.io/eda-livestock-web/`

---

## 6️⃣ デモ前 動作確認チェックリスト

### 6-1. 基本フロー
- [ ] トップページ → SHOP → カート追加 → checkout → Stripe テスト決済 (`4242 4242 4242 4242`) → order-complete 表示
- [ ] subscription.html → プラン選択 → checkout (subscription mode) → Stripe テスト決済 → order-complete
- [ ] mypage.html → メールアドレス入力 → OTP メール受信 → ログイン成功

### 6-2. エッジケース
- [ ] 11,000 円未満で 1,100 円送料表示
- [ ] 11,000 円以上で送料無料表示
- [ ] ギフト複数配送先で +1,100円/件
- [ ] 軽減税率 8% / 10% 区分表示
- [ ] 同意チェックなしで「注文を確定」できない
- [ ] 404 ページに無効URLからリダイレクト

### 6-3. データ確認
- [ ] Stripe Dashboard で決済が記録されている
- [ ] スプレッドシート `orders` シートに行が追加されている
- [ ] `STAFF_NOTIFICATION_EMAIL` に注文通知が届く
- [ ] 顧客の登録メールアドレスに領収書が届く

---

## 7️⃣ デモ → 本番切替時の手順

1. Stripe で `_test_` キーから `_live_` キーへ切替（GAS スクリプトプロパティ更新）
2. Webhook も Live 環境用に再登録
3. テストデータをスプレッドシートからクリア（または別タブにアーカイブ）
4. `error-tracker.js` のログをモニタリング開始

---

## 🆘 トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| `placeOrder is not defined` | `eda-config.js` 読込前にボタン押下 | DOMContentLoaded 待ち or リロード |
| `GAS_URL is not set` | `eda-config.js` の URL 未書き換え | 3️⃣ 実行 |
| Stripe `Invalid API Key` | スクリプトプロパティ未設定 | 2-3 確認 |
| Webhook 200/4xx 不整合 | `STRIPE_WEBHOOK_SECRET` 不一致 | 2-7 再取得 |
| OTP メール届かない | GAS MailApp Quota 超過 | 1日100通の制限あり |
| `customer_lookup` 404 | `customer_lookup` ケース欠落 | Code.gs `doGet` 確認 |

---

## 📌 緊急時の Tom 専用コマンド集

```bash
# キャッシュ強制更新（ブラウザ）
?v=YYYYMMDD-HHMM をURLに付与

# GAS のログ閲覧
GAS エディタ → 実行 → 実行履歴

# Stripe テスト決済データクリア
Stripe Dashboard → 開発者 → テストデータをクリア

# シート初期化
GAS エディタ → initSheets() を再実行
```

---

> 質問・トラブルあれば: Claude にこの GUIDE.md を参照しながら聞けば即対応可能。
