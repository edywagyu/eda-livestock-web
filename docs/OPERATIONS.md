# 江田畜産 EC 運用マニュアル

最終更新: 2026-05-17

---

## 📊 全体構成

```
┌─────────────────────────────────────────────────────────────┐
│                   顧客 (一般人)                              │
│                       ↓                                      │
│  shop.html (商品一覧) ←──── shop ────→ checkout.html (決済)  │
│       ↑                                      ↓               │
│       │                                  Stripe Checkout     │
│       │                                      ↓               │
│       │                                  Stripe Webhook      │
│       │                                      ↓               │
└───────┼──────────────────────────────────────┼───────────────┘
        │                                      │
        │ GAS Web App (バックエンド)            │ 注文記録
        │                                      ↓
        └────→ Google スプシ ←─────────────────┘
                  ↑
                  │ 編集
        ┌─────────┴─────────┐
        │                   │
   STAFF アプリ           Tom 直接編集
   (モバイル UI)          (スプシ アプリ)
```

---

## 🌐 URL 一覧 (全部ブックマーク推奨)

### 表側 (顧客向け)
| 用途 | URL |
|---|---|
| 🛍️ ショップ (商品一覧) | https://edywagyu.github.io/eda-livestock-web/shop.html |
| 🏠 ホーム | https://edywagyu.github.io/eda-livestock-web/ |
| 📦 ギフトページ | https://edywagyu.github.io/eda-livestock-web/shop.html#gift-highlight |
| 📅 定期便 | https://edywagyu.github.io/eda-livestock-web/subscription.html |
| 🛒 カート | https://edywagyu.github.io/eda-livestock-web/checkout.html |

### 裏側 (Tom / STAFF 用)
| 用途 | URL |
|---|---|
| 👨‍💼 STAFF アプリ (モバイル) | https://edywagyu.github.io/eda-livestock-web/staff.html |
| 📊 商品マスター スプシ | https://docs.google.com/spreadsheets/d/1kMLksRzJRFMKXotwF8IILZJlgUcjpxI84lRZoEBaOMo/edit |
| ⚙️ GAS エディタ | https://script.google.com (→「江田畜産_EC_API」プロジェクト) |
| 💳 Stripe Dashboard | https://dashboard.stripe.com |
| 📦 配送ラベル スプシ (国内発送) | https://docs.google.com/spreadsheets/d/1tNbIvsTkqrJiWtgpKCHevs_qeVjfNny0FPEsqTtxruM/edit |

---

## 🎯 「これがしたい → どこで何をする」一覧

### 商品関連

| やりたいこと | 場所 | 操作 |
|---|---|---|
| 在庫数を変える (素早く) | 📱 STAFF アプリ → 商品タブ | ± ボタン → 保存 |
| 価格を変える | 📊 スプシ products タブ または STAFF | `price` 列を書き換え |
| 商品名を変える | 📊 スプシ products タブ | `name` 列を書き換え |
| 商品説明を変える | 📊 スプシ products タブ | `description` 列を書き換え |
| 商品の画像を変える | 📊 スプシ products タブ | `image` 列 (パス) を書き換え |
| 一時的に非公開にする | 📊 スプシ products タブ | `published` を `FALSE` に |
| 在庫切れ表示にする | 📊 スプシ products タブ | `stock` を `0` に |
| 新商品を追加する | 📱 STAFF アプリ → 商品 → 「新商品を登録」 | フォーム入力 (Stripe Price ID 必須) |
| Stripe Price ID を取得 | 💳 Stripe Dashboard → 商品 → 価格作成 | 「価格 ID」をコピー |
| 商品を削除する | 📊 スプシ products タブ | 行ごと削除 |

### ギフト (松/竹/梅) 関連

| やりたいこと | 場所 | 操作 |
|---|---|---|
| ギフト価格変更 | 📱 STAFF → 🎁 ギフト → タップ | フォーム編集 → 保存 |
| ギフト名変更 | 📱 STAFF → 🎁 ギフト | 同上 |
| ギフトの説明変更 | 📱 STAFF → 🎁 ギフト | 同上 |
| 新ギフト追加 (例: 特上松など) | 📱 STAFF → 🎁 ギフト → 「新ギフトを追加」 | フォーム入力 |
| 一時的に非公開 | 📱 STAFF → 🎁 ギフト | `公開ステータス` → `下書き` |

### 定期便プラン関連

| やりたいこと | 場所 | 操作 |
|---|---|---|
| プラン価格変更 | 📱 STAFF → 📅 定期便 → タップ | 通常価格 / 初月価格 編集 |
| プラン内容変更 (お肉の構成) | 📱 STAFF → 📅 定期便 | `含まれる商品` (カンマ区切り) を編集 |
| 「人気No.1」フラグ切替 | 📱 STAFF → 📅 定期便 | `featured` を変更 |
| バッジ文字変更 (VIP特典 等) | 📱 STAFF → 📅 定期便 | `badgeLabel` を編集 |
| 新プラン追加 | 📱 STAFF → 📅 定期便 → 「新プラン追加」 | フォーム入力 |

### 注文・出荷関連

| やりたいこと | 場所 | 操作 |
|---|---|---|
| 今日の注文一覧を見る | 📱 STAFF → 注文タブ | リスト表示 |
| 出荷ステータス更新 | 📱 STAFF → 注文 → 注文タップ | 「発送済み」ボタン |
| 出荷後、追跡番号入力 | 📱 STAFF → 注文 → 詳細 | 追跡番号入力欄 |
| ヤマトB2 CSV ダウンロード | 📱 STAFF → ホーム → 配送ラベルCSV | クリックでダウンロード |
| Stripe 決済確認 | 💳 Stripe Dashboard → 取引 | 一覧表示 |
| 返金処理 | 💳 Stripe Dashboard → 取引 → 該当 → 返金 | Stripe 直接 |

### 顧客関連

| やりたいこと | 場所 | 操作 |
|---|---|---|
| 顧客一覧 | 📱 STAFF → 顧客タブ | リスト表示 |
| 顧客セグメント (VIP/休眠等) | 📱 STAFF → 顧客 → セグメント | ピル選択 |
| LINE 配信用 CSV エクスポート | 📱 STAFF → 顧客 → ダウンロード | CSV 出力 |

---

## 📊 スプシ構造 (商品マスター)

URL: https://docs.google.com/spreadsheets/d/1kMLksRzJRFMKXotwF8IILZJlgUcjpxI84lRZoEBaOMo/edit

### タブ構成

| タブ名 | 用途 | 行数 |
|---|---|---|
| `products` | 通常商品マスター (23件) | 牛肉/鶏肉/有機JAS和牛 |
| `gifts` | ギフト商品 (3件) | 松/竹/梅 |
| `subscription_plans` | 定期便プラン (3件) | ミニ/プロ/VIP |
| `orders` | Stripe からの注文 (自動投入) | webhook |
| `customers` | 顧客情報 | 自動投入 |
| `subscriptions` | 定期便契約者 | 自動投入 |
| `invoices` | 請求書履歴 | 自動投入 |
| `_logs` | システムログ | デバッグ用 |

### products タブの列 (左→右)

| 列 | 例 | 編集頻度 |
|---|---|---|
| productId | P001 | 🟢 新商品のみ |
| variantId | SIRLOIN | 🟢 新商品のみ |
| sku | EDA-SIRLOIN-200 | 🟢 新商品のみ |
| stripePriceId | price_1TW74... | 🟢 新商品のみ |
| name | サーロインステーキ | 🟡 たまに |
| variant | 1枚 200g | 🟡 たまに |
| price | 3400 | 🔴 よく変える |
| weight | 200 | 🟢 ほぼ固定 |
| stock | 18 | 🔴 毎日 |
| temp | 冷凍 | 🟢 固定 |
| category | beef | 🟢 固定 |
| categoryLabel | 牛肉 | 🟢 固定 |
| tagEn | Sirloin Steak | 🟢 固定 |
| description | 背中のロース芯の最上部... | 🟡 たまに |
| image | public/images/products/drive/sirloin.jpg | 🟢 たまに |
| isOrganic | FALSE | 🟢 固定 |
| comingSoon | FALSE | 🟢 固定 |
| published | TRUE | 🔴 公開切替 |

### gifts タブの列

| 列 | 例 |
|---|---|
| giftId | matsu |
| name | ヒレステーキ ギフト【松】 |
| badgeText | 松 |
| price | 16800 |
| weight | 450 |
| description | 希少部位のヒレを 450g... |
| stripePriceId | price_1TW74... |
| image | public/images/products/drive/fillet.jpg |
| servings | 3-4人前 |
| noteHtml | `<strong>のし対応</strong>...` |
| published | TRUE |

### subscription_plans タブの列

| 列 | 例 |
|---|---|
| planId | mini |
| name | ミニプラン |
| target | 1-2人家族 |
| spec | 1.6kg・8品 |
| oldPrice | 6980 |
| firstMonthPrice | 3490 |
| savings | 3490 |
| stripePriceId | price_1TWAN0... |
| items | 赤身スライス 200g, 赤身焼肉 200g, ... |
| featured | TRUE (人気No.1) |
| badgeLabel | 人気 No.1 |
| vipPerk | (VIP のみ) 有機JAS 黒毛和牛 優先案内... |
| image | public/images/products/drive/red-meat.jpg |
| published | TRUE |

---

## ⚙️ GAS (Apps Script) 設定情報

プロジェクト名: **江田畜産_EC_API**
URL: https://script.google.com → プロジェクト一覧から選択

### Web App デプロイ URL (公開・認証無し)
```
https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec
```

### スクリプトプロパティ
| キー | 用途 | 設定済み? |
|---|---|---|
| SPREADSHEET_ID | バックエンドスプシ ID | ✅ 1kML... |
| STRIPE_SECRET_KEY | Stripe API キー (sk_live_) | ⚠️ Tom 設定要 |
| STRIPE_PRICE_MINI | 定期便ミニのStripe ID | ✅ |
| STRIPE_PRICE_PRO | 定期便プロのStripe ID | ✅ |
| STRIPE_PRICE_VIP | 定期便VIPのStripe ID | ✅ |
| SUCCESS_URL | 決済成功後リダイレクト | ✅ |
| CANCEL_URL | 決済キャンセル後リダイレクト | ✅ |
| STAFF_NOTIFICATION_EMAIL | 注文通知メール先 | ✅ backoffice@... |

### Code.gs を更新するには
1. https://script.google.com → 「江田畜産_EC_API」を開く
2. https://raw.githubusercontent.com/edywagyu/eda-livestock-web/main/gas/Code.gs から最新コピー
3. Code.gs の中身を全選択 → 削除 → 貼り付け → 保存
4. 「デプロイ」→「デプロイを管理」→ アクティブ横の ✏️
5. バージョン:「新しいバージョン」→ デプロイ

URL は変わらないのでコード側更新不要。

---

## 💳 Stripe Dashboard で頻繁にやること

URL: https://dashboard.stripe.com

| やりたいこと | 場所 | 手順 |
|---|---|---|
| 売上確認 | ホーム | グラフで日別売上 |
| 個別取引確認 | 取引 → 支払い | 検索 |
| 返金処理 | 該当取引 → ... メニュー → 返金 | 全額/一部選択 |
| 新商品登録 (新Stripe Price作成) | 商品 → 新規商品 | 名前/価格 → 作成 |
| → そのPrice IDをコピー | 商品詳細 → 価格 | コピー |
| → スプシの stripePriceId に貼る | 📊 products タブ | 該当行 |
| 定期便契約者一覧 | 顧客 → サブスクリプション | リスト |
| 失敗した決済確認 | 取引 → 失敗 | 原因確認 |

---

## 🚨 トラブル時の対処

### 「shop.html で商品が表示されない」
1. ブラウザのスーパーリロード (Cmd+Shift+R)
2. それでも NG → sessionStorage クリア (F12 → Application → Storage Clear)
3. それでも NG → GAS URL 動作確認:
   ```
   https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec?action=public_catalog
   ```
   → `{ok:true, products:[...], ...}` が返れば GAS OK

### 「STAFF で保存しても shop.html に反映されない」
1. 反映は **5 分以内** (sessionStorage キャッシュ)
2. 即時確認は URL に `?fresh=` 付けて開く
3. それでも NG → スプシで実際に値が更新されているか確認
4. それでも NG → GAS デプロイ版が古い可能性 (Code.gs 更新後デプロイ忘れ)

### 「Stripe で決済できない / カードエラー」
1. STRIPE_SECRET_KEY が設定済みか check_config で確認:
   ```
   .../exec?action=check_config
   ```
2. 未設定なら GAS Properties に追加 (このマニュアルの GAS 章参照)

### 「STAFF アプリで「通信エラー」」
1. GAS Web App URL が staff.html に正しく入ってるか
2. localStorage の `eda-staff-gas-url` を一度クリア (デフォルトURLに戻る)

---

## 📅 月次・定期作業

| 頻度 | やること | 場所 |
|---|---|---|
| 毎日 | 注文確認 + 出荷ステータス更新 | 📱 STAFF |
| 週1回 | 在庫数チェック (低在庫の補充判断) | 📱 STAFF |
| 月1回 | 売上レポート確認 | 💳 Stripe Dashboard |
| 月1回 | 顧客セグメント確認 (休眠への施策) | 📱 STAFF → 顧客 |
| 必要時 | 新商品追加 / 価格改定 | 📊 スプシ または 📱 STAFF |
| 必要時 | キャンペーン投入 | 📱 STAFF → キャンペーンタブ |

---

## 🎓 Tom さん向け Tips

1. **編集は基本スプシ直接が最速** (一括処理・コピペ・数式が使える)
2. **モバイルで在庫だけサクッと変えたい時は STAFF アプリ**
3. **新商品追加** = Stripe で価格作成 → スプシに行追加 (順序大事)
4. **画像は GitHub の `public/images/products/drive/` に置く** (新画像追加は git push 必要)
5. **shop.html のキャッシュは 5 分** — 急ぐ時は `?fresh=` 付き URL

---

質問があれば Claude に「OPERATIONS.md を見て」と言えば、これを参照して回答します。
