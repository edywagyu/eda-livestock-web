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

  /* GAS Web App。⚠️ 同じ GAS プロジェクトに **デプロイが複数** 存在し、
     それぞれ別のコードバージョンで固定されている。
       ・このURL(AKfycbx7…)  … products-loader.js が商品/在庫に使っている方。public_popular はここに入っている
       ・EDA_CONFIG.GAS_URL(AKfycbxFfdz…) … 別デプロイ。更新されておらず public_popular を知らない
     そのため window.EDA_CONFIG.GAS_URL を優先してはいけない（2026-08-06、
     優先した結果 products.html で毎回 GAS が空振りし、古い popular.json に落ちていた）。
     商品と在庫を取っているのと同じデプロイを見る、で固定する。 */
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';

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

  /* ---- バナー（shop.html の #popularBar） ----------------------------------
     バナーに出す品の作り方。ranking（商品名＋ランクだけ）から毎回組み立てる。

     なぜ data.banner をそのまま使わないか（2026-08-21）:
       ・GAS の public_popular は ranking しか返さない＝banner が無い。
       ・同梱 popular.json の banner は id が数値バリアントID（50831002400101）で、
         PDP は product.html?id=P034 の productId しか解さない＝リンクが必ず外れる。
     どちらの経路でも商品名からマスターを引き直し、productId・価格・在庫を取り直す。

     出さない品: 除外指定（肉の日限定セット等）／マスターに無い／非公開・COMING SOON／
     在庫0／販売期間切れ／shop.html にカードが無い（＝そのページで買えない）。
     売り切れを一等地に出さないのは #85（売り切れは末尾）と同じ理由。 */
  var BANNER_MAX = 5;

  function shopCardNames() {
    var names = {};
    document.querySelectorAll('.product-card .product-name').forEach(function (el) {
      var n = el.textContent.trim();
      if (n) names[n] = true;
    });
    return names;
  }

  function sellableByName() {
    var master = (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
    var now = Date.now();
    var byName = {};
    master.forEach(function (p) {
      if (!p.name) return;
      if (p.published === false) return;
      if (p.comingSoon) return;
      if (Number(p.stock) <= 0) return;
      if (p.limitedUntil) {
        var until = new Date(String(p.limitedUntil).replace(/-/g, '/')).getTime();
        if (until && until < now) return;         /* 販売期間が終わっている限定品 */
      }
      if (!byName[p.name]) byName[p.name] = p;
    });
    return byName;
  }

  function buildBanner(data) {
    var excluded = {};
    (data.excluded || ['肉の日限定セット']).forEach(function (n) { excluded[String(n).trim()] = true; });
    var sellable = sellableByName();
    var onPage = shopCardNames();
    var out = [];
    (data.ranking || []).forEach(function (it) {
      if (out.length >= BANNER_MAX) return;
      var name = String(it.name == null ? '' : it.name).trim();
      if (!name || excluded[name] || !onPage[name]) return;
      var p = sellable[name];
      if (!p) return;
      out.push({ rank: out.length + 1, name: p.name, price: p.price, id: p.productId });
    });
    return out;
  }

  function renderBanner(data) {
    var bar = document.getElementById('popularBar');
    if (!bar) return;
    /* マスターは products-loader.js が非同期で入れる。届く前は組み立てられないので待つ
       （最大 約3秒。それでも来なければバナーは出さない＝画面は元のまま） */
    if (!(window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products)) {
      if ((renderBanner.tries = (renderBanner.tries || 0) + 1) <= 15) {
        setTimeout(function () { renderBanner(data); }, 200);
      }
      return;
    }
    var items = buildBanner(data);
    if (!items.length) return;
    var chips = items.map(function (b) {
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
