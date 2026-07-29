/* ============================================================
   江田畜産 商品マスター動的ローダー
   ------------------------------------------------------------
   GAS Web App から products シート を取得し、
   window.EDA_PRODUCTS_MASTER を上書きする。

   バックエンドスプシ: 1kMLksRzJRFMKXotwF8IILZJlgUcjpxI84lRZoEBaOMo
   (江田畜産_EC_オペレーション_2026-05-17・GAS「江田畜産_EC_API」連携)
   ↓ products タブ
   https://docs.google.com/spreadsheets/d/1kMLksRzJRFMKXotwF8IILZJlgUcjpxI84lRZoEBaOMo/edit

   フロー:
   1. products-master.js が defer で読み込まれる (フォールバック)
   2. このスクリプトが GAS から最新を fetch
   3. 成功したら window.EDA_PRODUCTS_MASTER を上書き → stock badge 等が再描画
   4. 失敗したら products-master.js のデータをそのまま使う

   STAFF 編集:
   - スプシを直接編集 → 5 分以内に shop.html に反映 (sessionStorage キャッシュ)
   - 在庫だけは STAFF.html からも変更可能 (GAS staff_update_stock)
   ============================================================ */

(function() {
  'use strict';

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';

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

    /* 限定品カウント(limited-stock.js)の3列は products シートに未追加でも動くようにする。
       GAS が値を返さない場合は products-master.js のフォールバックを引き継ぐ。
       ＝ シートに列を足せばシートが正、足すまでは同梱マスターが正。 */
    var prev = {};
    ((window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || []).forEach(function (p) {
      if (p.productId) prev[p.productId] = p;
    });
    function keep(p, key) {
      var v = p[key];
      if (v !== undefined && v !== null && String(v) !== '') return v;
      var old = prev[p.productId];
      return old ? old[key] : undefined;
    }

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
      published:     p.published !== false && p.published !== 'FALSE' && p.published !== 'false',
      /* 限定品カウント (public/js/limited-stock.js) */
      limitedTotal:  keep(p, 'limitedTotal'),
      limitedUntil:  keep(p, 'limitedUntil'),
      limitedUnit:   keep(p, 'limitedUnit') || ''
    }));

    /* window.EDA_PRODUCTS_MASTER を更新 (products-master.js の構造に合わせる) */
    window.EDA_PRODUCTS_MASTER = window.EDA_PRODUCTS_MASTER || {};
    window.EDA_PRODUCTS_MASTER.products = normalized;
    window.EDA_PRODUCTS_MASTER.version  = 'gas-' + Date.now();

    /* 在庫バッジ等を再描画 (shop.html 内の関数) */
    if (typeof window.refreshStockBadges === 'function') {
      window.refreshStockBadges();
    }
    /* 価格・公開ステータス更新 + 新商品レンダリング */
    if (typeof window.refreshProductCards === 'function') {
      window.refreshProductCards();
    }

  }

  /* ギフト・定期便プランの適用 */
  function applyGifts(gifts) {
    if (typeof window.__renderGifts === 'function') {
      try { window.__renderGifts(gifts || []); } catch(e) {}
    }
  }
  function applyPlans(plans) {
    if (typeof window.__renderPlans === 'function') {
      try { window.__renderPlans(plans || []); } catch(e) {}
    }
  }

  /* メイン処理 */
  function load() {
    /* キャッシュヒット → 即適用 */
    const cached = getCached();
    if (cached) {
      applyProducts(cached.products || cached);
      if (cached.gifts) applyGifts(cached.gifts);
      if (cached.plans) applyPlans(cached.plans);
      return;
    }

    /* GAS から fetch (public_catalog で全部一括取得) */
    fetch(GAS_URL + '?action=public_catalog', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data && data.ok) {
          const products = data.products || [];
          const gifts = data.gifts || [];
          const plans = data.plans || [];
          setCached({ products, gifts, plans });
          if (products.length > 0) applyProducts(products);
          applyGifts(gifts);
          applyPlans(plans);
        } else {
        }
      })
      .catch(e => {
      });
  }

  /* DOMContentLoaded 後に実行 (products-master.js が先に読み込まれる) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
