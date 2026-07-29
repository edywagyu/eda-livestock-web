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
      stripePriceId: 'price_1TfvbIGSkhU1UEciDITKBlbx',
      name: 'サイコロステーキ', variant: '1袋 200g',
      price: 1800, weight: 200, stock: 22, temp: '冷凍',
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
      productId: 'P007', variantId: 'OFFAL', sku: 'EDA-OFFAL-200',
      stripePriceId: 'price_1TW74pGSkhU1UEcizY8WlJPz',
      name: 'ホルモン', variant: '1袋 200g',
      price: 840, weight: 200, stock: 8, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Offal',
      description: '小腸と大腸のミックス。下処理済み。もつ鍋に、焼きホルモンに。',
      images: ['public/images/products/drive/offal.jpg']
    },

    /* ===== 牛肉 加工品 ===== */
    {
      productId: 'P008', variantId: 'HAMBURG', sku: 'EDA-HAMBURG-130',
      stripePriceId: 'price_1TW74qGSkhU1UEciphBYGBDO',
      name: 'ハンバーグ', variant: '1個 130g',
      price: 760, weight: 130, stock: 40, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wagyu Hamburg',
      description: '和牛 100%。冷凍庫で 6 ヶ月、フライパンで蒸し焼き 8 分。',
      images: ['public/images/products/drive/hamburg.jpg']
    },
    {
      productId: 'P009', variantId: 'ROAST-BEEF', sku: 'EDA-ROAST-300',
      stripePriceId: 'price_1Tcbx9GSkhU1UEcik9aUn4RT',
      name: 'ローストビーフ', variant: '1袋 300g',
      price: 7400, weight: 300, stock: 6, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Roast Beef',
      description: '赤身を低温でロースト。解凍して、薄く切る。会の前菜に。',
      images: ['public/images/products/drive/thin-roast.jpg']
    },
    {
      productId: 'P010', variantId: 'RAW-HAM', sku: 'EDA-RAWHAM-50',
      stripePriceId: 'price_1TW74rGSkhU1UEcidTIwRPd5',
      name: '生ハム', variant: '個包装 50g',
      price: 1250, weight: 50, stock: 14, temp: '冷凍',
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

    /* ===== 新商品 2026-07 (Stripe Price ID は友輝側で発行後に記入) ===== */
    {
      productId: 'P023', variantId: 'MISUJI-STEAK', sku: 'EDA-MISUJI-150',
      stripePriceId: '',
      name: 'ミスジステーキ', variant: '1枚 150g',
      price: 3500, weight: 150, stock: 12, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Misuji Steak',
      description: '肩甲骨の内側の希少部位。細かなサシと赤身の旨みが同居。厚めのレア焼きで。',
      images: ['public/images/products/drive/misuji-steak.jpg']
    },
    {
      productId: 'P024', variantId: 'HIRE-STEAK', sku: 'EDA-HIRE-150',
      stripePriceId: '',
      name: 'ヒレステーキ', variant: '1枚 150g',
      price: 4750, weight: 150, stock: 10, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Fillet Steak',
      description: '一頭から約3%だけの、最もやわらかい部位。記念日の一枚に。',
      images: ['public/images/products/drive/hire-steak.jpg']
    },
    {
      productId: 'P025', variantId: 'AKAMI-YAKINIKU', sku: 'EDA-AKAYAKI-200',
      stripePriceId: '',
      name: '赤身焼肉', variant: '1袋 200g',
      price: 2400, weight: 200, stock: 20, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Red Meat Yakiniku',
      description: 'ウデの赤身を焼肉用にカット。脂は控えめ、噛むほどに肉の味が濃い。',
      images: ['public/images/products/drive/akami-yakiniku.jpg']
    },
    {
      productId: 'P026', variantId: 'SHIMOFURI-SLICE', sku: 'EDA-SHIMOSLICE-200',
      stripePriceId: '',
      name: '霜降スライス', variant: '1袋 200g',
      price: 3700, weight: 200, stock: 10, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Marbled Slice',
      description: '霜降り部分を約2mm厚の薄切りに。すき焼き・しゃぶしゃぶで脂の甘みがだしに溶ける。',
      images: ['public/images/products/drive/shimofuri-slice.jpg']
    },

    /* ===== 鶏肉 平飼い（標準）— 200g パック ===== */
    {
      productId: 'P011', variantId: 'CHK-BREAST', sku: 'EDA-CHK-BREAST-200',
      stripePriceId: 'price_1TccuZGSkhU1UEciW3KDATtw',
      name: '平飼い鶏 ムネ', variant: '1袋 200g',
      price: 920, weight: 200, stock: 20, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Breast',
      description: '大分県・無投薬の平飼い農家のもの。低脂肪・高タンパク。サラダチキン、バンバンジーに。',
      images: ['public/images/products/drive/chicken-breast.jpg']
    },
    {
      productId: 'P012', variantId: 'CHK-THIGH', sku: 'EDA-CHK-THIGH-200',
      stripePriceId: 'price_1TccurGSkhU1UEciMqEddsVz',
      name: '平飼い鶏 モモ', variant: '1袋 200g',
      price: 980, weight: 200, stock: 24, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Thigh',
      description: '大分県・無投薬の平飼い農家のもの。照り焼き、唐揚げ、煮込みまで。',
      images: ['public/images/products/drive/chicken-thigh.jpg']
    },
    {
      productId: 'P013', variantId: 'CHK-MINCED', sku: 'EDA-CHK-MINCED-200',
      stripePriceId: 'price_1Tccv0GSkhU1UEcils0CrikT',
      name: '平飼い鶏 ミンチ', variant: '1袋 200g',
      price: 800, weight: 200, stock: 16, temp: '冷凍',
      category: 'chicken', categoryLabel: '鶏肉', tagEn: 'Chicken · Minced',
      description: '大分県・無投薬の平飼い農家のもの。つくね、そぼろ、鶏団子鍋に。',
      images: ['public/images/products/drive/chicken-minced.jpg']
    },

    /* ===== 鶏肉 オーガニック（プレミアム）— 200g パック ===== */
    {
      productId: 'P014', variantId: 'ORG-CHK-BREAST', sku: 'EDA-ORG-CHK-BREAST-200',
      stripePriceId: 'price_1Tccv8GSkhU1UEciIJRR3EgR',
      name: 'オーガニックチキン ムネ', variant: '1袋 200g',
      price: 2760, weight: 200, stock: 6, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Breast',
      isOrganic: true,
      description: '千葉県・有機 JAS 認証相当の無農薬飼料、無投薬。提携農家から、月に少量だけ。',
      images: ['public/images/products/drive/chicken-breast.jpg']
    },
    {
      productId: 'P015', variantId: 'ORG-CHK-THIGH', sku: 'EDA-ORG-CHK-THIGH-200',
      stripePriceId: 'price_1TccvFGSkhU1UEcieBG9ameg',
      name: 'オーガニックチキン モモ', variant: '1袋 200g',
      price: 2940, weight: 200, stock: 6, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Thigh',
      isOrganic: true,
      description: '千葉県・有機 JAS 認証相当の無農薬飼料、無投薬。提携農家から、月に少量だけ。',
      images: ['public/images/products/drive/chicken-thigh.jpg']
    },
    {
      productId: 'P016', variantId: 'ORG-CHK-MINCED', sku: 'EDA-ORG-CHK-MINCED-200',
      stripePriceId: 'price_1TccvLGSkhU1UEciMdkgzxet',
      name: 'オーガニックチキン ミンチ', variant: '1袋 200g',
      price: 2400, weight: 200, stock: 5, temp: '冷凍',
      category: 'chicken-org', categoryLabel: '鶏肉', tagEn: 'Organic · Minced',
      isOrganic: true,
      description: '千葉県・有機 JAS 認証相当の無農薬飼料、無投薬。離乳食、つくねに。',
      images: ['public/images/products/drive/chicken-minced.jpg']
    },

    /* ===== ギフトボックス（送料込み・税込） ===== */
    {
      productId: 'P017', variantId: 'GIFT-MATSU', sku: 'EDA-GIFT-MATSU-450',
      stripePriceId: 'price_1TcbwYGSkhU1UEciMRd5Kyu2',
      name: 'ヒレステーキ ギフト【松】', variant: '450g',
      price: 12900, weight: 450, stock: 10, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · MATSU',
      description: '希少部位のヒレ、450g。脂が少なく、繊維がきめ細かい。大切な方への一品に。',
      images: ['public/images/products/drive/fillet.jpg']
    },
    {
      productId: 'P018', variantId: 'GIFT-TAKE', sku: 'EDA-GIFT-TAKE-750',
      stripePriceId: 'price_1TcbwhGSkhU1UEciSyTKt2YQ',
      name: '赤身ステーキ ギフト【竹】', variant: '750g',
      price: 11000, weight: 750, stock: 12, temp: '冷凍',
      category: 'gift', categoryLabel: 'ギフト', tagEn: 'Gift · TAKE',
      description: '赤身ステーキを 750g。脂が少なく、鉄分が高い。健康を気遣う方への贈り物に。',
      images: ['public/images/products/drive/red-meat.jpg']
    },
    {
      productId: 'P019', variantId: 'GIFT-UME', sku: 'EDA-GIFT-UME-650',
      stripePriceId: 'price_1TcbwoGSkhU1UEciEiu3ymJ0',
      name: '和牛ハンバーグ ギフト【梅】', variant: '5個 / 130g×5',
      price: 5500, weight: 650, stock: 18, temp: '冷凍',
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
      description: '2026年夏 解禁。霜降りと赤身の絶妙なバランス。希少な有機リブアイ。',
      images: []
    },
    {
      productId: 'P022', variantId: 'ORG-WAGYU-FILLET', sku: 'EDA-ORG-WGY-FILLET',
      name: '有機JAS ヒレ', variant: '— —',
      price: 0, weight: 0, stock: 0, temp: '冷凍',
      category: 'organic-wgy', categoryLabel: '有機和牛', tagEn: 'Organic · Fillet',
      isOrganic: true, comingSoon: true,
      description: '希少部位のヒレ、有機JAS認証。当牧場を代表する一品。',
      images: []
    },

    /* ===== 肉の日限定セット (2026-07-29) ===== */
    {
      productId: 'P027', variantId: 'NIKUNOHI-SET', sku: 'EDA-NIKUNOHI-SET',
      stripePriceId: '',
      name: '肉の日限定セット', variant: 'ミスジ150g + 切り落とし200g',
      /* stock は GAS(products シート)のライブ在庫で上書きされる。ここは取得失敗時のフォールバック
         なので、実残数（2026-07-29 時点 9 / 限定12のうち3売れ）に合わせておく */
      price: 4500, weight: 350, stock: 9, temp: '冷凍',
      /* 限定品カウント (public/js/limited-stock.js)。正は products シートの
         limitedTotal / limitedUntil / limitedUnit 列。ここは取得失敗時のフォールバック */
      limitedTotal: 12, limitedUntil: '2026/07/29 23:59', limitedUnit: 'セット',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Nikunohi Set',
      limitedTag: 'nikunohi', listPrice: 5100,
      description: '希少部位ミスジのステーキと、万能な切り落としのセット。肉の日だけの特別価格。',
      images: ['public/images/products/drive/nikunohi-set.jpg']
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
