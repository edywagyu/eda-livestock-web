# AmEx 経費仕分けツール

AmEx オンラインからダウンロードした利用明細CSV（Shift_JIS）を、業務経費として「確実なもの」と「要判断のもの」に自動仕分けする。

## 前提
- AmEx オンラインサービス → ご利用明細 → CSV ダウンロード（過去13ヶ月）
- ファイル名を `activity.csv` などで保存し、UTF-8 変換して `activity_utf8.csv` に配置
- 元CSV・変換後CSV・出力CSVは全て個人情報を含むため git 管理外（`keihi/**/*.csv` で除外済み）

```bash
iconv -f SHIFT_JIS -t UTF-8 activity.csv > activity_utf8.csv
```

## 使い方
```bash
python3 classify.py    # activity_utf8.csv → amex_business_confident.csv + amex_uncertain.csv
python3 summarize.py   # → 月別サマリ & freee取込CSV
```

## 出力
- `amex_business_confident.csv` — 業務経費として確実な取引（明確なルールに一致）
- `amex_uncertain.csv` — 要判断（コンビニ等、業務/私的の判別不可）
- `amex_monthly_summary.csv` — 月別×科目別集計
- `amex_freee_import.csv` — freee経費 取込フォーマット

## 仕分けルール（`classify.py`）
- **確実**：OpenAI / Adobe / Google One / ソフトバンクM / スターバックス / Suica / LUUP / 空港 / タクシー / 配車 / 輸送 / 印刷
- **保留**：コンビニ / Amazon / Apple / 海外店舗 / ホテル系
- **除外**：プルデンシャル生命 / フィットイージー / U-NEXT / ペット / メルカリ / ファミレス / 温泉 / 税金 / 遅延損害金 / YouTubeプレミアム
