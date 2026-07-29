/* ============================================================
   肉の日限定セット — 残数カウンタ
   ------------------------------------------------------------
   products-master.js（フォールバック）/ products-loader.js（GASライブ在庫）の
   stock を読んで、[data-nikunohi-left] の中の [data-nikunohi-n] を実在庫に書き換える。

   ・残数はHTMLにベタ書きしない = 売れるたびに表示が減る（嘘の残数を出さない）
   ・stock <= 0 → 「完売しました」に差し替え
   ・stock <= LOW_AT → .is-low を付与（各ページのCSSで強調・パルス）

   🔴 肉の日フェア終了後は、このファイルと各ページの <script> 参照ごと削除する。
   ============================================================ */
(function () {
  'use strict';

  var PRODUCT_ID   = 'P027';
  var PRODUCT_NAME = '肉の日限定セット';
  var LOW_AT       = 10;   /* これ以下で強調表示 */
  var UNIT         = 'セット';

  function liveStock() {
    var master = (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
    for (var i = 0; i < master.length; i++) {
      var p = master[i];
      if (p.productId === PRODUCT_ID || p.name === PRODUCT_NAME) {
        var s = Number(p.stock);
        return isFinite(s) ? s : null;
      }
    }
    return null;
  }

  function apply() {
    var els = document.querySelectorAll('[data-nikunohi-left]');
    if (!els.length) return false;
    var n = liveStock();
    if (n === null) return false;

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (n <= 0) {
        el.textContent = '完売しました';
        el.classList.add('is-soldout');
        el.classList.remove('is-low');
      } else {
        var num = el.querySelector('[data-nikunohi-n]');
        if (num) num.textContent = n;
        else el.textContent = '残り' + n + UNIT;
        el.classList.remove('is-soldout');
        if (n <= LOW_AT) el.classList.add('is-low');
        else el.classList.remove('is-low');
      }
    }
    return true;
  }

  /* マスター読み込み前に走ることがあるので、取れるまで少しリトライ */
  function boot(tries) {
    if (apply()) return;
    if (tries > 0) setTimeout(function () { boot(tries - 1); }, 200);
  }

  /* products-loader.js が GAS ライブ在庫の取得後に呼ぶフックへ相乗り */
  var prevRefresh = window.refreshStockBadges;
  window.refreshStockBadges = function () {
    if (typeof prevRefresh === 'function') {
      try { prevRefresh.apply(this, arguments); } catch (e) {}
    }
    apply();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(15); });
  } else {
    boot(15);
  }

  window.refreshNikunohiLeft = apply;
})();
