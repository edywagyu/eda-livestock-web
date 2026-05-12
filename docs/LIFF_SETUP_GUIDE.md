# 📱 LINE LIFF 認証セットアップガイド

**目的**: マイページの認証を **公式 LINE ログイン (LIFF)** に切替
**所要時間**: 約 15 分

---

## ✅ 完了条件

- マイページに入る = **LINE 認証必須**
- LINE 公式アカウントから入る → **自動でアカウント特定**
- 過去ご注文者 → 注文履歴・定期便を即表示
- 新規 LINE ユーザー → **メールで連携** すると即注文履歴と紐付き
- 外部ブラウザ直アクセス → **LINE 公式へ誘導**

---

## 📋 Tom さん作業 (3 ステップ)

### Step 1: LINE Developers Console で LIFF アプリ作成 (約 10 分)

#### 1-1. LINE Developers にログイン

```
https://developers.line.biz/console/
```

LINE アカウント (Tom さん私用 OK) でログイン。

#### 1-2. プロバイダー作成 (未作成の場合)

「**作成**」→ プロバイダー名: `江田畜産株式会社` → 作成

#### 1-3. チャネル作成

プロバイダー画面で「**新規チャネル作成**」→ チャネルタイプ: **LINE Login**

| 項目 | 値 |
|---|---|
| チャネル名 | `Eda マイページ認証` |
| チャネル説明 | 江田畜産マイページ用 LINE Login |
| アプリタイプ | **ウェブアプリ** にチェック |
| メールアドレス | `backoffice@eda-livestock.com` |

→ 「**LINE 開発者契約に同意**」「**LINE Login の利用規約に同意**」 → 作成

#### 1-4. LIFF タブ → LIFF アプリ追加

作成したチャネル → **LIFF タブ** → 「**追加**」

| 項目 | 値 |
|---|---|
| LIFF アプリ名 | `マイページ` |
| サイズ | **Full** (画面全体使用) |
| エンドポイント URL | `https://edywagyu.github.io/eda-livestock-web/mypage.html` |
| Scope | **profile** にチェック (✓必須) |
| ボットリンク機能 | **On (Aggressive)** (友だち追加促進) |

→ 「**追加**」

#### 1-5. **LIFF ID をコピー**

作成後の画面に表示される **LIFF ID** (形式: `1234567890-AbcdEfgh`) をメモ。

---

### Step 2: LIFF ID をサイトに反映 (1 分)

`public/js/eda-config.js` の `LIFF_ID: ''` に貼り付け:

```js
LIFF_ID: '1234567890-AbcdEfgh',   // ← Step 1-5 で取得した値
```

私 (Claude) に値を教えてもらえれば、即書き換え + push します。

---

### Step 3: LINE 公式アカウントにマイページリンクを設置 (2 分)

LINE 公式アカウント Manager → **リッチメニュー** または **メッセージ** に以下を追加:

```
https://liff.line.me/{LIFF_ID}
```

例: `https://liff.line.me/1234567890-AbcdEfgh`

このリンクからアクセス → LIFF が起動 → 自動で LINE 認証完了。

---

## 🔄 動作フロー

```
[A. LINE 内アクセス (公式アカウントのリンク経由)]
   ↓
LIFF 自動起動 → liff.getProfile() で userId/displayName 取得
   ↓
GAS line_login に POST
   ↓
customers.line_uid 検索
   ├─ HIT  → 注文履歴 + 定期便 表示 ✅
   └─ MISS → アカウント連携フォーム
              ↓ メール入力
            customers から該当注文検索 + line_uid 紐付け
              ↓
            注文履歴 + 定期便 表示 ✅

[B. 外部ブラウザ直アクセス]
   ↓
"LINE 公式アカウントから入って" 画面 + QR/リンク
   ↓
LINE 公式へ誘導
```

---

## 🛠 既に実装済みのもの

- ✅ `mypage.html`: LIFF SDK + 状態管理 (loading / external / authenticating / linkAccount)
- ✅ `public/js/eda-config.js`: `LIFF_ID` 設定枠
- ✅ `gas/Code.gs`:
  - `line_login` (POST): userId → customer 検索
  - `line_link_account` (POST): email → line_uid 紐付け
  - `upsertCustomer`: 注文時に line_uid を自動保存
- ✅ `checkout.html`: 注文時に LINE セッション (line_uid) を Stripe metadata に保存
- ✅ Sheets `customers`: `line_uid` `line_name` `linked_at` 列を自動追加

---

## ❓ Q&A

**Q: 顧客が初めて Shop で買って checkout 時 LINE ログインしてない場合は?**
A: メール orders のみ保存。後で LINE 公式から mypage 入った時、`メールで連携` フォームに当該メール入力 → 自動紐付き。

**Q: メール認証 (OTP) は完全廃止?**
A: フロントUI は LINE 専用。GAS の `request_otp` / `verify_otp` は残置 (今後の管理用途で再活用可)。

**Q: 既に 30 名デモテスター用にメール OTP 動いてた**
A: それは LIFF_ID 未設定時の挙動。LIFF_ID 設定後はLINE flowへ完全移行。

---

## ⚠️ 重要

LIFF_ID 設定前は、外部アクセス画面 (Step A) が表示されます。LIFF_ID 反映後にフル動作します。
