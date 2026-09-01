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
clasp deploy -i AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ -d <説明>
```

公開設定は上の2本がサイトから使われている（他の7本は過去の版）。
両方を新しい版に更新しないと、片方だけ古いコードで動き続ける。

## このフォルダに入れていないファイル

- **`Set_Staff_Pin.gs`** … 本番には存在する。STAFFポータルのPINが平文で書かれているため、
  このリポジトリは公開なので置かない。`clasp push` で消えることはない
  （clasp はローカルに無いファイルを本番から削除しないため）。本番側で触らないこと。
