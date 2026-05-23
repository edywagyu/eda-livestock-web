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
      stripePriceId: 'price_1TW74kGSkhU1UEcizECKFnxX',
      name: 'サーロインステーキ', variant: '1枚 200g',
      price: 3400, weight: 200, stock: 18, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Sirloin Steak',
      description: 'ロース芯から切り出した一枚。塩のみで、フライパンに 90 秒。日曜の昼食に。',
      images: ['public/images/products/drive/sirloin.jpg']
    },
    {
      productId: 'P002', variantId: 'RED-MEAT', sku: 'EDA-REDMEAT-200',
      stripePriceId: 'price_1TW74lGSkhU1UEciEKMUIbJy',
      name: '赤身ステーキ', variant: '1枚 200g',
      price: 3400, weight: 200, stock: 15, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Red Meat Steak',
      description: 'モモの中心から、繊維の細かい部分だけを。脂が少なく、鉄分が高い。',
      images: ['public/images/products/drive/red-meat.jpg']
    },
    {
      productId: 'P003', variantId: 'CUBE-STEAK', sku: 'EDA-CUBE-200',
      stripePriceId: 'price_1TW74mGSkhU1UEcibOx5C7Py',
      name: 'サイコロステーキ', variant: '1袋 200g',
      price: 1000, weight: 200, stock: 22, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Cube Steak',
      description: 'ひと口大に切り分けたステーキ用の正肉。お弁当や、忙しい平日の夕食に。',
      images: ['public/images/products/drive/cube-steak.jpg']
    },

    /* ===== 牛肉 スライス・切り落とし ===== */
    {
      productId: 'P004', variantId: 'WAGYU-SLICE', sku: 'EDA-WSLICE-200',
      stripePriceId: 'price_1TW74nGSkhU1UEcibaOeMrwf',
      name: '赤身スライス', variant: '1袋 200g',
      price: 2600, weight: 200, stock: 12, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wagyu Slice',
      description: '2mm 厚の薄切り。出汁に数秒くぐらせる、しゃぶしゃぶに。すき焼きにも。',
      images: ['public/images/products/drive/wagyu-slice.jpg']
    },
    {
      productId: 'P005', variantId: 'KIRIOTOSHI', sku: 'EDA-KIRI-200',
      stripePriceId: 'price_1TW74nGSkhU1UEcigrD4ATBJ',
      name: '切り落とし', variant: '1袋 200g',
      price: 1600, weight: 200, stock: 30, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Kiriotoshi',
      description: '部位を選ばず集めた、家庭用の切り落とし。煮込み、炒め、丼に。',
      images: ['public/images/products/drive/kiriotoshi.jpg']
    },

    /* ===== 牛肉 焼肉系 ===== */
    {
      productId: 'P006', variantId: 'YAKINIKU-BRISKET', sku: 'EDA-YAKI-200',
      stripePriceId: 'price_1TW74oGSkhU1UEciOHnR8RAf',
      name: 'バラ焼肉', variant: '1袋 200g',
      price: 1500, weight: 200, stock: 11, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Yakiniku · Brisket',
      description: 'バラ肉を焼肉用に。赤身と脂が交互に重なる、三枚肉の構造。塩で、タレで。',
      images: ['public/images/products/drive/yakiniku-brisket.jpg']
    },
    {
      productId: 'P007', variantId: 'OFFAL', sku: 'EDA-OFFAL-150',
      stripePriceId: 'price_1TW74pGSkhU1UEcizY8WlJPz',
      name: 'ホルモン', variant: '1袋 150g',
      price: 840, weight: 150, stock: 8, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Offal',
      description: '小腸と大腸のミックス。下処理済み。もつ鍋に、焼きホルモンに。',
      images: ['public/images/products/drive/offal.jpg']
    },

    /* ===== 牛肉 加工品 ===== */
    {
      productId: 'P008', variantId: 'HAMBURG', sku: 'EDA-HAMBURG-100',
      stripePriceId: 'price_1TW74qGSkhU1UEciphBYGBDO',
      name: 'ハンバーグ', variant: '1個 100g',
      price: 760, weight: 100, stock: 40, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wagyu Hamburg',
      description: '和牛 100%。冷凍庫で 6 ヶ月、フライパンで蒸し焼き 8 分。',
      images: ['public/images/products/drive/hamburg.jpg']
    },
    {
      productId: 'P009', variantId: 'ROAST-BEEF', sku: 'EDA-ROAST-100',
      stripePriceId: 'price_1TW74qGSkhU1UEciK9LE14vR',
      name: 'ローストビーフ', variant: '1袋 100g',
      price: 3000, weight: 100, stock: 6, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Roast Beef',
      description: '赤身を低温でロースト。解凍して、薄く切る。会の前菜に。',
      images: ['public/images/products/drive/thin-roast.jpg']
    },
    {
      productId: 'P010', variantId: 'RAW-HAM', sku: 'EDA-RAWHAM-40',
      stripePriceId: 'price_1TW74rGSkhU1UEcidTIwRPd5',
      name: '生ハム', variant: '個包装 40g',
      price: 1250, weight: 40, stock: 14, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Raw Ham',
      description: '赤身を低温で長時間熟成。豚とは異なる、和牛だけの深み。ワインの夕べに。',
      images: ['public/images/products/drive/raw-ham.jpg']
    },
    {
      productId: 'P010B', variantId: 'WAGYU-MINCED', sku: 'EDA-WGYMINCED-200',
      stripePriceId: 'price_1TW74sGSkhU1UEci63HCdIsL',
      name: 'ミンチ', variant: '1袋 200g',
      price: 1350, weight: 200, stock: 14, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wagyu Minced',
      description: '和牛 100% の粗挽き。ハンバーグ、ボロネーゼ、キーマカレーに。',
      images: ['public/images/products/drive/minced.jpg']
    },

    /* ===== 鶏肉 平飼い（標準）— 250g パック ===== */
    {
      productId: 'P011', variantId: 'CHK-BREAST', sku: 'EDA-CHK-BREAST-250',
      stripePriceId: 'price_1TW74sGSkhU1UEcij8xFudVT',
      name: '平飼い鶏 ムネ', variant: '1袋 250g',
      price: 640, weight: 250, stock: 20, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Breast',
      description: '大分県・無投薬の平飼い農家のもの。低脂肪・高タンパク。サラダチキン、バンバンジーに。',
      images: ['public/images/products/drive/chicken-breast.jpg']
    },
    {
      productId: 'P012', variantId: 'CHK-THIGH', sku: 'EDA-CHK-THIGH-250',
      stripePriceId: 'price_1TW74tGSkhU1UEcilbKbPhGv',
      name: '平飼い鶏 モモ', variant: '1袋 250g',
      price: 640, weight: 250, stock: 24, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Thigh',
      description: '大分県・無投薬の平飼い農家のもの。照り焼き、唐揚げ、煮込みまで。',
      images: ['public/images/products/drive/chicken-thigh.jpg']
    },
    {
      productId: 'P013', variantId: 'CHK-MINCED', sku: 'EDA-CHK-MINCED-250',
      stripePriceId: 'price_1TW74uGSkhU1UEciOv09JHuD',
      name: '平飼い鶏 ミンチ', variant: '1袋 250g',
      price: 500, weight: 250, stock: 16, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Minced',
      description: '大分県・無投薬の平飼い農家のもの。つくね、そぼろ、鶏団子鍋に。',
      images: ['public/images/products/drive/chicken-minced.jpg']
    },

    /* ===== 鶏肉 オーガニック（プレミアム）— 250g パック ===== */
    {
      productId: 'P014', variantId: 'ORG-CHK-BREAST', sku: 'EDA-ORG-CHK-BREAST-250',
      stripePriceId: 'price_1TW74uGSkhU1UEciG30csXKD',
      name: 'オーガニックチキン ムネ', variant: '1袋 250g',
      price: 1920, weight: 250, stock: 6, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Breast',
      isOrganic: true,
      description: '千葉県・有機 JAS 認証相当の無農薬飼料、無投薬。提携農家から、月に少量だけ。',
      images: ['public/images/products/drive/chicken-breast.jpg']
    },
    {
      productId: 'P015', variantId: 'ORG-CHK-THIGH', sku: 'EDA-ORG-CHK-THIGH-250',
      stripePriceId: 'price_1TW74vGSkhU1UEci6e5u6hec',
      name: 'オーガニックチキン モモ', variant: '1袋 250g',
      price: 1920, weight: 250, stock: 6, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Thigh',
      isOrganic: true,
      description: '千葉県・有機 JAS 認証相当の無農薬飼料、無投薬。提携農家から、月に少量だけ。',
      images: ['public/images/products/drive/chicken-thigh.jpg']
    },
    {
      productId: 'P016', variantId: 'ORG-CHK-MINCED', sku: 'EDA-ORG-CHK-MINCED-250',
      stripePriceId: 'price_1TW74wGSkhU1UEciMfeKnO9W',
      name: 'オーガニックチキン ミンチ', variant: '1袋 250g',
      price: 1500, weight: 250, stock: 5, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Minced',
      isOrganic: true,
      description: '千葉県・有機 JAS 認証相当の無農薬飼料、無投薬。離乳食、つくねに。',
      images: ['public/images/products/drive/chicken-minced.jpg']
    },

    /* ===== ギフトボックス（送料込み・税込） ===== */
    {
      productId: 'P017', variantId: 'GIFT-MATSU', sku: 'EDA-GIFT-MATSU-450',
      stripePriceId: 'price_1TW74xGSkhU1UEcibF0y54Yd',
      name: 'ヒレステーキ ギフト【松】', variant: '450g',
      price: 16800, weight: 450, stock: 10, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · MATSU',
      description: '希少部位のヒレ、450g。脂が少なく、繊維がきめ細かい。大切な方への一品に。',
      images: ['public/images/products/drive/fillet.jpg']
    },
    {
      productId: 'P018', variantId: 'GIFT-TAKE', sku: 'EDA-GIFT-TAKE-750',
      stripePriceId: 'price_1TW74xGSkhU1UEciDCqXHlsi',
      name: '赤身ステーキ ギフト【竹】', variant: '750g',
      price: 12800, weight: 750, stock: 12, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · TAKE',
      description: '赤身ステーキを 750g。脂が少なく、鉄分が高い。健康を気遣う方への贈り物に。',
      images: ['public/images/products/drive/red-meat.jpg']
    },
    {
      productId: 'P019', variantId: 'GIFT-UME', sku: 'EDA-GIFT-UME-500',
      stripePriceId: 'price_1TW74yGSkhU1UEci45Gc54Xx',
      name: '和牛ハンバーグ ギフト【梅】', variant: '5個 / 100g×5',
      price: 5980, weight: 500, stock: 18, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · UME',
      description: '和牛 100% のハンバーグを 5 個。ご家庭への手土産に。',
      images: ['public/images/products/drive/hamburg.jpg']
    },

    /* ===== 有機JAS 黒毛和牛（2026年夏 解禁・予約受付前） ===== */
    {
      productId: 'P020', variantId: 'ORG-WAGYU-SIRLOIN', sku: 'EDA-ORG-WGY-SIRLOIN',
      name: '有機JAS サーロイン', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Sirloin',
      isOrganic: true, comingSoon: true,
      description: '世界初の有機JAS認証 黒毛和牛サーロイン。月間20頭限定出荷。',
      images: []
    },
    {
      productId: 'P021', variantId: 'ORG-WAGYU-RIBEYE', sku: 'EDA-ORG-WGY-RIBEYE',
      name: '有機JAS リブアイ', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Ribeye',
      isOrganic: true, comingSoon: true,
      description: '2026年夏 解禁。霜降りと赤身の完璧なバランス。希少な有機リブアイ。',
      images: []
    },
    {
      productId: 'P022', variantId: 'ORG-WAGYU-FILLET', sku: 'EDA-ORG-WGY-FILLET',
      name: '有機JAS ヒレ', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Fillet',
      isOrganic: true, comingSoon: true,
      description: '希少部位のヒレ、有機JAS認証。最高峰の一品。',
      images: []
    }
  ];

  /* バージョン情報（キャッシュバスター用） */
  const PRODUCTS_VERSION = '2026.05.12-006-stripe';

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
