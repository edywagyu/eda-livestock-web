# スタバ経費精算ツール

スタバの Mobile Order & Pay 領収書メール（n.17tom@gmail.com から tomoki@eda-livestock.com に転送されたもの）をパースして、経費精算用CSVを生成するスクリプト群。

## 前提
- 領収書メール本体（プレーンテキスト）を `raw_emails.txt` に保存しておく
- 形式：Gmail MCP の `get_thread` で `plaintextBody` をそのままダンプ
- このファイルは個人情報を含むため git 管理外（.gitignore 済み）

## 使い方
```bash
python3 parse_receipts.py       # raw_emails.txt → starbucks_receipts.csv
python3 generate_summary.py     # → 月別サマリ & freee取込CSV
```

## 出力
- `starbucks_receipts.csv` — 全明細（店舗・商品・税率・インボイス番号）
- `starbucks_monthly_summary.csv` — 月別集計
- `starbucks_freee_import.csv` — freee経費 取込フォーマット

## 注意
- 出力CSVも財務情報のため git 管理外
- freee取込時の勘定科目は仮で「会議費」。実情に応じて変更
- Mobile Order & Pay 利用分のみ対象。店頭直接決済分はカード明細から別途取得
