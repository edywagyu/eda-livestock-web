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

  /* { stock: 実在庫, available: 実在庫 − 他のお客様の確保中 } を返す */
  function liveStock() {
    var master = (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
    for (var i = 0; i < master.length; i++) {
      var p = master[i];
      if (p.productId === PRODUCT_ID || p.name === PRODUCT_NAME) {
        var s = Number(p.stock);
        if (!isFinite(s)) return null;
        /* 他のお客様がカート確保中の分を引く（cart-holds.js）。
           確保中の分は決済側でも押さえているので、これが本当の「買える数」。 */
        var avail = s;
        if (typeof window.edaAvailable === 'function') {
          var a = window.edaAvailable(PRODUCT_NAME, s);
          if (a !== null) avail = a;
        }
        return { stock: s, available: avail };
      }
    }
    return null;
  }

  function apply() {
    var els = document.querySelectorAll('[data-nikunohi-left]');
    if (!els.length) return false;
    var live = liveStock();
    if (!live) return false;
    var n = live.available;

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (n <= 0) {
        /* 完売（在庫ゼロ）と、他のお客様が確保中で一時的に買えない状態は区別する。
           後者は 30 分で解放されるので「完売しました」と書くと嘘になる。 */
        el.textContent = live.stock > 0 ? 'ただいま他のお客様が確保中' : '完売しました';
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
