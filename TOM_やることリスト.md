# 🐂 裏側修正 — 状況 & デプロイ手順（Tom用）

最終更新: 2026-05-31 / 作成: Claude

> ⚠️ 重要：**コードは完成・検証済みですが、まだ本番には出していません。**
> 「デプロイはTomの作業」と決めていたので、私（Claude）が本番反映しようとしたところ
> 権限ガードで止められました（正しい挙動です）。本番GASは今も旧版 `2026.05.27` のままです。
> → 下の **STEP 1 を実行**すれば全部本番化します（clasp認証は通っているのでログイン不要・1コマンド）。

---

## ✅ できていること（コード・ローカル検証済み）

| クレーム | コードの対応（※未デプロイ） |
|---|---|
| **③ 1回決済が3回分表示** | webhook冪等化＋Stripe `event.id` 再照会で偽造/重複を拒否。既存の重複行を消す診断API `diag_dedupe_orders` も実装済み |
| **② 定期便50%OFF未反映** | `STRIPE_COUPON_50OFF`(既定`FIRST50`)適用＋失敗時はクーポン無しで安全に決済継続＋スタッフ通知 |
| **① LINE連携（裏側）** | 友だち追加→自動会員登録＋ウェルカム(LIFFボタン2つ)の webhook 受け口を実装 |
| ＋セキュリティ | `customer_lookup` に email検証＋LINE UID照合ガード（`ENFORCE_LOOKUP_UID=true`で有効化・既定OFF） |

- ローカル：`Code.gs` = ping `2026.05.31c` / `sw.js` = `v056` / 構文チェックOK
- 変更ファイル：`gas/Code.gs`・`mypage.html`・`sw.js`・`staff.html`（staff.htmlは別件の管理画面トークン認証。整合のため同時反映します）

---

## 🚀 STEP 1：本番反映（1コマンド）

ターミナルで：
```bash
bash "/Users/tomokieda/AI - CLAUDE CODE/eda-livestock-web/DEPLOY.sh"
```
- 変更内容が出る → `y`
- フロント(GitHub Pages)へ push ＋ 裏側(GAS)へ clasp deploy ＋ 自動で `ping` 確認（`2026.05.31c`になればOK）
- 最後に「3倍課金の重複行」の**件数だけ**表示（削除はしません）

> 💡 私にやらせたい場合は「**デプロイして**」と言ってください。clasp認証は通っているので即実行できます（ただし本番反映なので、あなたの明示OKがあってから動きます）。

### 3倍課金の重複行を実際に消す（STEP 1 後・件数を見てから）
```bash
curl -s -L "https://script.google.com/macros/s/AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ/exec?action=diag_dedupe_orders&apply=1"
```
※ 同一 `session_id` の2行目以降だけ削除（正規の注文は残ります）。Stripeの実決済データには触れません。

---

## ⬜ STEP 2：LINEコンソールの手作業（あなたしかできない 3つ）

> 🔒 トークン・Webhook・セキュリティ設定はTom本人で、の取り決め。①が最優先。

### ① GAS に LINE トークンを設定（ウェルカム送信に必須）
1. https://script.google.com/ → このプロジェクト → ⚙️設定 →「スクリプト プロパティ」
2. `LINE_CHANNEL_TOKEN` ＝ Messaging APIの**チャネルアクセストークン(長期)**
   - 未設定だと友だち追加は記録されるが「ようこそ」が飛ばない／名前も取れません。
   - 既に入っているか不明なので、**設定済みか確認**してください。

### ② Messaging API の Webhook URL → ON → Verify
1. https://developers.line.biz/console/ → **Messaging APIチャネル** →「Messaging API設定」
2. Webhook URL：
   ```
   https://script.google.com/macros/s/AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ/exec
   ```
3. 「Webhookの利用」ON →「検証」で**成功**（空イベントでも200を返す実装）
   - ⚠️ 失敗時：GAS「デプロイを管理」で「実行＝自分／アクセス＝全員」を確認

### ③ リッチメニューを LIFF URL 化
- GUI：公式アカウントマネージャー（`@706sgiuq`）→ リッチメニュー「NEW EC」→ マイページのリンクを
  `https://liff.line.me/1657458587-mz1dR9e6` に変更
- 一括：`LINE_CHANNEL_ACCESS_TOKEN="…" python3 setup_richmenu_v3.py`

---

## 🔎 確認（STEP1＋STEP2のあと）
1. 自分のスマホでブロック→友だち追加 → 「友だち追加ありがとうございます🐂」＋マイページボタンが届く
2. リッチメニュー→マイページが LINE内でそのまま開く
3. 定期便テスト購入 → Stripeで初回50%引き

## 🛡 後日：IDOR強制ON
LINE導線が安定したら Script Property に `ENFORCE_LOOKUP_UID = true` を追加（他人のemailで他人情報を引けなくなる）。

## ↩️ 戻したいとき
- デプロイ前なので、出したくなければ何もしなくてOK（本番は今も旧版）。
- 出した後に戻す：フロント `git revert <commit> && git push` ／ GAS は「デプロイを管理」で旧バージョン選択。
- `gas/Code.gs.bak` に直前バックアップあり。
