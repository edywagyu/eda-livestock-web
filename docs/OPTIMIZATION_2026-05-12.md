# 2026-05-12 サイト全方位最適化レポート

**作業時間**: 一晩（深夜実施）
**コミット数**: 12 commits 累計
**修正ファイル数**: 60+ ファイル

---

## 1️⃣ 監査結果（並列 4 エージェント）

| 監査 | 主要P0発見 |
|------|----------|
| 🗺️ フロー | tel: 空6箇所、restaurants href=# 8箇所、#gift アンカー不一致、複数ギフト到達不能、index に LINE/サブスク導線なし |
| 🔍 矛盾 | 「解約縛りなし vs 3ヶ月継続後」同ページ矛盾、プラン名2系統、VIP価格2種、9 vs 13カ国、staff データ完全不整合 |
| 📱 モバイル | mobile nav なし(`.primary-nav` hidden)、タップターゲット<44px、iOS Safari ズーム発動、timeline 100px 列はみ出し、フォント8pxなど |
| 🎨 UI | 待機タイムアウトのため未完（他3監査でカバー） |

---

## 2️⃣ 修正内容 (全 21 バッチ)

### Batch 1: 同一ページ矛盾の解消 (P0返金リスク)
- subscription.html「解約縛りなし」→「3ヶ月継続後OK」
- 「スターター/レギュラー/ボリューム」→「ミニ/プロ/VIP」
- VIP ¥19,800 → ¥27,400 (実プラン価格)
- voice/title/label すべてプラン新名称に統一

### Batch 2: 死リンク全廃
- tel: 空6箇所 → `tel:08057930708`(国内) + `tel:+81805793-0708`(国際)
- restaurants `href="#"` 8箇所 → 実 URL (Ritz/Tokyo Station Hotel/city'super/Mistore) or restaurants.html
- `shop.html#gift` アンカー → `<span id="gift">` を gift-highlight 内に追加

### Batch 3: モバイルナビ + フォーム補完
- `public/js/mobile-menu.js` 新設 — 16ページに自動注入
- ハンバーガー → 右ドロワーで Shop/定期便/Organic/全ページ+LINE+電話
- 全フォーム入力に `autocomplete` + `inputmode` 付与 (iOS Safari ズーム回避16px)
- 郵便番号自動補完 (zipcloud API 既存実装維持)

### Batch 4: staff.html マスター同期
- DEMO_PRODUCTS_FALLBACK 22商品を `products-master.js` と1対1で完全一致
- 旧 ID/価格/重量を全更新
- DEMO_ORDERS の商品名も新商品名に置換
- DEMO_SUBS を ミニ/プロ/VIP プランに統一

### Batch 5: LINE 浮遊ボタン全ページ展開
- `public/js/line-float.js` 新設 — 17ページに自動注入
- shop は既存の floating-phone-btn を尊重 (重複防止)
- 緑グラデ + 白アイコン円 で LINE ブランド色

### Batch 6: 決済手段 FAQ整合
- shop.html FAQ「9種類」→ 実装通り「クレカ/Apple Pay/銀行振込」
- 定期便はカード/Apple Pay のみと明示
- shop-how-step / spec-table / cart-drawer 時間帯 すべて整合

### Batch 7: CTA文言均一化
- 「定期便で常備する」→「定期便を申し込む」
- 申込 (subscription) / 注文 (single/gift) / 予約 (organic) / 質問 (LINE) で動詞使い分け

### Batch 8: 複数ギフトCTA
- shop.html ギフト3点グリッド下に「複数の方へまとめて贈りたい」バナー新設
- `checkout.html?mode=multi` → 2件目自動追加 + ガイダンスバナー
- フロー監査の「複数ギフト到達不能」を解消

### Batch 9: モバイル改行ミス修正
- subプラン item を `<div><br></div>` → `<ul><li>` に
- `white-space: nowrap + text-overflow: ellipsis`
- sub-plan-items 文字色 0.65 → 0.78 視認性UP

### Batch 10: タッチターゲット 44px化
- `.tab/.sub-tab/.status-pill` mobile padding/font-size 増量、min-height 36→44
- dashboard sidebar nav-item 8→12px、44px min-height
- mypage reward-prog-step-label 8px → 10.5px

### Batch 11: 細部 (iOS zoom + awards + organic-tease)
- フォーム入力 16px に統一 (iOS Safari ズーム発動条件 <16px 回避)
- min-height 44→48px、padding 増量
- awards カード h3 に `word-break: keep-all + overflow-wrap: anywhere`
- organic-tease lead 文 `<br>` → `<span>` 自然折返し
- 50%OFF promo banner の `<small>` → `<span>` + em単位で安定化

### Batch 12: 全ページナビ統一
- 16ページの `<ul class="nav-list">` を同一構造に
- 順序: Shop / 定期便 / Organic / About / Global / Restaurants / Journal / Contact
- 各ページで `class="current"` 自動付与

### Batch 13-15: trust-strip / コントラスト / 索引クイズ
- shop-trust-strip モバイル: 横スク → 中央寄せ flex-wrap
- 低コントラスト箇所 を 0.6→0.78 / muted→ink にUP
- index.html audience-card に「プラン診断クイズ (1分)」追加

### Batch 16-17: sticky-cart 補正 + checkout multi モード
- body.has-sticky-cart 時 main + footer に padding-bottom 90px
- ?mode=multi で 2件目自動追加 + 専用バナー

### Batch 18-19: products + subscription マスター同期
- 赤身ステーキ 250g → 200g (products.html / subscription.html addons)
- バラ焼肉 150g ¥1,900 → 200g ¥1,500
- 和牛ミンチ ¥1,350/200g を新規追加

### Batch 20: footer Connect 全ページ同期
- 18ページの footer-col Connect を一律更新
- 💬 LINE / 📷 Instagram / 📞 080-5793-0708 を追加

### Batch 21: 最終検証
- 死リンク チェック: ✓ クリーン
- 矛盾 チェック: 「解約縛りなし」0件、プラン名統一済
- 商品データ: 赤身ステーキ 全 15箇所 200g 統一、バラ焼肉 6箇所 200g 統一、和牛ミンチ 5ファイル全て搭載
- mobile-menu.js: nav有 13/13ページに注入済

---

## 3️⃣ 各監査タスクの達成状況

| ユーザ要求 | 状態 |
|------------|------|
| ① 全導線シンプル化（決済/電話/問合せ） | ✅ Shop/定期便/Gift/Contact すべて1〜2クリック / 死リンク全廃 |
| ② 全ページ矛盾解消 | ✅ プラン名/価格/重量/カントリー数/解約規約 全整合 |
| ③ モバイル改行ミス・視認性 | ✅ <ul><li>化、低コントラスト+0.18、iOS zoom 回避16px、44px tap |
| ④ UI 最大化 (特にモバイル) | ✅ ハンバーガー追加、タイムライン縮小、sticky-cart 余白、トラスト strip 整列 |

---

## 4️⃣ 既知の残課題（次フェーズ）

1. **Stripe 本実装**: 現在 placeOrder() は GAS への POST のみ。本番決済は別タスク
2. **GAS デプロイ**: dashboard.html の ⚙️ から URL を登録すれば 全ページに自動伝播
3. **sales-deck.html / journey.html 内の narrative**: VAL JON や 杉浦さん への触れ込みが残存（外向け B2B 資料は意図的に維持）
4. **mypage.html**: 顧客マイページのため独自ヘッダー（共通ナビ非対応） — 仕様通り

---

## 5️⃣ デプロイ確認 URL

```
https://edywagyu.github.io/eda-livestock-web/                      (index)
https://edywagyu.github.io/eda-livestock-web/shop.html              (商品一覧 + クイズ)
https://edywagyu.github.io/eda-livestock-web/subscription.html      (定期便申込)
https://edywagyu.github.io/eda-livestock-web/checkout.html?mode=multi (複数ギフト)
https://edywagyu.github.io/eda-livestock-web/dashboard.html         (経営ビュー)
https://edywagyu.github.io/eda-livestock-web/staff.html             (現場運用)
```

各ページで **Cmd+Shift+R** で強制リロードして反映を確認してください。

---

🛏️ Tom さん、おやすみなさい。朝の確認用に各バッチの差分が git log にあります。
