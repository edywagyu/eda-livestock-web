# EDA Livestock — GAS Backend Schema

**最終更新**: 2026-05-12
**用途**: Web (shop / subscription / checkout / dashboard) ↔ GAS ↔ Google Sheets 間のデータ契約

---

## 🎯 設計原則

1. **STAFF と DASHBOARD で役割分離**
   - **STAFF (`staff.html`)**: モバイル特化・現場用 — **在庫編集 / 商品編集**のみ
   - **DASHBOARD (`dashboard.html`)**: PC 経営ビュー — **読取専用集計** / CRM / アンケート分析
2. **Google Sheets が唯一の真実 (Source of Truth)**
   - フロントの localStorage は **キャッシュ + 一時保持** のみ
   - 注文確定・アンケート・クイズ・LINE はすべて POST で Sheets へ追記
3. **fire-and-forget 通信**
   - GAS への送信は `fetch().catch(()=>{})` で失敗を握り潰す
   - UI のレスポンスを止めない（後で再送可能なログ設計）

---

## 📡 エンドポイント一覧

### 🔵 GET (読取系)

| Action | パラメータ | 用途 | 呼び出し元 |
|--------|-----------|------|----------|
| `ping` | — | 接続確認 / バージョン取得 | dashboard.html |
| `public_products` | — | 公開商品一覧 (shop表示用) | shop.html |
| `dashboard` | `range=30d` | KPI 集計 | dashboard.html |
| `orders` | `from`, `to`, `mode` | 注文一覧 | dashboard.html |
| `order_status` | `session_id` or `order_number` | 注文照会 | order-complete.html |
| `subscriptions` | `status=active` | 定期便メンバー | dashboard.html |
| `customers` | `segment` | 顧客マスタ | dashboard.html |
| `customer_lookup` | `email` or `phone` | 顧客検索 | mypage.html |
| `survey_responses` | `from`, `to` | アンケート集計 | dashboard.html |
| `quiz_responses` | `from`, `to` | クイズ回答集計 | dashboard.html |
| `line_friends` | — | LINE 友だち数・属性 | shop.html (バナー), dashboard.html |
| `shipments` | `status` | 配送ステータス | dashboard.html |
| `staff_inventory` | — | 在庫マスタ | staff.html |
| `export_csv` | `kind=orders\|customers\|...` | CSV 出力 | dashboard.html |

### 🟡 POST (書込系)

| Action | Body | 用途 | 呼び出し元 |
|--------|------|------|----------|
| `submit_order` | order payload (下記) | **注文確定** → Sheets 書込 | checkout.html `placeOrder()` |
| `submit_quiz` | quiz answers | 診断回答ログ | shop.html `renderResult()` |
| `submit_survey` | survey answers | 注文後アンケート | order-complete.html |
| `log_subscription_application` | sub app | 定期申込開始ログ | subscription.html `handleSubmit()` |
| `staff_update_inventory` | `{variantId, stock}` | 在庫更新 | staff.html |
| `staff_upsert_product` | product master | 商品マスタ更新 | staff.html |
| `stripe_webhook` | Stripe event | 決済確定 | Stripe → GAS |
| `line_webhook` | LINE webhook | 友だち追加 / メッセージ | LINE Bot |

---

## 📦 Payload 仕様

### `submit_order` (POST)

```json
{
  "order_number": "EDA-ABC123",
  "mode": "single | subscription | gift | subandadd | multi",
  "placed_at": "2026-05-12T10:30:00.000Z",
  "customer": {
    "name": "田中 太郎",
    "email": "tanaka@example.com",
    "phone": "090-1234-5678",
    "zip": "150-0001",
    "pref": "東京都",
    "address": "渋谷区神宮前 1-2-3"
  },
  "destinations": [
    {
      "type": "self | gift",
      "name": "...", "tel": "...", "zip": "...", "pref": "...", "address": "...",
      "noshi": "御中元",
      "fromName": "田中 太郎",
      "message": "お祝いに",
      "items": [
        { "variantId": "...", "title": "...", "variant": "...", "price": 3400, "qty": 2 }
      ]
    }
  ],
  "subscription": { "plan": "regular" } | null,
  "payment_method": "card | apple | bank",
  "total": 12800,
  "quiz": { ... } // クイズ回答が紐付くなら同梱
}
```

→ GAS は以下のシートに分割して書き込み：
- `orders` (1 行 / 注文)
- `order_items` (N 行 / 注文)
- `order_destinations` (N 行 / 注文)

### `submit_quiz` (POST)

```json
{
  "answers": ["fam_34", "freq_high", "meat_both", "use_kids", "budget_mid"],
  "fam": "fam_34", "freq": "freq_high", "meat": "meat_both",
  "use": "use_kids", "budget": "budget_mid",
  "ts": 1715508600000,
  "sessionId": "q-1715508600-xyz"
}
```

→ `quiz_responses` シートに追記。`sessionId` で後の注文と紐付け可能。

### `submit_survey` (POST)

```json
{
  "session_id": "cs_xxx",
  "order_number": "EDA-ABC123",
  "organic": "YES | NO | MAYBE",
  "source":  "Instagram | 友人紹介 | 検索 | LINE広告 | その他",
  "meats":   ["牛サーロイン", "鶏もも"]
}
```

→ `survey_responses` シートに追記。

### `log_subscription_application` (POST)

```json
{
  "plan": "regular",
  "customer": { ... },
  "addons": [{ "id": "sirloin", "qty": 1 }],
  "ts": 1715508600000
}
```

→ `subscription_applications` シートに追記（決済前の意思表示記録）。

---

## 📊 Google Sheets タブ構造

### 1. `orders`
| 列 | 型 | 説明 |
|----|------|------|
| order_number | string | 注文番号 (一意) |
| placed_at | datetime | 注文日時 |
| customer_id | string | customers シートへのFK |
| customer_name | string | 表示用キャッシュ |
| mode | string | single / subscription / gift / ... |
| payment_method | string | card / apple / bank |
| total | number | 合計金額 |
| stripe_session_id | string | Stripe Checkout Session ID |
| shipping_status | string | pending / shipped / delivered |
| tracking_number | string | ヤマト追跡番号 |

### 2. `order_items`
| 列 | 説明 |
|----|------|
| order_number | FK |
| variant_id | 商品 variantId |
| sku | 商品コード |
| title | 表示名 |
| unit_price | 単価 |
| qty | 数量 |
| destination_idx | 0=自宅 / 1+=ギフト送り先 |

### 3. `order_destinations`
| 列 | 説明 |
|----|------|
| order_number | FK |
| idx | 0..N |
| type | self / gift |
| name | 受取人氏名 |
| tel, zip, pref, address | 住所詳細 |
| noshi, from_name, message | ギフト用 |

### 4. `subscriptions`
| 列 | 説明 |
|----|------|
| subscription_id | 一意 |
| customer_id | FK |
| plan | starter / regular / volume |
| started_at | 開始日 |
| status | active / paused / cancelled |
| next_delivery | 次回お届け日 (毎月1日) |
| total_deliveries | 累計回数 |
| churn_at | 解約日 |

### 5. `customers`
| 列 | 説明 |
|----|------|
| customer_id | 一意 |
| name, email, phone, zip, pref, address | 基本情報 |
| line_uid | LINE userId (紐付け済) |
| segment | new / repeater / vip / dormant |
| total_spent | 累計購入額 |
| order_count | 累計注文数 |
| first_order | 初回購入日 |
| last_order | 最終購入日 |
| survey_organic | アンケート: YES/NO/MAYBE |
| survey_source | 流入元 |
| survey_meats | 好む肉 (カンマ区切り) |
| quiz_session_id | クイズ回答 ID |

### 6. `survey_responses`
| 列 | 説明 |
|----|------|
| ts | 回答日時 |
| order_number | FK |
| customer_id | FK |
| organic | YES/NO/MAYBE |
| source | チャネル |
| meats | カンマ区切り |

### 7. `quiz_responses`
| 列 | 説明 |
|----|------|
| ts | 回答日時 |
| session_id | クイズセッション ID |
| customer_id | 後で紐付け可能 (null初期) |
| fam, freq, meat, use, budget | 5問の回答 |
| suggested_plan | ロジック提案プラン |
| converted_to_order | 実際の購入 FK (null初期) |

### 8. `line_events`
| 列 | 説明 |
|----|------|
| ts | イベント日時 |
| line_uid | LINE userId |
| event_type | follow / unfollow / message / postback |
| display_name | LINE 表示名 |
| message_text | （メッセージの場合）|
| campaign_id | （配信トリガー時）|

### 9. `shipments`
| 列 | 説明 |
|----|------|
| order_number | FK |
| tracking_number | ヤマト |
| shipped_at | 出荷日 |
| eta | 到着予定 |
| delivered_at | 配達完了日 |
| status | shipped / in_transit / delivered / issue |

### 10. `daily_kpi`
| 列 | 説明 |
|----|------|
| date | 日付 |
| revenue | 日次売上 |
| orders | 注文件数 |
| new_customers | 新規顧客数 |
| new_line_friends | 友だち追加数 |
| quiz_completions | クイズ完了数 |
| sub_active | アクティブ定期数 |
| sub_churned | 解約数 |

→ **cron で毎日 00:00 に自動生成** (GAS Time Trigger)

---

## 🔄 日次更新フロー

```
┌────────────────────────┐
│  WEB EVENTS            │
│  - submit_order        │──→ orders / order_items / order_destinations
│  - submit_quiz          │──→ quiz_responses
│  - submit_survey        │──→ survey_responses
│  - log_sub_application  │──→ subscription_applications
└────────────────────────┘
            ↓
┌────────────────────────┐
│  STRIPE WEBHOOK         │──→ orders.shipping_status = 'paid'
│  - checkout.completed   │
│  - subscription.created │──→ subscriptions テーブル更新
│  - subscription.deleted │
└────────────────────────┘
            ↓
┌────────────────────────┐
│  LINE WEBHOOK           │──→ line_events
│  - follow / unfollow    │
│  - message              │──→ customers.line_uid 紐付け
└────────────────────────┘
            ↓
┌────────────────────────┐
│  ヤマト API (将来)      │──→ shipments.status / delivered_at
└────────────────────────┘
            ↓
┌────────────────────────┐
│  DAILY CRON (00:00)     │
│  - daily_kpi 生成        │
│  - customers.segment 再計算 (休眠化など)
│  - subscription_applications → subscriptions 昇格
└────────────────────────┘
```

---

## 🛡 役割境界

| ファイル | 役割 | デバイス | 編集権限 |
|----------|------|---------|---------|
| `staff.html` | 現場運用 (在庫変更・商品マスタ編集) | モバイル特化 | 書込 (?action=staff_update_*) |
| `dashboard.html` | 経営ビュー (KPI / CRM / 分析) | PC ブラウザ | **読取専用** |
| `mypage.html` | 顧客マイページ | 全デバイス | 自分の注文のみ |
| Google Sheets | データ実体 | — | GAS 経由でのみ |

---

## 🔧 開発者メモ

- `localStorage.eda-gas-url` を全ページで共有して GAS URL を一元管理
- 初回設定: dashboard.html → ⚙️設定 → URL貼り付け → 全ページに伝播
- `?action=ping` は最小実装でOK：`{ "ok": true, "version": "2026.05" }`
- CORS: GAS で `Access-Control-Allow-Origin: *` を返す
- 認証: 必要ならクエリストリングに `apiKey` を含める（簡易）
