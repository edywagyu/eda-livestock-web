/* ============================================================
   人気順（売れてる順）ロジック — フロントのみ完結・決済コードに非依存
   データ元: public/data/popular.json（直近14日 購入×3+カート×2(+閲覧×1)で算出）
   役割:
     1. #popularBar があれば「今売れている人気商品」バナーを描画（shop.html）
     2. <body data-popular-sort="on"> のページで商品グリッドを人気順に並べ替え（products.html）
   失敗時（json取得不可）は何もしない＝既存のHTML順のまま（安全なフォールバック）。
   ============================================================ */
(function () {
  'use strict';

  function firstVariantId(card) {
    try {
      var v = JSON.parse(card.getAttribute('data-variants') || '[]');
      return (v[0] && v[0].id != null) ? String(v[0].id) : null;
    } catch (e) { return null; }
  }

  function yen(n) {
    try { return '¥' + Number(n).toLocaleString('ja-JP'); } catch (e) { return '¥' + n; }
  }

  function renderBanner(data) {
    var bar = document.getElementById('popularBar');
    if (!bar || !data.banner || !data.banner.length) return;
    var chips = data.banner.map(function (b) {
      return '<a class="pop-chip" href="product.html?id=' + encodeURIComponent(b.id) + '">'
           +   '<span class="pop-rank">' + b.rank + '</span>'
           +   '<span class="pop-name">' + b.name + '</span>'
           +   '<span class="pop-price">' + yen(b.price) + '</span>'
           + '</a>';
    }).join('');
    bar.innerHTML =
        '<div class="container">'
      +   '<div class="pop-bar-inner">'
      +     '<div class="pop-bar-head"><span class="pop-fire">🔥</span>'
      +       '<span class="pop-bar-title">今売れている人気商品</span>'
      +       '<span class="pop-bar-note">直近の売れ行きで自動更新</span>'
      +     '</div>'
      +     '<div class="pop-bar-list">' + chips + '</div>'
      +   '</div>'
      + '</div>';
    bar.hidden = false;
  }

  function sortGrids(rankById) {
    document.querySelectorAll('.product-grid[data-cat]').forEach(function (grid) {
      var cards = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
      cards.forEach(function (c, idx) {
        // COMING SOON（有機JAS等）は従来どおり末尾固定
        if (c.dataset.sortPrice) { c._popKey = 900000 + parseInt(c.dataset.sortPrice, 10); return; }
        var id = firstVariantId(c);
        var r = (id != null && rankById[id] != null) ? rankById[id] : null;
        // ランキングに載っていない商品はランク済みの後・COMING SOONの前へ（HTML順を保持）
        c._popKey = (r != null) ? r : (500000 + idx);
      });
      cards.sort(function (a, b) { return a._popKey - b._popKey; });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
  }

  function init() {
    fetch('public/data/popular.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        window.EDA_POPULAR = data;
        var rankById = {};
        (data.ranking || []).forEach(function (it) { rankById[String(it.id)] = it.rank; });
        window.EDA_POPULAR_RANK = rankById;
        renderBanner(data);
        if (document.body && document.body.getAttribute('data-popular-sort') === 'on') {
          sortGrids(rankById);
        }
      })
      .catch(function () { /* 取得失敗時は既存の並びのまま */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
