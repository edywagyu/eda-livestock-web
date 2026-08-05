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

  /* カード → 人気ランク（0が最上位）。並べ替え本体（各ページの sortProductCards）から使う。
     ここで並べ替えまでやると「売り切れを末尾へ」の処理と二重に DOM を触って
     打ち消し合うため、このファイルはランクを配るだけに徹する。 */
  window.EDA_POPULAR_RANK_OF = function (card) {
    var rank = window.EDA_POPULAR_RANK;
    if (!rank) return null;
    var id = firstVariantId(card);
    return (id != null && rank[id] != null) ? rank[id] : null;
  };

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
        /* 並べ替えは各ページの sortProductCards に一本化（在庫0を末尾へ、の判定と同居させるため）。
           ランクが届いたこのタイミングで並べ直す。 */
        if (document.body && document.body.getAttribute('data-popular-sort') === 'on'
            && typeof window.refreshProductOrder === 'function') {
          window.refreshProductOrder();
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
