/* ============================================================
   限定品カウント（汎用）
   ------------------------------------------------------------
   products シートの3列だけで、どの商品でも「残り◯」を出せるようにする。
   campaign ごとのコード修正・HTML追加・終了後の削除を不要にするのが目的。

     limitedTotal … 限定総数（例 12）。これが入っている商品だけ対象。表示専用の分母。
     limitedUntil … 締切日時（例 2026/08/29 23:59）。過ぎたら表示が全部自動で消える。
     limitedUnit  … 単位（省略可。空なら「セット」か「点」を名前から自動判定）

   残数 = stock − 他のお客様のカート確保（public/js/cart-holds.js）。
   ＝ 実在庫と、本当に押さえている分だけで作った数字。嘘の残数は出さない。

   HTML側のフック（どれも任意。付けなくてもカードとPDPには自動で出る）:
     [data-limited-scope="商品名"] … 期間外になったら要素ごと非表示。
                                     販促バナーを丸ごと囲えば終了後に自動で消える。
     [data-limited-left="商品名"]  … 中身を「残り◯セット」に置き換える。
                                     手書きのコピーの中に残数を埋め込みたいときに使う。

   関連: public/js/cart-holds.js（確保数）/ gas/cart_holds.gs
   ============================================================ */
(function () {
  'use strict';

  var LOW_AT = 10;   /* これ以下で強調（.is-low） */

  function products() {
    return (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
  }

  function parseUntil(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    /* シートは "2026/08/29 23:59" や ISO で返ってくる。Safari は "/" 区切りを解釈できないことがある */
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59), 59);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function unitOf(p) {
    if (p.limitedUnit) return String(p.limitedUnit);
    var s = (p.name || '') + ' ' + (p.variant || '');
    return s.indexOf('セット') >= 0 ? 'セット' : '点';
  }

  /* 限定キャンペーンが有効な商品を { 商品名: {...} } で返す */
  function activeLimited() {
    var out = {};
    var now = new Date();
    products().forEach(function (p) {
      var total = Number(p.limitedTotal);
      if (!isFinite(total) || total <= 0) return;
      var until = parseUntil(p.limitedUntil);
      if (until && now > until) return;          /* 締切を過ぎた＝もう出さない */
      if (!p.name) return;

      var stock = Number(p.stock);
      if (!isFinite(stock)) stock = 0;
      var avail = stock;
      if (typeof window.edaAvailable === 'function') {
        var a = window.edaAvailable(p.name, stock);
        if (a !== null) avail = a;
      }
      out[p.name] = {
        product: p, total: total, until: until, unit: unitOf(p),
        stock: stock, available: avail
      };
    });
    return out;
  }

  /* 「残り◯セット」/「完売しました」/「ただいま他のお客様が確保中」 */
  function labelFor(info) {
    if (info.available > 0) return '残り' + info.available + info.unit;
    /* 在庫はあるが全部が確保中 → 30分で解放されるので「完売」とは書かない */
    return info.stock > 0 ? 'ただいま他のお客様が確保中' : '完売しました';
  }

  function applyState(el, info) {
    el.textContent = labelFor(info);
    el.classList.toggle('is-soldout', info.available <= 0);
    el.classList.toggle('is-low', info.available > 0 && info.available <= LOW_AT);
  }

  /* ① 期間外のブロックを丸ごと隠す（販促バナーを囲っておけば終了後に自動で消える） */
  function applyScopes(active) {
    document.querySelectorAll('[data-limited-scope]').forEach(function (el) {
      var name = el.getAttribute('data-limited-scope');
      el.style.display = active[name] ? '' : 'none';
    });
  }

  /* ② 手書きコピーの中の残数プレースホルダ */
  function applyInline(active) {
    document.querySelectorAll('[data-limited-left]').forEach(function (el) {
      var info = active[el.getAttribute('data-limited-left')];
      if (info) applyState(el, info);
    });
  }

  /* ③ 商品カードにリボンを自動で挿す（キャンペーンごとのHTML追加を不要にする） */
  function applyCards(active) {
    document.querySelectorAll('.product-card').forEach(function (card) {
      var nameEl = card.querySelector('.product-name');
      if (!nameEl) return;
      var info = active[nameEl.textContent.trim()];
      var ribbon = card.querySelector('.limited-left-ribbon');

      if (!info) { if (ribbon) ribbon.remove(); return; }

      if (!ribbon) {
        var host = card.querySelector('.product-card-img') || card;
        host.style.position = host.style.position || 'relative';
        ribbon = document.createElement('span');
        ribbon.className = 'limited-left-ribbon';
        host.appendChild(ribbon);
      }
      applyState(ribbon, info);
    });
  }

  /* ④ 商品詳細ページの帯（P027 のようなベタ書きを不要にする） */
  function applyPdp(active) {
    var host = document.getElementById('limitedBanner');
    if (!host) return;
    var cur = window.__pdpProduct;
    var info = cur && cur.name ? active[cur.name] : null;
    if (!info) { host.style.display = 'none'; return; }

    var until = info.until;
    var deadline = until
      ? (until.getMonth() + 1) + '/' + until.getDate() + '（' + '日月火水木金土'.charAt(until.getDay()) + '）'
        + until.getHours() + ':' + ('0' + until.getMinutes()).slice(-2)
        + 'まで ／ '
      : '';
    host.style.display = 'flex';
    host.innerHTML = '<span class="limited-banner-badge">' + info.total + info.unit + '限定</span>'
      + '<span class="limited-banner-text">' + deadline
      + '<b class="limited-left" data-limited-left="' + info.product.name.replace(/"/g, '&quot;') + '"></b>'
      + ' なくなり次第終了</span>';
    applyState(host.querySelector('.limited-left'), info);
  }

  function apply() {
    if (!products().length) return false;
    var active = activeLimited();
    applyScopes(active);
    applyInline(active);
    applyCards(active);
    applyPdp(active);
    return true;
  }

  /* マスター読み込み前に走ることがあるので、取れるまで少しリトライ */
  function boot(tries) {
    if (apply()) return;
    if (tries > 0) setTimeout(function () { boot(tries - 1); }, 200);
  }

  /* products-loader.js（GASライブ在庫）と cart-holds.js（確保数）の更新に相乗り */
  var prevRefresh = window.refreshStockBadges;
  window.refreshStockBadges = function () {
    if (typeof prevRefresh === 'function') { try { prevRefresh.apply(this, arguments); } catch (e) {} }
    apply();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(15); });
  } else {
    boot(15);
  }

  window.refreshLimitedStock = apply;
  /* 締切をまたいでもタブを開きっぱなしなら消えるように、1分ごとに見直す */
  setInterval(apply, 60 * 1000);
})();
