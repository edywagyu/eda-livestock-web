# 商談予約システム セットアップガイド

## 概要

`booking.html` は **Tom のカレンダーへの予約専用ページ**です。
お客さんは以下の3経路から予約できます：

1. **ブランド予約ページ** (推奨): `https://edywagyu.github.io/eda-livestock-web/booking.html`
   - 国内/海外バイヤー選択 → カレンダー → フォーム → 確認メール
   - **要 GAS デプロイ + Calendar ID 設定**

2. **Google 純正予約ページ** (フォールバック): `https://calendar.app.google/DjKHsVDhJHesaPM27`
   - すでに動作中。Tom が Google Calendar で設定済み
   - ブランド予約ページからもリンク済 (ヘッダ「Google カレンダー直接予約も可」)

3. **モバイルメニュー**: 全ページの右上「☰」→「📅 商談予約 / Book」

---

## 受付時間

**全バイヤー: 日本時間 6:00 – 24:00（1時間スロット）**

- 最小リードタイム: 3日（72時間）後以降
- 1スロット: 1時間
- Tom のプライマリカレンダー (`tomoki@eda-livestock.com`) と双方向同期
  - Google 純正リンク (calendar.app.google) からの予約も自動で busy 扱い
  - Tom 自身がカレンダーに予定を入れたスロットも自動でblock

---

## Tom が必要な作業（A or B を選択）

### Option A: Google 純正リンクだけで運用（最速・推奨）

何もしなくていい。すでに `calendar.app.google/DjKHsVDhJHesaPM27` が動いている。
お客さんへ送るリンクをこちら一本に統一する。

**メリット**:
- 設定不要
- Google 公式品質 (時差対応 / Outlook 連携など)

**デメリット**:
- ブランディングなし（Google の汎用UI）
- バイヤータイプ分類なし
- 確認メールが英語混じり

### Option B: 自前ブランド予約ページを運用

**Tom がやる作業 (合計 約15分):**

#### 1. Google Apps Script プロジェクト作成

1. https://script.google.com/ → 新規プロジェクト
2. プロジェクト名: `EDA-Booking-API`
3. `appsscript.json` を `gas-booking/appsscript.json` の内容で上書き
4. `Code.gs` を `gas-booking/BookingApi.gs` の内容で上書き

#### 2. Script Properties 設定

プロジェクト設定 → スクリプトプロパティ → 以下を追加:

| キー | 値 | 用途 |
|------|-----|------|
| `CALENDAR_ID` | `tomoki@eda-livestock.com` | 予約イベント作成先 |
| `NOTIFICATION_EMAIL` | `tomoki@eda-livestock.com` | 新規予約通知の送信先 |

#### 3. デプロイ

「デプロイ → 新しいデプロイ」
- 種類: ウェブアプリ
- 実行者: 自分 (`tomoki@eda-livestock.com`)
- アクセス: 全員

→ 発行された URL（`https://script.google.com/macros/s/AKfycb.../exec`）をコピー

#### 4. booking.html の API URL を差し替え

`booking.html` 内 (約 L4010 あたり):
```js
var BOOKING_API_URL = 'https://script.google.com/macros/s/AKfycb...REPLACE/exec';
```

を Tom が取得した URL に置換 → コミット → push → 反映

#### 5. テスト

1. https://edywagyu.github.io/eda-livestock-web/booking.html を開く
2. 国内 or 海外 を選択
3. 4日後以降の日付・時間を選択
4. ダミーで自分のメールで予約 → カレンダーに入るか確認

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 「Loading…」のまま空き枠が出ない | GAS 未デプロイ / API URL 間違い | `BOOKING_API_URL` を再確認 |
| 「This time slot is no longer available」 | カレンダーに既存予定 | Tom 側で時間ずらすか別スロット選択 |
| 確認メール届かない | MailApp Quota / SPF 設定 | GAS の「実行数」で確認 |
| 表示時間がズレる | ブラウザのタイムゾーン | `tz` パラメータ手動指定可 |

---

## 切り替え方針（推奨タイムライン）

```
今すぐ:
  → Option A で運用開始（calendar.app.google を送る）
  → お客さん体験を観察

1〜2週間後:
  → Option B のGASデプロイ + テスト
  → 問題なければお客さんへの案内URLを booking.html に切替

将来:
  → calendar.app.google リンクは booking.html のヘッダにある「直接予約」リンクとして残す
  → モバイル/Outlook連携が必要なお客さんはGoogle純正を使える
```
