#!/usr/bin/env python3
"""Build static HTML pages from partials + per-page content + shared CSS.

Each generated page is fully self-contained (CSS inlined) so it works in
the Launch preview panel as well as via http://localhost:8080.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = (ROOT / "styles" / "main.css").read_text()
HEADER = (ROOT / "_partials" / "header.html").read_text()
FOOTER = (ROOT / "_partials" / "footer.html").read_text()
SCRIPTS = (ROOT / "_partials" / "scripts.html").read_text()
CART = (ROOT / "_partials" / "cart.html").read_text()

FONTS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&'
    'family=Inter:wght@400;500;600&'
    'family=Noto+Sans+JP:wght@400;500;700&'
    'family=Noto+Serif+JP:wght@400;500;700&'
    'family=Oswald:wght@400;600&display=swap" rel="stylesheet">'
)


def shell(content: str, title: str, description: str, current_nav: str = "") -> str:
    """Wrap page content in the full HTML shell."""
    header = HEADER
    if current_nav:
        # Mark the current nav link
        target = f'<a href="{current_nav}">'
        header = header.replace(target, target.replace('<a ', '<a class="current" '))
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{description}">
{FONTS}
<style>{CSS}</style>
</head>
<body>
{header}
{content}
{FOOTER}
{CART}
{SCRIPTS}
</body>
</html>
"""


PAGES = [
    {"src": "home.html",        "out": "index.html",        "nav": "",                  "title": "EDA-LIVESTOCK | 100年続く畜産を、20代の世代がつくる。", "desc": "宮崎の畜産スタートアップ江田畜産。化学物質不使用・循環型農業で育てた江田和牛を、世界10カ国以上に届けています。"},
    {"src": "about.html",       "out": "about.html",        "nav": "about.html",        "title": "About | EDA-LIVESTOCK", "desc": "江田畜産は2023年に宮崎で創業した畜産スタートアップ。20代の経営チームが、100年先まで続く畜産業を創ります。"},
    {"src": "philosophy.html",  "out": "philosophy.html",   "nav": "philosophy.html",   "title": "Philosophy | 4本柱 | EDA-LIVESTOCK", "desc": "格付けではなく、育て方で選ばれる和牛へ。循環型飼料・化学物質不使用・アニマルウェルフェア・天然水の4つの約束。"},
    {"src": "organic.html",     "out": "organic.html",      "nav": "",                  "title": "Organic Wagyu 2026 | EDA-LIVESTOCK", "desc": "2026年1月、世界初のオーガニック認証和牛「特選江田和牛」がローンチ。"},
    {"src": "global.html",      "out": "global.html",       "nav": "global.html",       "title": "Global | 世界10カ国以上に展開 | EDA-LIVESTOCK", "desc": "創業1年で1カ国から13カ国へ。アジア・北米・EU・中東のホテル・百貨店・高級スーパーで採用されています。"},
    {"src": "restaurants.html", "out": "restaurants.html",  "nav": "restaurants.html",  "title": "Restaurants | 江田和牛が食べられるお店 | EDA-LIVESTOCK", "desc": "国内外のホテル・レストラン・百貨店で江田和牛をお召し上がりいただけます。予約はこちらから。"},
    {"src": "shop.html",        "out": "shop.html",         "nav": "shop.html",         "title": "Shop | オンラインショップ | EDA-LIVESTOCK", "desc": "江田和牛と平飼い鶏のオンラインショップ。最短2日でお届け、¥11,000以上で送料無料。"},
    {"src": "journal.html",     "out": "journal.html",      "nav": "journal.html",      "title": "Journal | 江田畜産の記録 | EDA-LIVESTOCK", "desc": "創業ストーリー、農場の四季、シェフとの対話。江田畜産が発信するオウンドメディア。"},
    {"src": "press.html",       "out": "press.html",        "nav": "press.html",        "title": "Press & Media | プレス・メディア掲載 | EDA-LIVESTOCK", "desc": "NHK、日経、PR TIMES、Forbes JAPAN、ソフトバンク公式、農水省公式に取り上げられた江田畜産の取り組み・受賞・パートナーシップを集約。"},
    {"src": "press-kit.html",   "out": "press-kit.html",    "nav": "press.html",        "title": "Press Kit | ロゴ・写真・プロフィール | EDA-LIVESTOCK", "desc": "取材・記事掲載向けのロゴデータ、メンバー写真、商品画像、会社プロフィールPDFをご請求いただけます。"},
    {"src": "awards.html",      "out": "awards.html",       "nav": "press.html",        "title": "Awards & Certifications | 受賞・認証 | EDA-LIVESTOCK", "desc": "世界初オーガニック認証、4年連続内閣総理大臣賞受賞血統、ANAファーストクラス採用、京王百貨店60周年記念選定。"},
    {"src": "journey.html",     "out": "journey.html",      "nav": "about.html",        "title": "Our Journey | 江田畜産の軌跡 | EDA-LIVESTOCK", "desc": "2023年4月の創業から、2026年世界初オーガニック認証取得まで。江田畜産がたどった3年間の軌跡。"},
    {"src": "investors.html",   "out": "investors.html",    "nav": "",                  "title": "Investor Relations | 投資家・パートナーへ | EDA-LIVESTOCK", "desc": "20代のチームとテクノロジーで日本の畜産業に挑む江田畜産の成長戦略・市場機会・ESGをご紹介します。"},
    {"src": "recipes.html",     "out": "recipes.html",      "nav": "shop.html",         "title": "Recipes & Pairings | シェフ監修レシピ | EDA-LIVESTOCK", "desc": "ザ・リッツ・カールトン福岡「幻珠」、東京ステーションホテル、杉浦仁志シェフ監修。江田和牛のシグネチャーレシピとペアリングガイド。"},
    {"src": "gallery.html",     "out": "gallery.html",      "nav": "",                  "title": "Gallery | 江田畜産の世界観 | EDA-LIVESTOCK", "desc": "農場・牛舎・商品・イベント・パートナー。江田畜産の世界観を写真でご紹介します。"},
    {"src": "subscription.html","out": "subscription.html", "nav": "shop.html",         "title": "Subscription | 定期便 | EDA-LIVESTOCK", "desc": "わずか1%の無添加飼育農家が育てた江田和牛と平飼い鶏を、毎月ご自宅へ。3つのプランから選べる定期便。初月最大50%OFF。"},
    {"src": "journal-1.html",   "out": "journal-1.html",    "nav": "journal.html",      "title": "なぜ20代で畜産を選んだのか | Journal | EDA-LIVESTOCK", "desc": "創業者・江田友輝が語る、家業ではなく、ひとつの事業として畜産を選んだ理由。"},
    {"src": "members.html",     "out": "members.html",      "nav": "members.html",      "title": "Members | チーム | EDA-LIVESTOCK", "desc": "20代の経営チームが、平均年齢70歳超の畜産業界に新しい風を吹き込みます。"},
    {"src": "contact.html",     "out": "contact.html",      "nav": "",                  "title": "Contact | お問い合わせ | EDA-LIVESTOCK", "desc": "卸・取材・パートナーシップ・一般のお問い合わせはこちらから。"},
    {"src": "booking.html",     "out": "booking.html",      "nav": "",                  "title": "Book a Meeting | 商談予約 | EDA-LIVESTOCK", "desc": "江田畜産との商談・お打ち合わせをオンラインで予約。国内・海外バイヤー対応。Google Calendar 連携。"},
]


def main():
    pages_dir = ROOT / "_pages"
    built = 0
    for p in PAGES:
        src = pages_dir / p["src"]
        if not src.exists():
            print(f"SKIP (no source): {p['src']}")
            continue
        content = src.read_text()
        html = shell(content, p["title"], p["desc"], p["nav"])
        (ROOT / p["out"]).write_text(html)
        built += 1
        print(f"Built: {p['out']}")
    print(f"\n{built} page(s) built.")


if __name__ == "__main__":
    main()
