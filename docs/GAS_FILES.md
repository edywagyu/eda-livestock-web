# 本番GASプロジェクトとリポジトリの対応表

最終確認: 2026-08-22（`clasp clone` で本番プロジェクトを実際に読み出して照合）

本番の Apps Script プロジェクト
`1ElO2DI4UNrhFPAy7cf5XEfysRrdM9aU5gkAkJqx4MILkq0OHJINSIf-n`

## 🔴 いちばん大事なこと

**リポジトリの `gas/` を、そのまま `clasp push` してはいけない。**
本番プロジェクトには、リポジトリに無いファイルが入っている。push は
「ローカルに無いファイルを消す」動きをするので、丸ごと押すと本番の機能が消える。

push するときは必ず `clasp clone` で本番を落としてきて、
**そこに差分だけ足してから** push すること。

## 対応表

| 本番プロジェクトのファイル | リポジトリ | 備考 |
|---|---|---|
| `Code.js` | `gas/Code.gs` | リポジトリ側が新しい。本番に未反映の差分あり（下記） |
| `Code_v2_Additions.js` | `gas/Code_v2_Additions.gs` | 差分あり |
| `cart_holds.js` | `gas/cart_holds.gs` | 一致 |
| `appsscript.json` | `gas/appsscript.json` | 差分あり |
| `CartRecovery.js` | `gas/CartRecovery.gs` | ← 2026-08-22 に取り込み |
| `CustomerRoster.js` | `gas/CustomerRoster.gs` | ← 2026-08-22 に取り込み |
| `Popular.js` | （無し・下記参照） | 中身は `gas/Code.gs` の `publicPopular()` と**バイト一致** |
| `Set_Staff_Pin.js` | **意図的に置かない** | スタッフPINが平文。このリポジトリは public のため入れない |
| （無し） | `gas/LineInsights.gs` | PR #13 でマージ済みだが**本番に未 push** |
| （無し） | `gas/click_dashboard.gs` | 別プロジェクト（SNS管理シートのバインドGAS）用。ここには push しない |

## 地雷

1. **`Set_Staff_Pin.js` は絶対にコミットしない。** `STAFF_PIN` を平文で持っている。
   このリポジトリは public。PIN は Script Properties に入っていれば動くので、
   ファイル自体は本番プロジェクトにも残さなくてよい。
2. **`publicPopular()` が二重定義になりうる。** いま本番では `Popular.js` にだけ在り、
   リポジトリでは `gas/Code.gs` にだけ在る。`Code.gs` を本番へ push するときは、
   同時に `Popular.js` を消すこと。両方残すと同名関数が2つになる。
3. **本番の Web App 2本はバージョン固定** (`@105` staff系 / `@107` mypage系)。
   `clasp push` はコードを HEAD に置くだけで、この2本の挙動は変わらない。
   本番に反映したい時だけ `clasp redeploy <deploymentId>` で版を上げる。
4. **版を上げた人が実行ユーザーになる**（`appsscript.json` の `executeAs: USER_DEPLOYING`）。
   メールの送信元や権限がその人に切り替わるので、上げる前に誰の名義にするか決めること。
