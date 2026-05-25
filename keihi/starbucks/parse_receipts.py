"""Parse Starbucks Mobile Order receipts from forwarded email body."""

from __future__ import annotations

import csv
import re
from pathlib import Path

SRC = Path(__file__).parent / "raw_emails.txt"
OUT_CSV = Path(__file__).parent / "starbucks_receipts.csv"


def parse_block(block: str) -> dict | None:
    if "総合計" not in block or "受取店舗" not in block:
        return None

    def grab(pattern: str, text: str = block, group: int = 1) -> str:
        m = re.search(pattern, text)
        return m.group(group).strip() if m else ""

    store = grab(r"■受取店舗:\s*\n\s*スターバックス\s*コーヒー\s*(.+)")
    date_raw = grab(r"■注文完了日時:\s*\n\s*(.+)")
    date_iso = ""
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日.*?(\d{1,2})時(\d{1,2})分", date_raw)
    if m:
        y, mo, d, hh, mm = m.groups()
        date_iso = f"{y}-{int(mo):02d}-{int(d):02d} {int(hh):02d}:{int(mm):02d}"

    item_lines = []
    m_items = re.search(r"=== ご注文内容 ===\s*\n(.*?)\n本体合計", block, re.DOTALL)
    if m_items:
        for line in m_items.group(1).splitlines():
            line = line.strip()
            if not line:
                continue
            item_lines.append(re.sub(r"\s+", " ", line))
    items = " / ".join(item_lines)

    subtotal = grab(r"本体合計\([^)]*\)\s*¥([\d,]+)").replace(",", "")
    tax_amount = ""
    tax_rate = ""
    m_tax = re.search(r"\((\d+)%対象\s*¥([\d,]+)\s*消費税\s*¥([\d,]+)\)", block)
    if m_tax:
        tax_rate = m_tax.group(1) + "%"
        tax_amount = m_tax.group(3).replace(",", "")
    total = grab(r"総合計\s*¥([\d,]+)").replace(",", "")
    use_type = grab(r"利用方法:\s*\n(.+)")
    payment = grab(r"お支払い方法:\s*\n(.+)")
    seller = grab(r"販売事業者名:\s*\n(.+)")
    invoice_no = grab(r"登録番号:\s*\n(T\d+)")

    return {
        "注文日時": date_iso,
        "店舗": store,
        "商品": items,
        "本体合計": subtotal,
        "税率": tax_rate,
        "消費税": tax_amount,
        "総合計": total,
        "利用方法": use_type,
        "支払方法": payment,
        "販売事業者": seller,
        "インボイス登録番号": invoice_no,
    }


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    blocks = text.split("◇◆ Thank you! Enjoy your time.")

    rows = []
    for block in blocks:
        row = parse_block(block)
        if row:
            rows.append(row)

    rows.sort(key=lambda r: r["注文日時"])

    fieldnames = [
        "注文日時",
        "店舗",
        "商品",
        "本体合計",
        "税率",
        "消費税",
        "総合計",
        "利用方法",
        "支払方法",
        "販売事業者",
        "インボイス登録番号",
    ]
    with OUT_CSV.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    total_sum = sum(int(r["総合計"]) for r in rows if r["総合計"].isdigit())
    print(f"件数: {len(rows)}")
    print(f"合計金額: ¥{total_sum:,}")
    print(f"出力: {OUT_CSV}")


if __name__ == "__main__":
    main()
