/* ============================================================
   人気順（売れてる順）ロジック — フロントのみ完結・決済コードに非依存

   データ元（この順に試す）:
     1. GAS ?action=public_popular … orders と events から毎回集計した最新（GAS側で1時間キャッシュ）
     2. public/data/popular.json   … 1が落ちたときの保険。2026-08-02 の手動データで止まっている

   役割:
     1. #popularBar があれば「今売れている人気商品」バナーを描画（shop.html）
     2. <body data-popular-sort="on"> のページに向けてランクを配る（products.html）
   並べ替えそのものは各ページの sortProductCards が行う。ここで DOM を触ると
   「売り切れを末尾へ」の処理と二重になって打ち消し合うため、ランクを配る役に徹する。

   両方落ちたときは何もしない＝既存のHTML順のまま（安全なフォールバック）。
   ============================================================ */
(function () {
  'use strict';

  /* GAS Web App。eda-config.js を読むページではそれを優先し、
     読まないページ(products.html 等)では products-loader.js と同じ URL を使う。 */
  var GAS_URL = (window.EDA_CONFIG && window.EDA_CONFIG.GAS_URL)
    || 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';

  function firstVariantId(card) {
    try {
      var v = JSON.parse(card.getAttribute('data-variants') || '[]');
      return (v[0] && v[0].id != null) ? String(v[0].id) : null;
    } catch (e) { return null; }
  }

  function productName(card) {
    var el = card.querySelector('.product-name');
    return el ? el.textContent.trim() : '';
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

  /* カード → 人気ランク（0が最上位）。並べ替え本体（各ページの sortProductCards）から使う。
     商品名で引き、駄目なら variantId で引く（GAS版は商品名キー、旧 popular.json は数値IDキー）。 */
  window.EDA_POPULAR_RANK_OF = function (card) {
    var rank = window.EDA_POPULAR_RANK;
    if (!rank) return null;
    var name = productName(card);
    if (name && rank[name] != null) return rank[name];
    var id = firstVariantId(card);
    return (id != null && rank[id] != null) ? rank[id] : null;
  };

  function apply(data) {
    if (!data || !data.ranking || !data.ranking.length) return false;
    window.EDA_POPULAR = data;
    var rankBy = {};
    data.ranking.forEach(function (it) {
      if (it.name) rankBy[String(it.name).trim()] = it.rank;   /* GAS版＝商品名キー */
      if (it.id != null) rankBy[String(it.id)] = it.rank;      /* 旧 json＝数値IDキー（後方互換） */
    });
    window.EDA_POPULAR_RANK = rankBy;
    renderBanner(data);
    /* 並べ替えは各ページの sortProductCards に一本化（在庫0を末尾へ、の判定と同居させるため）。
       ランクが届いたこのタイミングで並べ直す。 */
    if (document.body && document.body.getAttribute('data-popular-sort') === 'on'
        && typeof window.refreshProductOrder === 'function') {
      window.refreshProductOrder();
    }
    return true;
  }

  function init() {
    /* 1st: GAS から最新（orders/events を集計した結果。GAS側で1時間キャッシュ） */
    fetch(GAS_URL + '?action=public_popular', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.ok && apply(data)) return;
        throw new Error('gas empty');
      })
      .catch(function () {
        /* 2nd: 同梱 json（手動データ）。GAS が落ちても並びが壊れないための保険 */
        return fetch('public/data/popular.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) { apply(data); })
          .catch(function () { /* 両方だめなら既存の並びのまま */ });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
