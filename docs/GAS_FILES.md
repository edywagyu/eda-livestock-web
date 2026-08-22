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
| `Popular.js` | `gas/Popular.gs` | ← 2026-08-22 に取り込み。本番とバイト一致 |
| `Set_Staff_Pin.js` | **意図的に置かない** | スタッフPINが平文。このリポジトリは public のため入れない |
| `LineInsights.js` | `gas/LineInsights.gs` | 2026-08-22 push 済み。毎朝7時トリガー稼働中 |
| （無し） | `gas/click_dashboard.gs` | 別プロジェクト（SNS管理シートのバインドGAS）用。ここには push しない |

## 地雷

1. **`Set_Staff_Pin.js` は絶対にコミットしない。** `STAFF_PIN` を平文で持っている。
   このリポジトリは public。PIN は Script Properties に入っていれば動くので、
   ファイル自体は本番プロジェクトにも残さなくてよい。
2. ~~`publicPopular()` が二重定義になりうる~~ → **2026-08-22 に解消済み。**
   `gas/Code.gs` から切り出して `gas/Popular.gs` に移した（本番の `Popular.js` とバイト一致）。
   これでリポジトリと本番のファイル構成が一致し、`Code.gs` を push しても二重定義にならない。
3. **本番の Web App 2本はバージョン固定** (`@105` staff系 / `@107` mypage系)。
   `clasp push` はコードを HEAD に置くだけで、この2本の挙動は変わらない。
   本番に反映したい時だけ `clasp redeploy <deploymentId>` で版を上げる。
4. **版を上げた人が実行ユーザーになる**（`appsscript.json` の `executeAs: USER_DEPLOYING`）。
   メールの送信元や権限がその人に切り替わるので、上げる前に誰の名義にするか決めること。

## 反映（push）の手順 — 必ずこの順で

**複数のチャット／人が同じGASプロジェクトを触っている前提で書いてある。**
「自分のローカルにある `gas/` を push する」は禁止。他人の変更を消す。

### 1. 送る直前に、本番を丸ごと取り直す

```bash
D=~/eda-gas-update && rm -rf $D && mkdir -p $D && cd $D
clasp clone-script 1ElO2DI4UNrhFPAy7cf5XEfysRrdM9aU5gkAkJqx4MILkq0OHJINSIf-n
```

**この瞬間の本番が「正」。** リポジトリではない。作業を始めた時に取ったものでもない。
**送る直前に取り直す**こと（数十分前のcloneでは、その間に入った他人の変更を消す）。

### 2. そこへ自分の差分だけ重ねる

```bash
cd ~/eda-livestock-web && git fetch -q origin
git show origin/main:gas/Code.gs > $D/Code.js     # 変えるファイルだけ
```

既存ファイルは触らない・消さない。**リポジトリに無いファイル（`CartRecovery` 等）は
clone してきたものをそのまま残す。**

### 3. 送る前に「何がどれだけ変わるか」を出して見せる

```bash
# 変わるファイル
for f in $D/*.js $D/*.json; do
  diff -q "$f" "<clone直後のコピー>/$(basename $f)" >/dev/null 2>&1 || echo "更新: $(basename $f)"
done
# 変わる行数
diff "<clone直後>/Code.js" "$D/Code.js" | grep -c '^[<>]'
# ファイル数が減っていないこと
ls $D | wc -l
```

「Code.js が2行だけ／他は一致／10ファイル」まで言えてから送る。

### 4. push

```bash
cd ~/eda-gas-update && clasp push
```

`Pushed N files.` の N が 3 のファイル数と一致すること。

### 5. push直後に、もう一度 clone して照合する

```bash
D2=$(mktemp -d) && cd $D2
clasp clone-script 1ElO2DI4UNrhFPAy7cf5XEfysRrdM9aU5gkAkJqx4MILkq0OHJINSIf-n
for f in $D2/*.js $D2/*.json; do diff -q "$f" "$D/$(basename $f)" >/dev/null || echo "⚠️ $(basename $f)"; done
ls $D2 | wc -l
```

**送った内容と一致し、ファイルが減っていないこと。**

### 6. GitHub main とも突き合わせる

```bash
cd ~/eda-livestock-web && git show origin/main:gas/Code.gs > /tmp/main_code.gs
diff /tmp/main_code.gs $D2/Code.js | grep -c '^[<>]'
```

0 でなければ「mainにあるのに本番に無い」変更が残っている。
`git log origin/main --oneline -5 -- gas/Code.gs` でどのPRが届いていないか特定する。

### なぜここまでやるか（2026-08-22 の実例）

- **①防げた事故**: リポジトリの `gas/` をそのまま push しようとしたが、本番にしか無い
  `CartRecovery.js` / `CustomerRoster.js` / `Popular.js` / `Set_Staff_Pin.js` を
  clone で見つけて回避。押していたらカゴ落ちリマインドが消えていた。
- **②実際に起きた事故**: 13:57 に push → 13:58 に別チャットが PR #127 をマージ →
  別チャットが**古い土台のまま** push → **#127（顧客の二重登録を防ぐ）が本番から抜けた**（61行）。
  手順5・6をやっていれば、その場で気づけた。

**push は最後の一手だけ人間が打つ。打つ直前に手順3を、打った直後に手順5・6を必ず回す。**
