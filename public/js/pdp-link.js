/* ============================================================
   Shop の商品カードを PDP (product.html?id=XXX) にリンク
   - 商品名で products-master.js と照合 → productId を取得
   - .product-name をクリック → product.html?id={productId}
   - data-pdp-href 属性で各カードに URL を付与
   ============================================================ */
(function () {
  'use strict';

  /* 名前を正規化（空白・括弧内・全半角の差を吸収） */
  function norm(s) {
    return (s || '')
      .replace(/\s+/g, '')
      .replace(/[()（）]/g, '')
      .replace(/\d+g/gi, '')
      .toLowerCase()
      .trim();
  }

  function init() {
    if (!window.EDA_PRODUCTS_MASTER) {
      setTimeout(init, 200);
      return;
    }
    const products = window.EDA_PRODUCTS_MASTER.products || [];

    document.querySelectorAll('.product-card').forEach(card => {
      const nameEl = card.querySelector('.product-name');
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      const nNorm = norm(name);

      let match = products.find(p => p.name === name);
      if (!match) {
        match = products.find(p => norm(p.name) === nNorm);
      }
      if (!match) {
        match = products.find(p => norm(p.name).startsWith(nNorm) || nNorm.startsWith(norm(p.name)));
      }
      if (!match) return;

      const href = 'product.html?id=' + encodeURIComponent(match.productId);
      card.setAttribute('data-pdp-href', href);
      card.style.cursor = 'pointer';

      /* タイトル + 画像エリアをクリック → PDP 遷移 */
      /* ボタン・select はそのまま動作 */
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, select, input, a, .btn-add-cart, .variant-select')) return;
        location.href = href;
      });

      nameEl.style.cursor = 'pointer';
      nameEl.style.textDecoration = 'underline';
      nameEl.style.textDecorationThickness = '1px';
      nameEl.style.textUnderlineOffset = '4px';
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        location.href = href;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
