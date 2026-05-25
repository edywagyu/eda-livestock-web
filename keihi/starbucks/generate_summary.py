"""Build monthly summary and freee-compatible import CSV."""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "starbucks_receipts.csv"
SUMMARY = HERE / "starbucks_monthly_summary.csv"
FREEE = HERE / "starbucks_freee_import.csv"


def load_rows() -> list[dict]:
    with SRC.open(encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_monthly(rows: list[dict]) -> None:
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"件数": 0, "本体合計": 0, "消費税": 0, "総合計": 0})
    for r in rows:
        ym = r["注文日時"][:7]
        b = buckets[ym]
        b["件数"] += 1
        b["本体合計"] += int(r["本体合計"] or 0)
        b["消費税"] += int(r["消費税"] or 0)
        b["総合計"] += int(r["総合計"] or 0)

    with SUMMARY.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["年月", "件数", "本体合計", "消費税", "総合計"])
        for ym in sorted(buckets):
            b = buckets[ym]
            writer.writerow([ym, b["件数"], b["本体合計"], b["消費税"], b["総合計"]])
        total = {k: sum(v[k] for v in buckets.values()) for k in ["件数", "本体合計", "消費税", "総合計"]}
        writer.writerow(["合計", total["件数"], total["本体合計"], total["消費税"], total["総合計"]])


def write_freee(rows: list[dict]) -> None:
    with FREEE.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "取引日",
            "勘定科目",
            "金額",
            "税区分",
            "取引先",
            "品目",
            "メモタグ",
            "備考",
        ])
        for r in rows:
            tax_kbn = "課対仕入8%(軽)" if r["税率"] == "8%" else "課対仕入10%"
            memo = f"{r['店舗']} / {r['商品']} / インボイス:{r['インボイス登録番号']}"
            writer.writerow([
                r["注文日時"][:10],
                "会議費",
                r["総合計"],
                tax_kbn,
                r["販売事業者"],
                "スターバックス",
                "Suica/スタバ経費",
                memo,
            ])


def main() -> None:
    rows = load_rows()
    write_monthly(rows)
    write_freee(rows)
    print(f"件数: {len(rows)}")
    print(f"月別サマリ: {SUMMARY}")
    print(f"freee取込CSV: {FREEE}")


if __name__ == "__main__":
    main()
