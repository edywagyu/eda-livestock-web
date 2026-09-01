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
      stripePriceId: '',   /* 2026-08-06 ¥1,500→¥1,900。旧Price IDは¥1,500固定で請求されるため外す */
      name: 'バラ焼肉', variant: '1袋 200g',
      price: 1900, weight: 200, stock: 11, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Yakiniku · Brisket',
      description: 'トモバラを使用。焼肉用にカット。赤身と脂が交互に重なる、三枚肉の構造。塩で、タレで。',
      /* 2026-08-15 写真差し替え。yakiniku-brisket.jpg は厚切りの霜降りで
         バラ焼肉の実物と違うため、店頭カードが使っている -2026 に統一。 */
      images: ['public/images/products/drive/yakiniku-brisket-2026.jpg']
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
    /* ミスジステーキ (P023)
       🔴 商品一覧(shop.html / products.html)には出さない。PDP直リンクと
          公式LINE会員限定ページ(line-members.html)だけで売る (2026-08-28 ryotaro確定)。
       2026-08-31: 本日限定の食べ比べ2種(P039/P040)が BOM でこの在庫を共有する。
       セットが売れるとここの stock が減り、セット側の「残り◯セット」も
       構成品から計算し直されるので連動する。だから在庫は分けない。 */
    {
      productId: 'P023', variantId: 'MISUJI-STEAK', sku: 'EDA-MISUJI-150',
      stripePriceId: '',
      name: 'ミスジステーキ', variant: '1枚 150g',
      price: 3500, weight: 150, stock: 7, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Misuji Steak',
      description: '肩甲骨の内側の希少部位。細かなサシと赤身の旨みが同居。厚めのレア焼きで。',
      images: ['public/images/products/drive/misuji-steak.jpg']
    },
    {
      productId: 'P032', variantId: 'HIRE-CUBE', sku: 'EDA-HIRECUBE-200',
      stripePriceId: '',
      name: 'ヒレサイコロステーキ', variant: '1袋 200g',
      price: 2500, weight: 200, stock: 3, temp: '冷凍',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Fillet Steak Cubes',
      description: '一頭から約3%だけのヒレを、ステーキにできない部分までサイコロカットに。希少部位を気軽に。',
      images: []
    },
    {
      productId: 'P024', variantId: 'HIRE-STEAK', sku: 'EDA-HIRE-150',
      stripePriceId: '',
      /* 2026-08-31 田崎さん確認: 1枚は150g（200g表記が誤り）。商品コードEDA-HIRE-150とも一致。
         ギフト【松】450g＝3枚 の内訳とも合う。価格¥4,750は据え置き。 */
      name: 'ヒレステーキ', variant: '1枚 150g',
      price: 4750, weight: 150, stock: 16, temp: '冷凍',
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

    /* ===== 肉の日限定セット（2026-08-27〜08-30 / 8/29 焼肉の日） ===== */
    {
      productId: 'P027', variantId: 'NIKUNOHI-SET', sku: 'EDA-NIKUNOHI-SET',
      stripePriceId: '',
      name: '肉の日限定セット', variant: '赤身焼肉200g×1 + バラ焼肉200g×2',
      /* stock は GAS(products シート)のライブ在庫で上書きされる。ここは取得失敗時のフォールバック。
         2026-08-27 たろ指示で 15→30セットに拡大（赤身焼肉の入荷を受けて）。
         30セットには赤身焼肉30袋・バラ焼肉60袋が要る。上限の管理は
         products シートの stock 側で行う（ここは取得失敗時のフォールバック）。 */
      price: 5800, weight: 600, stock: 30, temp: '冷凍',
      /* BOM。本番DBの components 列と gas/Code.gs の PRODUCT_BOM に同じ内容がある。
         フロントはこれを使って「あと何セット作れるか」を出す
         (products-loader.js の applyBomStock)。セット行の stock は減らないため。 */
      components: [
        { name: '赤身焼肉', qty: 1 },
        { name: 'バラ焼肉', qty: 2 }
      ],
      /* 限定品カウント (public/js/limited-stock.js)。ここが限定設定の正。
         2026-08-30 たろ指示で「販売停止」と「掲示終了」を分けた。
         8/30(日)23:59 で買えなくし、告知は 8/31(月)18:00 まで残す。 */
      limitedTotal: 30,
      limitedSoldOutAt: '2026/08/30 23:59',   /* これ以降＝販売停止＋「完売しました」（表示は残る） */
      limitedUntil:     '2026/08/31 18:00',   /* これ以降＝バナー・タブ・カードごと消える */
      limitedUnit: 'セット',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Nikunohi Set',
      limitedTag: 'nikunohi', listPrice: 6200,
      description: '赤身焼肉200g×1とバラ焼肉200g×2の3袋セット（合計600g）。8月29日の焼肉の日にあわせた特別価格。',
      images: ['public/images/products/drive/yakiniku-set-2.jpg']
    },

    /* ===== イチボステーキ 3日間 数量限定 (2026-08-03〜08-05) ===== */
    {
      productId: 'P028', variantId: 'ICHIBO-STEAK', sku: 'EDA-ICHIBO-200',
      stripePriceId: '',
      name: 'イチボステーキ', variant: '1枚 200g',
      /* price / stock は GAS(products シート)のライブ値で上書きされる。ここは取得失敗時のフォールバック */
      price: 3800, weight: 200, stock: 9, temp: '冷凍',
      /* 限定品カウント (public/js/limited-stock.js)。
         limitedStartAt を過ぎるまでは表示も購入もされない＝「3日から販売開始」を自動化。
         普段は企業向け(B2B)の希少部位。今回だけ在庫が回った単発の数量限定。 */
      limitedTotal: 20,
      limitedStartAt:   '2026/08/03 17:30',   /* 17:30に自動で購入可＆「残り◯」表示へ。それまでは「発売予定」 */
      limitedSoldOutAt: '2026/08/04 23:59',   /* 2026-08-05 たろ指示で即非表示（過去日にして掲示を消す） */
      limitedUntil:     '2026/08/04 23:59',   /* これ以降＝バナー・タブ・カードごと消える（前倒し終了） */
      limitedUnit: '枚',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Ichibo Steak',
      description: 'サーロインに続く、尻の一枚。赤身のうまみに、ほどよい霜降り。塩で、ステーキに。',
      images: ['public/images/products/drive/ichibo-steak.jpg']
    },

    /* ===== 訳あり 焼肉2種セット (〜2026-08-07 23:59 数量限定) ===== */
    {
      productId: 'P030', variantId: 'WAKEARI-YAKINIKU-2', sku: 'EDA-WAKEARI-YAKINIKU',
      stripePriceId: '',
      name: '訳あり 焼肉2種セット', variant: '赤身焼肉200g + バラ焼肉200g',
      price: 3870, weight: 400, stock: 20, temp: '冷凍',
      published: false,
      /* 🧩 中身(BOM)。本番DBの components 列が正で、ここは取得失敗時のフォールバック。
         これが無いとセットが売れても赤身焼肉・バラ焼肉の在庫が減らず、
         売り切れていても注文が通る(2026-08-31 登録)。 */
      components: [
        { name: '赤身焼肉', qty: 1 },
        { name: 'バラ焼肉', qty: 1 }
      ],   /* 公開はスタッフが products シートの published=TRUE で。まだ非公開 */
      /* 限定品カウント (public/js/limited-stock.js)。残数=在庫−カート確保で自動。 */
      limitedTotal: 20,
      limitedSoldOutAt: '2026/08/07 23:59',   /* これ以降＝販売停止＋「完売しました」 */
      limitedUntil:     '2026/08/07 23:59',   /* これ以降＝バナー・タブ・カードごと消える */
      limitedUnit: 'セット',
      listPrice: 4300,                         /* 定価（単品合計）。限定価格 3,870 との対比表示用 */
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wakeari Yakiniku Set',
      description: '冷凍焼けにより表面が黒っぽく変色しています。見た目のぶんだけお得にしました。赤身焼肉200g＋バラ焼肉200gの計400g。ご家庭の焼肉・BBQに。牛脂つき。※画像はイメージです。',
      images: ['public/images/products/drive/wakeari-yakiniku-set.jpg']
    },

    /* ===== 訳あり スライス2種セット (〜2026-08-07 23:59 数量限定) ===== */
    {
      productId: 'P031', variantId: 'WAKEARI-SLICE-2', sku: 'EDA-WAKEARI-SLICE',
      stripePriceId: '',
      name: '訳あり スライス2種セット', variant: '霜降スライス200g + 切り落とし200g',
      price: 4770, weight: 400, stock: 20, temp: '冷凍',
      published: false,
      /* 🧩 中身(BOM)。本番DBの components 列が正で、ここは取得失敗時のフォールバック。
         これが無いとセットが売れても霜降スライス・切り落としの在庫が減らず、
         売り切れていても注文が通る(2026-08-31 登録)。 */
      components: [
        { name: '霜降スライス', qty: 1 },
        { name: '切り落とし', qty: 1 }
      ],
      limitedTotal: 20,
      limitedSoldOutAt: '2026/08/07 23:59',
      limitedUntil:     '2026/08/07 23:59',
      limitedUnit: 'セット',
      listPrice: 5300,
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Wakeari Slice Set',
      description: '冷凍焼けにより表面が黒っぽく変色しています。見た目のぶんだけお得にしました。霜降スライス200g＋切り落とし200gの計400g。すき焼き・しゃぶしゃぶ・普段の炒め物に。牛脂つき。※画像はイメージです。',
      images: ['public/images/products/drive/wakeari-slice-set.jpg']
    },

    /* ===== カメノコ焼肉 / シンシン焼肉 (2026-08-30 18:30 販売開始・数量限定) =====
       シンタマ(マル)を4分割した希少部位。公式LINEの配信に合わせて 9/3(木) 18:30 に自動解禁。
       limitedStartAt を過ぎるまでカード・PDPともに「発売予定」で購入不可。
       限定期限は設けず、在庫が尽きたら通常どおり売り切れ表示になる。
       🔴 同じ肉で 2種セット(P037) も売る。セットは products シートの components
          (BOM) で カメノコ1 + シンシン1 に展開されるため、セットが売れると
          この単品の在庫が自動で減る＝二重販売しない。だから在庫は取り分けず、
          カメノコ8袋 / シンシン6袋 を単品とセットで共有する
          (2026-08-30 ryotaro判断・案2)。
       🔴 components を消すとセットが単品在庫を引かなくなり、売り越す。 */
    {
      productId: 'P035', variantId: 'KAMENOKO-YAKINIKU', sku: 'EDA-KAMENOKO-200',
      stripePriceId: '',
      name: 'カメノコ焼肉', variant: '1袋 200g',
      /* price / stock は GAS(products シート)のライブ値で上書きされる。ここはフォールバック */
      price: 2700, weight: 200, stock: 8, temp: '冷凍',
      limitedTotal: 8,
      limitedStartAt: '2026/09/03 18:30',
      limitedUnit: '袋',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Kamenoko Yakiniku',
      description: 'モモの中のシンタマを4つに分けたうちの一つ。きめが細かく脂は控えめ。焼肉用にカットしました。',
      images: ['public/images/products/drive/kamenoko-yakiniku.jpg']
    },
    {
      productId: 'P036', variantId: 'SHINSHIN-YAKINIKU', sku: 'EDA-SHINSHIN-200',
      stripePriceId: '',
      name: 'シンシン焼肉', variant: '1袋 200g',
      price: 2700, weight: 200, stock: 6, temp: '冷凍',
      limitedTotal: 6,
      limitedStartAt: '2026/09/03 18:30',
      limitedUnit: '袋',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Shinshin Yakiniku',
      description: 'シンタマの芯にあたる部位。1頭からわずかしか取れず、赤身のきめが細かくやわらかい。焼肉用にカットしました。',
      images: ['public/images/products/drive/shinshin-yakiniku.jpg']
    },

    /* ===== カメノコ・シンシン焼肉セット (2026-09-03 18:30 販売開始・数量限定) =====
       カメノコ200g + シンシン200g の2種セット。定価¥5,400 → ¥4,860 (10%オフ)。
       🔴 在庫は本番DBの components (BOM) で カメノコ1 + シンシン1 に展開される。
          セット行そのものの stock は GAS 側で減らないので、フロントは
          products-loader.js の applyBomStock が構成品から
            min(カメノコ, シンシン) ＝ あと何セット作れるか
          を計算して stock を置き換える。これで「残り◯セット」も「在庫切れ」も
          カートボタンの停止も、構成品の実在庫に追従する。
          → 下の components を消すと計算できなくなり、また止まった数字に戻る。
       🔴 「◯セット限定」の総数は出さない。出すのは「残り◯セット」だけ
          (2026-08-31 たろ指示)。単品と在庫を共有しているので「全部で◯セット」
          という決まった数が存在せず、総数を書くと在庫と食い違うため。
          下の limitedTotal は表示には使われない。限定品の仕組み(発売前の予告・
          締切・残数表示)を有効にするスイッチとして 0 より大きい値が要るだけ。
          総数バッジの抑止は limited-stock.js が components の有無で自動判定する。
       会員限定ページ(line-members.html)にも同じ商品を載せている。name は在庫減算と
       決済の突合キーなので、両方で完全一致させること。 */
    {
      productId: 'P037', variantId: 'KAMENOKO-SHINSHIN-SET', sku: 'EDA-KAMESHIN-SET',
      stripePriceId: '',
      name: 'カメノコ・シンシン焼肉セット', variant: 'カメノコ200g ＋ シンシン200g',
      /* stock は applyBomStock が構成品から作り直すので、ここは取得失敗時の目安 */
      price: 4860, listPrice: 5400, weight: 400, stock: 6, temp: '冷凍',
      components: [
        { name: 'カメノコ焼肉', qty: 1 },
        { name: 'シンシン焼肉', qty: 1 }
      ],
      limitedTotal: 6,          /* 表示には出ない。限定品の仕組みを有効にするだけ */
      limitedStartAt: '2026/09/03 18:30',
      limitedUnit: 'セット',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Kamenoko Shinshin Set',
      description: 'モモの中の「シンタマ」から取れる希少部位を2種類。きめが細かく脂は控えめなカメノコと、シンタマの芯にあたるやわらかいシンシン。1袋ずつ買うより540円お得です。',
      images: ['public/images/products/drive/kamenoko-shinshin-set.jpg']
    },

    /* ===== 本日限定 食べ比べ2種 (2026-08-31 23:59 締切) =====
       公式LINE会員限定ページ(line-members.html)だけで売る。
       shop.html / products.html にはカードを足していない＝店頭には出ない。
       前身の P038(赤身ステーキ×ミスジ 食べ比べセット ¥6,900・2パック)は
       2026-08-31 に取り下げた。実注文38件の82%が¥11,000以上で、単価の低いセットを
       主役にすると注文単価が¥6,000台に落ちるため(8/28・8/30の実例)。
       🔴 在庫は本番DBの components(BOM) で単品に展開される。
          P039 = 赤身ステーキ×2 ＋ ミスジステーキ×1
          P040 = ミスジステーキ×2 ＋ 赤身ステーキ×1
          セット行の stock は売れても動かないので、残数は構成品から
          min(在庫 ÷ 必要数) で出す(products-loader.js / line-members.html。PR#183)。
          → A・B・ミスジ単品が同じミスジ在庫を共有し、残数が自動で連動する。
          数量を変えるときは products の「ミスジステーキ」「赤身ステーキ」の stock を動かす。
       10%オフ。単品合計 ¥10,300 → ¥9,270 ／ ¥10,400 → ¥9,360。 */
    {
      productId: 'P039', variantId: 'TABEKURABE-A', sku: 'EDA-TABEKURABE-A',
      stripePriceId: '',
      name: 'Aセット｜赤身ステーキ2枚＋ミスジ1枚', variant: '赤身ステーキ200g×2 ＋ ミスジステーキ150g×1',
      price: 9270, listPrice: 10300, weight: 550, stock: 7, temp: '冷凍',
      limitedTotal: 7,
      limitedSoldOutAt: '2026/08/31 23:59',
      limitedUntil:     '2026/09/01 12:00',
      limitedUnit: 'セット',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Tasting Set A',
      description: '同じ焼き方で、赤身とサシを食べ比べ。モモの中心から取った赤身ステーキを2枚に、一頭からわずかしか取れないミスジを1枚。赤身をしっかり食べたい方はこちら。',
      images: ['public/images/products/drive/tabekurabe-a.jpg']
    },
    {
      productId: 'P040', variantId: 'TABEKURABE-B', sku: 'EDA-TABEKURABE-B',
      stripePriceId: '',
      name: 'Bセット｜ミスジ2枚＋赤身ステーキ1枚', variant: 'ミスジステーキ150g×2 ＋ 赤身ステーキ200g×1',
      price: 9360, listPrice: 10400, weight: 500, stock: 3, temp: '冷凍',
      limitedTotal: 3,
      limitedSoldOutAt: '2026/08/31 23:59',
      limitedUntil:     '2026/09/01 12:00',
      limitedUnit: 'セット',
      category: 'beef', categoryLabel: '牛肉', tagEn: 'Tasting Set B',
      description: '同じ焼き方で、赤身とサシを食べ比べ。一頭からわずかしか取れないミスジを2枚に、赤身ステーキを1枚。希少部位を主役にしたい方はこちら。',
      images: ['public/images/products/drive/tabekurabe-b.jpg']
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
