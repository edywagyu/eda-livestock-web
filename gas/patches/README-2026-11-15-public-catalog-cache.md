# public_catalog を45秒キャッシュして在庫表示を速くする（2026-11-15）

## 🔴 このファイルは Code.gs の全文ではありません

同じフォルダの `2026-10-26-rice-shipping.Code.gs.new` は **Code.gs の全文**ですが、
今回の `2026-11-15-public-catalog-cache.publicCatalog.gs.snippet` は
**`publicCatalog()` という関数1つぶんだけ**です（約3.5KB）。

**丸ごと差し替えないこと。** 丸ごと置き換えると本番GASのバックエンドが全部消えます。
`Code.gs` の中の `publicCatalog()` 1関数だけを、このファイルの中身に置き換えてください。

## なぜ

会員限定ページを開いてから在庫が確定するまでの待ち時間を田崎さんが指摘。
原因を本番で実測した内訳。

| 内訳 | 修正前 | フロント修正後（PR作成済み） | このパッチ後（見込み） |
|---|---|---|---|
| 取得の開始が遅い | 820ms | **70ms** | 70ms |
| 閲覧ログ10本との競合 | +7.9秒 | **0** | 0 |
| **GAS の応答そのもの** | **3.4〜4.1秒** | 3.4〜4.1秒 | **0.2〜0.4秒** |
| 画面が確定するまで | 11.6〜17.5秒 | **4.3秒** | **1秒前後** |

フロント側は対応済み。**残っている3.4秒はGASの応答時間そのもの**で、フロントからは
短くできません。`publicCatalog()` が毎回 products / gifts / subscription_plans の
3シートを丸ごと読み直しているためです。

やることは1つだけ: **組み立てたJSONを45秒だけ CacheService に置き、次の人にはそれを返す。**

- 45秒 = 在庫表示が最大45秒古くなる。レジは `validateStockBeforeCheckout` が
  シートの実在庫を見るので、**売り越しにはつながりません**

## 必ずセットで入れること

`decrementStockAfterOrder()`（Code.gs 2692行目あたり）と
`staffUpdateStock()`（6025行目あたり）の最後に、それぞれ1行足してください。
**任意ではありません。** 入れないと、売れた直後・在庫を手で直した直後に
最大45秒ぶん古い数字が出ます。

```js
try { CacheService.getScriptCache().remove('public_catalog_v1'); } catch (e) {}
```

## 反映手順（🔴 田崎さんの作業。私は clasp push を実行できません）

```
cd ~/eda-livestock-web
clasp pull                 # 必ず先に現物を取る
#  → Code.gs の publicCatalog() だけを snippet の中身に置き換える
#  → 上の remove 1行を2箇所に足す
clasp push
clasp pull                 # 押したものが入ったか照合
```

そのあと **デプロイの版を上げてください。** `clasp push` が更新するのは @HEAD だけで、
版を上げないとWeb APIの挙動は変わりません。手順は `docs/DEPLOYMENT_GUIDE.md` と
`docs/DEPLOY_CHECKLIST.md`、および前例の
`gas/patches/README-2026-10-26-rice-shipping.md` の「6. デプロイの版を上げる」に従ってください。
対象は商品・在庫・staff系のデプロイ（`AKfycbx7u3D5…`）です。

## 反映後に測ること

```
U="https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec?action=public_catalog"
curl -sL -o /dev/null -w "1回目 %{time_starttransfer}s\n" "$U"
curl -sL -o /dev/null -w "2回目 %{time_starttransfer}s\n" "$U"
```

2回目が1秒を切っていればキャッシュが効いています（修正前はどちらも3.4〜4.1秒）。
