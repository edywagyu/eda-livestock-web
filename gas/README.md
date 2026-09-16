# gas/ — 本番 Google Apps Script（江田畜産_EC_API_v1）のソース

scriptId: `1ElO2DI4UNrhFPAy7cf5XEfysRrdM9aU5gkAkJqx4MILkq0OHJINSIf-n`

## 🔴 反映する前に、必ず本番から `clasp pull` して差分を見ること

2026-09-01 に、このフォルダと本番が **193行ぶんズレている**のを発見した。
本番にだけ入っていて、ここに無かったもの＝クーポン有効期限 / 定期便の新価格と
北海道・沖縄の地域別価格 / 顧客の重複まとめ。
このフォルダの内容をそのまま `clasp push` していたら、定期便が旧価格に戻り、
地域別価格とクーポン期限が消えていた。

手順:

```bash
clasp pull            # 本番を取り出す
# ここで diff を見て、本番にだけある変更を必ず取り込んでから編集する
clasp push -f
clasp deploy -i AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ -d <説明>
```

**2026-09-10 以降、サイトが使う窓口は上の1本（`AKfycbx7u3D5…`）に統一した。**
それまでは決済・マイページ系が `AKfycbxFfdz…`、商品・在庫系が `AKfycbx7u3D5…` と
2本に分かれており、片方だけ版上げすると「直したのに直らない」が起きていた
（2026-09-06 のマイページがこれ）。

⚠️ **当面は `AKfycbxFfdz…` も一緒に版上げしておくこと。**
お客様のブラウザ（特に LINE 内ブラウザ）が古い JS をキャッシュしている間は、
そちらを叩き続けるため。

```bash
clasp deploy -i AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ -d <説明>   # 旧窓口（キャッシュ対策・当面のみ）
```

なお **@HEAD デプロイ（`AKfycbyx9MeW…`）はサイトからは使えない**。
Google のログイン画面にリダイレクトされる（2026-09-10 実測）ため、
「push だけで即反映される窓口」をお客様向けに使うことはできない。

## このフォルダに入れていないファイル

- **`Set_Staff_Pin.gs`** … 本番には存在する。STAFFポータルのPINが平文で書かれているため、
  このリポジトリは公開なので置かない。`clasp push` で消えることはない
  （clasp はローカルに無いファイルを本番から削除しないため）。本番側で触らないこと。
