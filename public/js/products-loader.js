/* ============================================================
   江田畜産 商品マスター動的ローダー
   ------------------------------------------------------------
   GAS Web App から products シート を取得し、
   window.EDA_PRODUCTS_MASTER を上書きする。

   フロー:
   1. products-master.js が defer で読み込まれる (フォールバック)
   2. このスクリプトが GAS から最新を fetch
   3. 成功したら window.EDA_PRODUCTS_MASTER を上書き → stock badge 等が再描画
   4. 失敗したら products-master.js のデータをそのまま使う

   GAS URL は eda-bundle.js の getGasUrl() と同じものを使用。
   ============================================================ */

(function() {
  'use strict';

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ/exec';

  /* 5分キャッシュ (sessionStorage) — 同じ訪問内で何度も叩かない */
  const CACHE_KEY = 'eda-products-cache';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function getCached() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      return data;
    } catch (e) { return null; }
  }

  function setCached(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {}
  }

  function applyProducts(products) {
    if (!Array.isArray(products) || products.length === 0) return;

    /* 型整形: スプシは文字列で返るので数値カラムを変換 */
    const normalized = products.map(p => ({
      productId:     p.productId || '',
      variantId:     p.variantId || '',
      sku:           p.sku || '',
      stripePriceId: p.stripePriceId || '',
      name:          p.name || '',
      variant:       p.variant || '',
      price:         Number(p.price) || 0,
      weight:        Number(p.weight) || 0,
      stock:         Number(p.stock) || 0,
      temp:          p.temp || '冷凍',
      category:      p.category || '',
      categoryLabel: p.categoryLabel || '',
      tagEn:         p.tagEn || '',
      description:   p.description || '',
      images:        p.image ? [p.image] : [],
      isOrganic:     p.isOrganic === true || p.isOrganic === 'TRUE' || p.isOrganic === 'true',
      comingSoon:    p.comingSoon === true || p.comingSoon === 'TRUE' || p.comingSoon === 'true',
      published:     p.published !== false && p.published !== 'FALSE' && p.published !== 'false'
    }));

    /* window.EDA_PRODUCTS_MASTER を更新 (products-master.js の構造に合わせる) */
    window.EDA_PRODUCTS_MASTER = window.EDA_PRODUCTS_MASTER || {};
    window.EDA_PRODUCTS_MASTER.products = normalized;
    window.EDA_PRODUCTS_MASTER.version  = 'gas-' + Date.now();

    /* 在庫バッジ等を再描画 (shop.html 内の関数) */
    if (typeof window.refreshStockBadges === 'function') {
      window.refreshStockBadges();
    }

    console.log('[products-loader] スプシから ' + normalized.length + ' 商品を取得 (GAS)');
  }

  /* メイン処理 */
  function load() {
    /* キャッシュヒット → 即適用 */
    const cached = getCached();
    if (cached) {
      applyProducts(cached);
      return;
    }

    /* GAS から fetch */
    fetch(GAS_URL + '?action=public_products', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data && data.ok && Array.isArray(data.products) && data.products.length > 0) {
          setCached(data.products);
          applyProducts(data.products);
        } else {
          console.warn('[products-loader] GAS が空配列を返した。products-master.js を使用。');
        }
      })
      .catch(e => {
        console.warn('[products-loader] GAS 取得失敗 (products-master.js を使用):', e.message);
      });
  }

  /* DOMContentLoaded 後に実行 (products-master.js が先に読み込まれる) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
