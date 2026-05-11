/* ============================================================
   江田畜産 商品マスター — 単一データソース (Single Source of Truth)
   ------------------------------------------------------------
   このファイルが shop.html / staff.html / subscription.html /
   checkout.html / products.html すべての商品データの正本です。

   ✓ 商品名、価格、容量、説明、画像、SKU、すべてここから読み取る
   ✓ 修正はこのファイルだけ — 他ページは自動で反映
   ✓ window.EDA_PRODUCTS_MASTER に公開（グローバル）

   カテゴリ:
     beef         — 牛肉（標準ライン）
     chicken      — 鶏肉（平飼い・標準）
     chicken-org  — 鶏肉（オーガニック）
     gift         — ギフトボックス
     organic-wgy  — 有機JAS和牛（2026年夏 解禁・予約受付前）
   ============================================================ */

(function(global) {
  'use strict';

  const PRODUCTS_MASTER = [
    /* ===== 牛肉 ステーキ系 ===== */
    {
      productId: 'P001', variantId: 'SIRLOIN', sku: 'EDA-SIRLOIN-200',
      name: 'サーロインステーキ', variant: '1枚 200g',
      price: 3400, weight: 200, stock: 18, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Sirloin Steak',
      description: '背中のロース芯の最上部。きめ細かなサシが赤身と脂のバランスを生む部位。焼くだけで完結。',
      images: ['public/images/products/drive/sirloin.jpg']
    },
    {
      productId: 'P002', variantId: 'RED-MEAT', sku: 'EDA-REDMEAT-250',
      name: '赤身ステーキ', variant: '1枚 250g',
      price: 3400, weight: 250, stock: 15, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Red Meat Steak',
      description: 'モモ系の赤身から、柔らかい部分を厳選カット。脂身が少なく、鉄分・たんぱく質がしっかり摂れる。',
      images: ['public/images/products/drive/red-meat.jpg']
    },
    {
      productId: 'P003', variantId: 'CUBE-STEAK', sku: 'EDA-CUBE-200',
      name: 'サイコロステーキ', variant: '1袋 200g',
      price: 1000, weight: 200, stock: 22, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Cube Steak',
      description: 'ステーキ用の正肉を一口大にカット。フライパンで転がすだけ。お子さまにも大人気。',
      images: ['public/images/products/drive/cube-steak.jpg']
    },

    /* ===== 牛肉 スライス・切り落とし ===== */
    {
      productId: 'P004', variantId: 'WAGYU-SLICE', sku: 'EDA-WSLICE-200',
      name: '赤身スライス', variant: '1袋 200g',
      price: 2600, weight: 200, stock: 12, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wagyu Slice',
      description: '約2mm厚の薄切り。しゃぶしゃぶなら出汁に数秒くぐらせるだけ。すき焼き、冷しゃぶサラダにも。',
      images: ['public/images/products/drive/wagyu-slice.jpg']
    },
    {
      productId: 'P005', variantId: 'KIRIOTOSHI', sku: 'EDA-KIRI-200',
      name: '和牛切り落とし', variant: '1袋 200g',
      price: 1600, weight: 200, stock: 30, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Kiriotoshi',
      description: '部位の端材を集めたお得な切り落とし。牛丼・カレー・肉じゃが・炒め物に。冷凍ストックの主役。',
      images: ['public/images/products/drive/kiriotoshi.jpg']
    },

    /* ===== 牛肉 焼肉系 ===== */
    {
      productId: 'P006', variantId: 'YAKINIKU-BRISKET', sku: 'EDA-YAKI-150',
      name: 'バラ焼肉', variant: '1袋 150g',
      price: 1900, weight: 150, stock: 11, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Yakiniku · Brisket',
      description: 'バラ肉を焼肉用にカット。赤身と脂が交互の「三枚肉」構造。タレでも塩レモンでも。',
      images: ['public/images/products/drive/yakiniku-brisket.jpg']
    },
    {
      productId: 'P007', variantId: 'OFFAL', sku: 'EDA-OFFAL-150',
      name: '和牛ホルモン', variant: '1袋 150g',
      price: 840, weight: 150, stock: 8, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Offal',
      description: '小腸・大腸ミックスホルモン。下処理済みでそのまま調理可能。もつ鍋、焼きホルモンに。',
      images: ['public/images/products/drive/yakiniku-brisket.jpg']
    },

    /* ===== 牛肉 加工品 ===== */
    {
      productId: 'P008', variantId: 'HAMBURG', sku: 'EDA-HAMBURG-100',
      name: '江田和牛ハンバーグ', variant: '1個 100g',
      price: 760, weight: 100, stock: 40, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wagyu Hamburg',
      description: '和牛100%のシンプル配合。冷蔵庫で半日解凍してからフライパンで蒸し焼き。お子さまの夕食に。',
      images: ['public/images/products/drive/hamburg.jpg']
    },
    {
      productId: 'P009', variantId: 'ROAST-BEEF', sku: 'EDA-ROAST-100',
      name: '和牛ローストビーフ', variant: '1袋 100g',
      price: 3000, weight: 100, stock: 6, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Roast Beef',
      description: '赤身を低温でじっくりロースト。解凍して薄くスライスするだけ。パーティーの前菜に。',
      images: ['public/images/products/drive/hamburg.jpg']
    },
    {
      productId: 'P010', variantId: 'RAW-HAM', sku: 'EDA-RAWHAM-40',
      name: '和牛生ハム', variant: '個包装 40g',
      price: 1250, weight: 40, stock: 14, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Raw Ham',
      description: '江田和牛の赤身を低温で長時間熟成。豚の生ハムとはまったく異なる深みのある旨み。ワインに。',
      images: ['public/images/products/drive/wagyu-slice.jpg']
    },

    /* ===== 鶏肉 平飼い（標準） ===== */
    {
      productId: 'P011', variantId: 'CHK-BREAST', sku: 'EDA-CHK-BREAST-500',
      name: '平飼い鶏 ムネ', variant: '1袋 500g',
      price: 1280, weight: 500, stock: 20, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Breast',
      description: '高タンパク・低脂肪のムネ肉。無投薬の平飼い鶏は身が締まって旨みが濃い。',
      images: ['public/images/products/drive/chicken-breast.jpg']
    },
    {
      productId: 'P012', variantId: 'CHK-THIGH', sku: 'EDA-CHK-THIGH-500',
      name: '平飼い鶏 モモ', variant: '1袋 500g',
      price: 1280, weight: 500, stock: 24, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Thigh',
      description: '大分県産 平飼い・無投薬。照り焼き・唐揚げ・煮込みまで万能。',
      images: ['public/images/products/drive/chicken-thigh.jpg']
    },
    {
      productId: 'P013', variantId: 'CHK-MINCED', sku: 'EDA-CHK-MINCED-300',
      name: '平飼い鶏 ミンチ', variant: '1袋 300g',
      price: 1000, weight: 300, stock: 16, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Minced',
      description: 'つくね、そぼろ、鶏団子鍋に。無投薬で離乳食にも安心。',
      images: ['public/images/products/drive/chicken-minced.jpg']
    },

    /* ===== 鶏肉 オーガニック（3倍価格） ===== */
    {
      productId: 'P014', variantId: 'ORG-CHK-BREAST', sku: 'EDA-ORG-CHK-BREAST-500',
      name: 'オーガニックチキン ムネ', variant: '1袋 500g',
      price: 3840, weight: 500, stock: 6, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Breast',
      isOrganic: true,
      description: '有機JAS認証相当の無農薬飼料・無投薬で育てたオーガニック平飼い鶏。健康志向の食卓へ最高峰の一品。',
      images: ['public/images/products/drive/chicken-breast.jpg']
    },
    {
      productId: 'P015', variantId: 'ORG-CHK-THIGH', sku: 'EDA-ORG-CHK-THIGH-500',
      name: 'オーガニックチキン モモ', variant: '1袋 500g',
      price: 3840, weight: 500, stock: 6, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Thigh',
      isOrganic: true,
      description: '有機JAS認証相当の無農薬飼料・無投薬。脂と旨みが凝縮されたプレミアム部位。',
      images: ['public/images/products/drive/chicken-thigh.jpg']
    },
    {
      productId: 'P016', variantId: 'ORG-CHK-MINCED', sku: 'EDA-ORG-CHK-MINCED-300',
      name: 'オーガニックチキン ミンチ', variant: '1袋 300g',
      price: 3000, weight: 300, stock: 5, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Minced',
      isOrganic: true,
      description: '有機JAS認証相当の無農薬飼料・無投薬。最高級のオーガニック鶏ミンチ。離乳食・つくねに。',
      images: ['public/images/products/drive/chicken-minced.jpg']
    },

    /* ===== ギフトボックス（送料込み・税込） ===== */
    {
      productId: 'P017', variantId: 'GIFT-MATSU', sku: 'EDA-GIFT-MATSU-500',
      name: 'サーロインステーキ ギフト【松】', variant: '2枚 500g',
      price: 16800, weight: 500, stock: 10, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · MATSU',
      description: '江田畜産の自慢のサーロインステーキを2枚（合計500g）。健康志向の方への贈り物として。送料込み・税込。',
      images: ['public/images/products/drive/sirloin.jpg']
    },
    {
      productId: 'P018', variantId: 'GIFT-TAKE', sku: 'EDA-GIFT-TAKE-500',
      name: '赤身ステーキ ギフト【竹】', variant: '2枚 500g',
      price: 12800, weight: 500, stock: 12, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · TAKE',
      description: '脂身少なく鉄分・たんぱく質がしっかり摂れる赤身ステーキを2枚（合計500g）。健康を気遣う方へ。送料込み・税込。',
      images: ['public/images/products/drive/red-meat.jpg']
    },

    /* ===== 有機JAS 黒毛和牛（2026年夏 解禁・予約受付前） ===== */
    {
      productId: 'P019', variantId: 'ORG-WAGYU-SIRLOIN', sku: 'EDA-ORG-WGY-SIRLOIN',
      name: '有機JAS サーロイン', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Sirloin',
      isOrganic: true, comingSoon: true,
      description: '2026年夏 解禁。世界初の有機JAS認証 黒毛和牛サーロイン。月間20頭限定出荷。',
      images: []
    },
    {
      productId: 'P020', variantId: 'ORG-WAGYU-RIBEYE', sku: 'EDA-ORG-WGY-RIBEYE',
      name: '有機JAS リブアイ', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Ribeye',
      isOrganic: true, comingSoon: true,
      description: '2026年夏 解禁。霜降りと赤身の完璧なバランス。希少な有機リブアイ。',
      images: []
    },
    {
      productId: 'P021', variantId: 'ORG-WAGYU-FILLET', sku: 'EDA-ORG-WGY-FILLET',
      name: '有機JAS ヒレ', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Fillet',
      isOrganic: true, comingSoon: true,
      description: '2026年夏 解禁。希少部位のヒレ、有機JAS認証。最高峰の一品。',
      images: []
    },
    {
      productId: 'P022', variantId: 'ORG-WAGYU-SLICE', sku: 'EDA-ORG-WGY-SLICE',
      name: '有機JAS しゃぶしゃぶ用', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Slice',
      isOrganic: true, comingSoon: true,
      description: '2026年夏 解禁。有機JAS認証のしゃぶしゃぶ用赤身スライス。',
      images: []
    }
  ];

  /* バージョン情報（キャッシュバスター用） */
  const PRODUCTS_VERSION = '2026.05.12-001';

  /* ヘルパー：カテゴリ別取得 */
  function getByCategory(cat) {
    return PRODUCTS_MASTER.filter(p => p.category === cat);
  }

  /* ヘルパー：variantId で検索 */
  function getByVariantId(vid) {
    return PRODUCTS_MASTER.find(p => p.variantId === vid);
  }

  /* グローバル公開 */
  global.EDA_PRODUCTS_MASTER = {
    version: PRODUCTS_VERSION,
    products: PRODUCTS_MASTER,
    getByCategory: getByCategory,
    getByVariantId: getByVariantId
  };

  /* CommonJS 互換（Node でも使えるように） */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.EDA_PRODUCTS_MASTER;
  }
})(typeof window !== 'undefined' ? window : globalThis);
