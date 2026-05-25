# 江田畜産 Web — 本番デプロイ チェックリスト

> `fix/qa-feedback-deploy` ブランチに含まれる全変更を本番反映するための手順。
> 上から順に実行すれば 10分以内 で完全本番化できます。

---

## 🎯 ステップ 1: GitHub PR マージ (2分)

### 操作
1. ブラウザで開く: **https://github.com/edywagyu/eda-livestock-web/pull/new/fix/qa-feedback-deploy**
2. 「Create pull request」ボタン
3. タイトル確認 → 「Merge pull request」→ 「Confirm merge」

### 確認
- [ ] GitHub Actions / Pages のビルドが緑チェック
- [ ] 1〜2分後に https://edywagyu.github.io/eda-livestock-web/ にアクセス
- [ ] ナビに **Book** リンクが追加されている (右上から3番目)
- [ ] global.html を開いて Hero に黄金「Book a 30-min Call」ボタンが見える
- [ ] スクロールすると下部に Sticky CTA バーが出現
- [ ] press.html / restaurants.html / about.html でも同様

---

## 🎯 ステップ 2: GAS 追加コード ペースト (5分)

### 操作
1. https://script.google.com/ を開く → 江田畜産プロジェクト選択
2. **Code.gs** タブを開く
3. `gas/Code_v2_Additions.gs` (リポジトリ内) を開いてコピー
4. Code.gs の **末尾** に貼り付け
5. `Code.gs` の `doGet(e)` 内 switch 文に **下記 6 行** を追加（コメント `/* ===== 経営ダッシュボード追加アクション ===== */` の下）:

```javascript
case 'orders':            return ordersOverview(e.parameter);
case 'subscriptions':     return subscriptionsOverview(e.parameter);
case 'customers':         return customersOverview(e.parameter);
case 'survey_responses':  return surveyResponsesOverview(e.parameter);
case 'quiz_responses':    return quizResponsesOverview(e.parameter);
case 'shipments':         return shipmentsOverview(e.parameter);
```

※ `staff_analytics` は既に Code.gs にあるので再追加不要

6. 「保存」(Ctrl+S / ⌘+S)
7. 右上「デプロイ」→「**デプロイを管理**」→ 鉛筆アイコン → 「新しいバージョン」→ 説明: `2026-05-25 経営ダッシュボード拡張` → 「**デプロイ**」

### 確認
ターミナルで以下を実行（curlで生存確認）:
```bash
GAS="https://script.google.com/macros/s/AKfycbyeq8to-87YAGhCvrOr_4whJehcWZAXchq4tMo4ec-zkIvrlqfhWWtd4J5ZtaV84gs/exec"
for a in orders subscriptions customers survey_responses quiz_responses shipments; do
  echo "--- $a ---"
  curl -sL "$GAS?action=$a" | head -c 200
  echo ""
done
```
- [ ] 全ての action が `{"ok":true,...}` を返す（"Unknown action" が消えている）

---

## 🎯 ステップ 3: 動作確認 (3分)

### お客様サイト (consumer)
1. https://edywagyu.github.io/eda-livestock-web/ を開く
   - [ ] トップページが表示される
   - [ ] スクロール時に B2B Sticky バーが出ない（consumer 除外確認）
2. https://edywagyu.github.io/eda-livestock-web/subscription.html
   - [ ] プロプラン (中央) に「✓ 選択中」が見える
   - [ ] 下部に「申込フォームへ →」スティッキー表示
   - [ ] 「節約 ¥6,400」の表記が見える
3. https://edywagyu.github.io/eda-livestock-web/shop.html
   - [ ] スクロールで右下に「↓ 商品一覧へ」FAB が出る
4. https://edywagyu.github.io/eda-livestock-web/products.html
   - [ ] Hero 直下に「贈り物としてお届けする」バナーが見える

### 企業バイヤーサイト (B2B)
1. https://edywagyu.github.io/eda-livestock-web/global.html
   - [ ] Hero に「Book a 30-min Call」黄金CTAボタン
   - [ ] スクロール 400px 以降に下部 Sticky バー出現
   - [ ] 「What You Get in 30 minutes」セクション (4カード)
   - [ ] バイヤーロゴリスト 9社
   - [ ] Buyer Inquiry 2択UI (RECOMMENDED バッジ付)
2. https://edywagyu.github.io/eda-livestock-web/restaurants.html
   - [ ] Hero に「取扱い希望のご相談」CTA
3. https://edywagyu.github.io/eda-livestock-web/buyer-deck.html
   - [ ] 右下に「Book a 30-min Call」フローティングボタン (英語)
4. https://edywagyu.github.io/eda-livestock-web/buyer-deck-it.html
   - [ ] 「Prenota una chiamata di 30 min」(イタリア語)
5. https://edywagyu.github.io/eda-livestock-web/buyer-deck-es.html
   - [ ] 「Reserva una llamada de 30 min」(スペイン語)

### 経営/スタッフ画面
1. https://edywagyu.github.io/eda-livestock-web/dashboard.html
   - [ ] 「まだ注文がありません」と表示 (DEMO撤去確認)
   - [ ] 右下に build 時刻表示
2. https://edywagyu.github.io/eda-livestock-web/staff.html
   - [ ] PIN 入力画面表示
   - [ ] **PIN 1234 を入力 → 「本番環境ではデモPINは使えません」エラー** (これが正常)
   - [ ] 「🎭 デモを試す」ボタンが非表示
3. https://edywagyu.github.io/eda-livestock-web/mypage.html?demo=1
   - [ ] 上部に「⚙ DEMO MODE 架空データ」黄色バナー
   - [ ] テスト太郎のダッシュボードが見える

### 予約フロー
1. **ナビゲーション** > Book → Google純正予約ページが新タブで開く
2. **モバイルメニュー** > 📅 商談予約 / Book → Google純正
3. **booking.html** に直接アクセス → 2秒後に Google純正にリダイレクト

---

## 🎯 ステップ 4: 運用情報の最終確認 (Optional · 5分)

### Google Calendar 設定
- [ ] https://calendar.google.com/ で「予約スケジュール」を確認
- [ ] `DjKHsVDhJHesaPM27` のスケジュールが「6:00-24:00 JST」に設定されている
  - 設定されていない場合: 該当スケジュール編集 → 提供時間枠を 06:00-24:00 に変更
- [ ] バイヤーが予約した時のメール通知設定が ON

### LIFF (LINE 認証)
- [ ] https://developers.line.biz/console/ で LIFF アプリ状態確認
- [ ] Endpoint URL: `https://edywagyu.github.io/eda-livestock-web/mypage.html`
- [ ] 「公開」状態 (Tom 限定でなく "公開" になっているか)

### Google Sheets (任意のタブが必要なら作成)
業務マスター スプシ (`1tNbIvsTkqrJiWtgpKCHevs_qeVjfNny0FPEsqTtxruM`) で:
- [ ] `Orders` タブ (注文記録)
- [ ] `Subscriptions` タブ (定期便メンバー)
- [ ] `Customers` タブ (会員マスター)
- [ ] `Survey` タブ (アンケート結果)
- [ ] `Quiz` タブ (診断クイズ回答)
- [ ] `events` タブ (PV/カート追加ログ・既にあるはず)

---

## 🚨 トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| ナビに Book リンクが見えない | キャッシュ | `Ctrl+Shift+R` でハードリロード |
| Sticky CTA が出ない | `b2b-booking.js` 読み込み失敗 | DevTools Network タブで 404 確認 |
| dashboard が空 | GAS 未デプロイ | ステップ2を実行 |
| staff で PIN 通らない | 本番URLで PIN 1234 試した | 正規 PIN を使う (Code.gs `staffLogin` 参照) |
| 予約リンクから calendar.app.google が「アクセス権限なし」 | 共有スケジュールが公開設定でない | Google Calendar 側で公開設定に変更 |
| Stripe 決済で赤バナー警告 | ローカル/?test=1 で pk_test_TESTKEY_REPLACE_ME のまま | 本番URLでは関係ない（テストモード時のみ警告） |

---

## 📋 含まれる全機能 (このPR)

### お客さんサイト (consumer)
- ✅ 定期便: 「✓ 選択中」ボタン表示修正
- ✅ 定期便: スティッキー注文CTAバー
- ✅ shop: 「全商品を見る」CTA + 「↓商品一覧へ」FAB
- ✅ products: ギフトバナー
- ✅ checkout: 「節約 ¥6,400」適用済み表示
- ✅ モバイルスクロール 5項目改善 (全20ページ)
- ✅ メニュー閉じる挙動修正

### 企業バイヤーサイト (B2B)
- ✅ Hero CTA (global / restaurants)
- ✅ Buyer Inquiry 2択UI (global)
- ✅ Value Preview セクション + バイヤーロゴ (global)
- ✅ deck系 5ファイルに Book Now FAB (4言語)
- ✅ 14ページに B2B Sticky バー
- ✅ Exit-intent モーダル (デスクトップ+モバイル両対応)
- ✅ press / journal-1 末尾予約CTA
- ✅ about / philosophy に控えめCTA
- ✅ OG メタタグ最適化

### 管理画面 (admin)
- ✅ dashboard DEMO撤去 (空状態を素直に表示)
- ✅ staff PIN 1234 本番URL無効化
- ✅ Stripe テストキー警告
- ✅ Build時刻フッタ表示
- ✅ staff ↔ dashboard 相互リンク

### バックエンド (GAS)
- ✅ 不足アクション 6件追加 (orders / subscriptions / customers / survey_responses / quiz_responses / shipments)
- ✅ Code_v2_Additions.gs 258行
- ✅ doGet switch に case 6 行追加

### 予約システム
- ✅ Google calendar.app.google/DjKHsVDhJHesaPM27 で統一
- ✅ 全11ページのナビにリンク
- ✅ モバイルメニューに「📅 商談予約 / Book」
- ✅ booking.html は 2秒リダイレクトページに簡素化
- ✅ 自前 GAS booking (BookingApi.gs) はバックアップとして保持

---

**最終更新: 2026-05-25**
**コミット: 7a5a9b9 (P3完全パッケージ) + 後続**
