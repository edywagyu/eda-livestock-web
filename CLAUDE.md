# 🚨 CRITICAL: このリポジトリの編集ルール

**このファイルは AI エージェント (Claude) 向けの絶対遵守ルールです。**

---

## ❌ 絶対にやってはいけないこと

### 1. `scripts/build.py` を実行してはいけない

- 既に `scripts/build.py.DISABLED_overwrites_ROOT_edits` にリネーム済み
- **リネームを戻して実行することも禁止**
- 「ビルドが必要そう」と思っても **実行しない**
- 過去にこのスクリプトが本番コンテンツを大量損失させた事故あり (commit 07b1b37)

### 2. `_pages/` 配下のファイルを「ソース」として扱ってはいけない

- `_pages/*.html` は ROOT HTML より古い状態のまま放置されています
- `_pages/home.html` を見て「本物の最新」と判断するのは間違い
- **正しい SoT (Source of Truth) は ROOT の `*.html` ファイル**

### 3. 大規模な「全ページ再ビルド」「dist 同期」「フォーマット統一」commit をしてはいけない

- 1 commit で 1000行以上削除する変更は **必ず一度立ち止まる**
- そのような変更が必要なら、Tom に事前確認

---

## ✅ 正しい編集の仕方

### ROOT HTML を直接編集する

```
編集対象:
  index.html       (トップ)
  shop.html        (単品EC)
  subscription.html (定期便)
  mypage.html      (マイページ)
  staff.html       (業務側)
  dashboard.html   (経営側)
  restaurants.html / global.html / about.html / 他全部
```

### 共通パーツの更新

ヘッダー・フッターを全ページで変えたい場合:
- `_partials/header.html` `_partials/footer.html` は **触らない**
- 代わりに各 ROOT HTML の該当箇所を **直接編集** する
- 「面倒だから build.py で一括処理」は **絶対 NG**

---

## 📚 重要な背景情報

### 事故の経緯 (2026-05-24)

1. Tom が ROOT の `index.html` `shop.html` 等を直接編集して写真・セクションを追加
2. 別の Claude セッションが `scripts/build.py` を実行
3. build.py が `_pages/` 配下から ROOT HTML を再生成し、**Tom の直編集を全消去**
4. 復旧に半日かかった

### 失われた内容（事故時に消えた例）

- `index.html` の `tom-cattle.jpg` Hero 背景写真
- `index.html` の 和牛キューブ accent
- `shop.html` の `sirloin.webp` Hero 写真
- `shop.html` の 「冷凍庫に、江田畜産がある安心」 セクション
- `shop.html` の Gift CTA セクション

### 復旧コミット

`ee49e09` — "restore: reset all ROOT HTML to 5b139e1 (pre-rebuild state) + disable build.py"

---

## 🔍 もし「最新じゃない」と Tom が言ったら

1. **すぐに `git log --shortstat -- <該当ファイル>` で大きい削除がないか確認**
2. **特に怪しいのは "再ビルド" "全ページ更新" "dist 同期" などの commit**
3. **そういう commit の直前の状態が真の最新**
4. Tom に確認した上で `git checkout <安全な commit> -- <ファイル>` で復旧

---

## 🤖 AI エージェントが守るべきチェックリスト

新しいセッションを開始する前に:

- [ ] このファイル (CLAUDE.md) を読んだ
- [ ] `scripts/build.py` が `.DISABLED_overwrites_ROOT_edits` のままであることを確認した
- [ ] ROOT HTML を編集する前に、現在の状態を確認した
- [ ] 大規模削除 (>500行) する commit を作る前に Tom に確認した

**このルールは Tom が明示的に取り消すまで永久に有効です。**
