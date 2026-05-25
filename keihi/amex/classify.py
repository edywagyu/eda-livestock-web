"""Extract clearly business-related AmEx transactions."""

from __future__ import annotations

import csv
import re
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "activity_utf8.csv"
OUT = HERE / "amex_business_confident.csv"
OUT_UNCERTAIN = HERE / "amex_uncertain.csv"


def norm(s: str) -> str:
    return s.replace("　", " ").strip()


CONFIDENT_RULES: list[tuple[str, str, str]] = [
    (r"OPENAI", "通信費", "ChatGPT サブスクリプション（業務AI利用）"),
    (r"ANTHROPIC", "通信費", "Claude API（業務AI利用）"),
    (r"ADOBE|アドビ", "通信費", "Adobe Creative Cloud（業務デザイン）"),
    (r"GOOGLE \*GOOGLE ONE|GOOGLE WORKSPACE", "通信費", "Google Workspace/Drive（業務）"),
    (r"ム.?ム.?ドメイン|GMO|ペパボ", "通信費", "ドメイン管理（自社サイト）"),
    (r"ソフトバンク|ｓｏｆｔｂａｎｋ|ＳＯＦＴＢＡＮＫ", "通信費", "携帯通信費"),
    (r"スターバックス|STARBUCKS", "会議費", "打合せ・業務移動中カフェ"),
    (r"^Ｓｕｉｃａ|^Suica|モバイルＳｕｉｃａ|モバイルSuica", "旅費交通費", "Suica業務利用"),
    (r"LUUP", "旅費交通費", "LUUP短距離移動"),
    (r"成田国際空港|羽田空港|ＡＮＡ|ＪＡＬ|JETSTAR|ジェットスター|Skymark|スカイマーク|チャイナエア|EVA AIR|スターフライヤー", "旅費交通費", "航空券・空港"),
    (r"ＪＲ東日本|ＪＲ西日本|ＪＲ東海|新幹線|EX予約|えきねっと|JR East", "旅費交通費", "鉄道"),
    (r"国際自動車|個人タクシー|TAXI|タクシー|GO Inc|S\.RIDE|DiDi", "旅費交通費", "タクシー"),
    (r"BOLT OPERATIONS|UBER", "旅費交通費", "配車（海外/Uber）"),
    (r"GBIKE", "旅費交通費", "シェアバイク"),
    (r"OCS|DHL|FEDEX|フェデックス|ヤマト運輸|佐川急便|日本郵便|ＥＭＳ", "荷造運賃", "国際輸送・配送"),
    (r"アクセア|キンコーズ|プリント|印刷", "消耗品費", "印刷・コピー"),
]

UNCERTAIN_KEYWORDS = [
    "セブンイレブン", "ファミリーマート", "ローソン", "デイリーヤマザキ",
    "クイックペイ", "アマゾン", "Amazon", "Apple", "Apple iTunes",
    "Ｓｕｉｃａチャージ", "ＰＡＳＭＯ", "ヨドバシ", "ビックカメラ",
    "PARCO", "パルコ", "ZEBRA COFFEE", "ドトール", "コメダ",
    "WUNDERMART", "RAMEN KAGURA", "VACANCY COFFEE", "CAY SAATI",
    "WESTIN", "BIOHAZARD", "SUPERCOR", "MADRID", "GUAM",
    "LOOMIS", "3CPAYMENT", "STORE",
    "ホテル", "HOTEL", "RESORT", "リゾート",
    "成田", "羽田",
]

EXCLUDE_PERSONAL = [
    r"プルデンシャル",
    r"フィットイ.?ジ.?",
    r"ユ.?ネクスト|U-NEXT",
    r"Dog Sal|ペット",
    r"メルカリ",
    r"はま寿司|吉野家|松屋|ジョイフル|ほっともっと|ドラッグストアモリ",
    r"よみうりランド|温泉|京成ローザ",
    r"前回分口座振替|お支払いありがとうございました|口座振替ができませんでした|遅延損害金",
    r"地方税共同機構",
    r"プレナ幕張|新潟三宝亭|サトヤマテラス",
    r"PLATINA",
    r"GOOGLE \*YOUTUBEPREMIUM",
]


def classify(content: str) -> tuple[str, str, str] | None:
    for pattern, kamoku, memo in CONFIDENT_RULES:
        if re.search(pattern, content, re.IGNORECASE):
            return kamoku, memo, "確実"
    return None


def is_personal(content: str) -> bool:
    return any(re.search(p, content, re.IGNORECASE) for p in EXCLUDE_PERSONAL)


def is_starbucks_charge(content: str, amount: int) -> bool:
    """¥1,000 / ¥5,000 ジャストのスターバックス取引はカードへのチャージ（前払金）"""
    is_sb = bool(re.search(r"スターバックス コーヒー ジャパン|STARBUCKS COFFEE JAPAN", content))
    return is_sb and amount in (1000, 5000)


def parse_amount(s: str) -> int:
    s = s.replace(",", "").replace('"', "").strip()
    try:
        return int(s)
    except ValueError:
        return 0


def main() -> None:
    rows_confident: list[dict] = []
    rows_uncertain: list[dict] = []

    with SRC.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            content = norm(r["ご利用内容"])
            if not content:
                continue
            amount = parse_amount(r["金額"])
            if is_personal(content):
                continue
            if is_starbucks_charge(content, amount):
                continue
            cls = classify(content)
            base = {
                "ご利用日": r["ご利用日"],
                "ご利用内容": content,
                "金額": amount,
                "海外通貨利用金額": r.get("海外通貨利用金額", ""),
            }
            if cls:
                kamoku, memo, _ = cls
                base["勘定科目候補"] = kamoku
                base["メモ"] = memo
                rows_confident.append(base)
            elif any(k in content for k in UNCERTAIN_KEYWORDS):
                base["勘定科目候補"] = "?"
                base["メモ"] = "業務利用なら経費可（要判断）"
                rows_uncertain.append(base)

    rows_confident.sort(key=lambda r: r["ご利用日"])
    rows_uncertain.sort(key=lambda r: r["ご利用日"])

    fieldnames = ["ご利用日", "ご利用内容", "金額", "海外通貨利用金額", "勘定科目候補", "メモ"]
    for path, rows in [(OUT, rows_confident), (OUT_UNCERTAIN, rows_uncertain)]:
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    total_c = sum(r["金額"] for r in rows_confident if r["金額"] > 0)
    refund_c = sum(r["金額"] for r in rows_confident if r["金額"] < 0)
    print(f"【確実】 件数: {len(rows_confident)}  合計: ¥{total_c:,}  返金: ¥{refund_c:,}")
    print(f"【保留】 件数: {len(rows_uncertain)}")
    print(f"出力: {OUT}")
    print(f"出力: {OUT_UNCERTAIN}")

    from collections import defaultdict
    by_kamoku: dict[str, dict] = defaultdict(lambda: {"件数": 0, "金額": 0})
    for r in rows_confident:
        b = by_kamoku[r["勘定科目候補"]]
        b["件数"] += 1
        b["金額"] += r["金額"]
    print("\n--- 科目別内訳（確実分） ---")
    for k, v in sorted(by_kamoku.items(), key=lambda kv: -kv[1]["金額"]):
        print(f"  {k}: {v['件数']}件 / ¥{v['金額']:,}")


if __name__ == "__main__":
    main()
