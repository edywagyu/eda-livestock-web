"""Build monthly summary and freee-compatible import CSV for AmEx business expenses."""

from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "amex_business_confident.csv"
SUMMARY = HERE / "amex_monthly_summary.csv"
FREEE = HERE / "amex_freee_import.csv"


def load() -> list[dict]:
    with SRC.open(encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def write_summary(rows: list[dict]) -> None:
    by_ym_kamoku: dict[tuple[str, str], dict] = defaultdict(lambda: {"件数": 0, "金額": 0})
    for r in rows:
        ym = r["ご利用日"].replace("/", "-")[:7]
        key = (ym, r["勘定科目候補"])
        by_ym_kamoku[key]["件数"] += 1
        by_ym_kamoku[key]["金額"] += int(r["金額"])

    with SUMMARY.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["年月", "勘定科目", "件数", "金額"])
        for (ym, kamoku) in sorted(by_ym_kamoku):
            v = by_ym_kamoku[(ym, kamoku)]
            writer.writerow([ym, kamoku, v["件数"], v["金額"]])


def write_freee(rows: list[dict]) -> None:
    with FREEE.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["取引日", "勘定科目", "金額", "税区分", "取引先", "メモタグ", "備考"])
        for r in rows:
            writer.writerow([
                r["ご利用日"].replace("/", "-"),
                r["勘定科目候補"],
                r["金額"],
                "課対仕入10%",
                r["ご利用内容"],
                "個人立替_AmEx",
                r["メモ"],
            ])


def main() -> None:
    rows = load()
    write_summary(rows)
    write_freee(rows)
    print(f"件数: {len(rows)}")
    print(f"月別サマリ: {SUMMARY}")
    print(f"freee取込CSV: {FREEE}")


if __name__ == "__main__":
    main()
