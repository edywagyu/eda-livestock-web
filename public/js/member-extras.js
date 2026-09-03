/* ============================================================
   公式LINE会員限定ページの追加表示（2026-09-03）
   ------------------------------------------------------------
   1) 各商品カードに「商品の詳細」（部位・仕様・解凍・焼き方）を折りたたみで出す
      → データは public/data/pdp-content.js（商品詳細ページと同じもの）
   2) ページ下部に「まとめてご注文で送料無料」のチェック式ボックスを出す
      → ¥11,000 以上で送料無料。そのページに並んでいる商品だけで組む
        （他ページの商品を混ぜるとカート投入に必要な variantId が取れないため）

   各ページ側で必要なもの:
     window.__LM = { ITEMS: ITEMS, add: doAddToCart, purchasable: fn };
     render() の最後で window.edaMemberExtras && window.edaMemberExtras.apply();
   ============================================================ */
(function () {
  'use strict';

  var FREE = 11000;
  var yen = function (n) { return '¥' + Number(n || 0).toLocaleString(); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  };

  function content(pid) {
    var C = window.EDA_PDP_CONTENT || {};
    return C[pid] || null;
  }

  /* ---------- 1) カードに商品の詳細を差し込む ---------- */
  function applyDetails() {
    var LM = window.__LM;
    if (!LM || !LM.ITEMS) return;
    document.querySelectorAll('.card').forEach(function (card) {
      if (card.querySelector('.lm-detail')) return;              /* 二重挿入を防ぐ */
      var it = LM.ITEMS[Number(card.getAttribute('data-i'))];
      if (!it) return;
      var C = content(it.productId);
      if (!C) return;
      var rows = [
        ['部位', C.cut],
        ['内容量', C.variant || it.variant || ''],
        ['お召し上がり人数', C.meals],
        ['包装', C.pack],
        ['保存', '冷凍（-18℃以下）／ 賞味期限 製造日より6ヶ月'],
        ['解凍', C.thaw]
      ].filter(function (r) { return r[1]; });
      var cook = (C.cook || []).map(function (s) {
        return '<li><b>' + esc(s.t) + '</b><span>' + esc(s.d) + '</span></li>';
      }).join('');
      var el = document.createElement('details');
      el.className = 'lm-detail';
      el.innerHTML =
        '<summary>商品の詳細を見る</summary>' +
        '<div class="lm-detail-body">' +
          '<p class="lm-cut">' + esc(C.cutCopy) + '</p>' +
          '<dl class="lm-spec">' + rows.map(function (r) {
            return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
          }).join('') + '</dl>' +
          (cook ? '<p class="lm-cook-t">' + esc(C.cookTitle || '焼き方') + '</p><ol class="lm-cook">' + cook + '</ol>' : '') +
        '</div>';
      var after = card.querySelector('.card-desc') || card.querySelector('.card-variant');
      if (after && after.parentNode) after.parentNode.insertBefore(el, after.nextSibling);
    });
    linkCards();
  }

  /* ---------- カードから商品詳細ページへ飛べるようにする ----------
     従来は detailId を書いた品だけリンクが出ていて、他はタップしても進めなかった。
     products-master.js に載っている品なら全部リンクする（載っていない品に飛ばすと
     サーロインに化けるので、そこだけは今までどおりリンクしない）。 */
  function inMaster(pid) {
    var all = (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
    for (var i = 0; i < all.length; i++) { if (all[i].productId === pid) return true; }
    return false;
  }
  function linkCards() {
    var LM = window.__LM;
    if (!LM || !LM.ITEMS) return;
    document.querySelectorAll('.card').forEach(function (card) {
      var it = LM.ITEMS[Number(card.getAttribute('data-i'))];
      if (!it || !it.productId) return;
      if (!inMaster(it.productId)) return;
      var href = 'product.html?id=' + it.productId;
      /* 既存のリンクが無ければ足す */
      if (!card.querySelector('.card-detail')) {
        var a = document.createElement('a');
        a.className = 'card-detail';
        a.href = href;
        a.textContent = '商品の詳細を見る →';
        var d = card.querySelector('.lm-detail') || card.querySelector('.card-desc');
        if (d && d.parentNode) d.parentNode.insertBefore(a, d.nextSibling);
      }
      /* 写真と商品名もタップで飛べるように */
      ['.card-img', 'h3'].forEach(function (sel) {
        var t = card.querySelector(sel);
        if (!t || t.__lmLinked) return;
        t.__lmLinked = true;
        t.style.cursor = 'pointer';
        t.addEventListener('click', function () { location.href = href; });
      });
    });
  }

  /* ---------- 2) 送料無料のまとめ買いボックス ---------- */
  function buildCombo(pool) {
    if (!pool.length) return [];
    /* 商品詳細ページと同じ組み合わせが使えるなら、それを優先（超おすすめの指定を含む） */
    var byId = {};
    pool.forEach(function (x) { byId[x.productId] = x; });
    var featured = pool.filter(function (x) {
      var C = content(x.productId);
      return C && C.featured && C.combo && C.combo.length;
    })[0];
    var base = featured || pool[0];
    var C = content(base.productId);
    if (C && C.combo && C.combo.length && C.combo.every(function (c) { return byId[c.id]; })) {
      return C.combo.map(function (c) {
        var it = byId[c.id], unit = c.price || it.price, vi = -1;
        if (c.variant && it.variants) {
          it.variants.forEach(function (v, i) { if (v.t === c.variant) { vi = i; unit = c.price || v.p; } });
        }
        return { it: it, q: c.q, unit: unit, vl: c.variant || '', vi: vi };
      });
    }
    /* 無ければ、そのページの商品で ¥11,000 をちょうど超えるまで足す */
    var picked = [{ it: base, q: 1, unit: base.price, vl: '', vi: -1 }];
    var used = {}; used[base.productId] = 1;
    var total = base.price;
    while (total < FREE && picked.length < 5) {
      var cand = pool.filter(function (x) { return !used[x.productId]; });
      if (!cand.length) break;
      var need = FREE - total;
      var cross = cand.filter(function (x) { return x.price >= need; });
      var pick = cross.length
        ? cross.reduce(function (a, b) { return a.price <= b.price ? a : b; })
        : cand.reduce(function (a, b) { return a.price >= b.price ? a : b; });
      picked.push({ it: pick, q: 1, unit: pick.price, vl: '', vi: -1 }); used[pick.productId] = 1; total += pick.price;
    }
    var guard = 0;
    while (total < FREE && guard++ < 40) {
      var need2 = FREE - total;
      var cr = picked.filter(function (p) { return p.unit >= need2; });
      var pk = cr.length
        ? cr.reduce(function (a, b) { return a.unit <= b.unit ? a : b; })
        : picked.reduce(function (a, b) { return a.unit >= b.unit ? a : b; });
      pk.q += 1; total += pk.unit;
    }
    return picked;
  }

  function applyBundle() {
    var LM = window.__LM;
    if (!LM || !LM.ITEMS) return;
    var host = document.getElementById('members');
    if (!host) return;
    var pool = LM.ITEMS.filter(function (it) {
      return LM.purchasable ? LM.purchasable(it) : (it.stock > 0);
    });
    var picked = buildCombo(pool);
    var old = document.getElementById('lmBundle');
    if (picked.length < 2) { if (old) old.remove(); return; }

    var sec = old || document.createElement('section');
    sec.id = 'lmBundle';
    sec.className = 'lm-bundle';
    var featured = picked.some(function (p) {
      var C = content(p.it.productId); return C && C.featured;
    });
    sec.innerHTML =
      '<p class="lm-bd-eyebrow">' + (featured ? '超おすすめ' : 'まとめてご注文') + '</p>' +
      '<h2 class="lm-bd-lead">この組み合わせなら、送料無料になります。</h2>' +
      '<div class="lm-bd-cards">' + picked.map(function (p, k) {
        return '<article class="lm-bd-card">' +
          '<label class="lm-bd-img" style="background-image:url(' + p.it.img + ')">' +
            '<input type="checkbox" class="lm-bd-cb" data-k="' + k + '" checked>' +
            '<span class="lm-bd-mark"></span></label>' +
          '<h3>' + esc(p.it.name) + (p.vl ? ' <span>' + esc(p.vl) + '</span>' : '') + (p.q > 1 ? ' <span>× ' + p.q + '</span>' : '') + '</h3>' +
          '<div class="lm-bd-price">' + yen(p.unit * p.q) + '</div>' +
        '</article>';
      }).join('') + '</div>' +
      '<div class="lm-bd-sum"><span class="lm-bd-total" id="lmBdTotal"></span>' +
      '<span id="lmBdFree"></span></div>' +
      '<button class="lm-bd-btn" id="lmBdBtn" type="button"></button>';
    if (!old) host.appendChild(sec);

    function sync() {
      var on = [].slice.call(sec.querySelectorAll('.lm-bd-cb'))
        .map(function (cb, i) { return cb.checked ? picked[i] : null; })
        .filter(Boolean);
      var total = on.reduce(function (s, p) { return s + p.unit * p.q; }, 0);
      sec.querySelector('#lmBdTotal').textContent = on.length ? '合計 ' + yen(total) : '';
      sec.querySelector('#lmBdFree').innerHTML = !on.length ? ''
        : total >= FREE ? '<span class="lm-bd-ok">送料無料（¥11,000以上）</span>'
        : '<span class="lm-bd-ng">送料無料まであと ' + yen(FREE - total) + '</span>';
      var btn = sec.querySelector('#lmBdBtn');
      btn.disabled = !on.length;
      btn.textContent = on.length
        ? (on.length === picked.length ? on.length + 'つすべてをカートに追加する：' + yen(total)
                                       : on.length + '点をカートに追加する：' + yen(total))
        : 'カートに追加する';
      btn.__on = on;
    }
    sec.querySelectorAll('.lm-bd-cb').forEach(function (cb) { cb.addEventListener('change', sync); });
    var btn = sec.querySelector('#lmBdBtn');
    if (!btn.__bound) {
      btn.__bound = true;
      btn.addEventListener('click', function () {
        var on = this.__on || [];
        if (!on.length || !LM.add) return;
        on.forEach(function (p) { if (p.vi >= 0) p.it.sel = p.vi; LM.add(p.it, p.q, btn); });
        var t = this.textContent;
        this.textContent = '✓ カートに追加しました';
        this.disabled = true;
        var self = this;
        setTimeout(function () { self.textContent = t; self.disabled = false; }, 2000);
      });
    }
    sync();
  }

  /* 2026-09-03 ryotaro指示で、会員限定ページの「まとめ買いで送料無料」ボックスは
     いったん出さない（商品詳細ページ側のおすすめは残す）。
     復活させるときは applyBundle() をここに戻す。 */
  function apply() { try { applyDetails(); } catch (e) { console.error(e); } }

  /* カードは何度か描き直される（在庫の取得後・発売時刻・タブ復帰）。
     ページ側の render() から呼ばれない経路でも確実に付くよう、
     #cards の中身が変わったら付け直す。 */
  var observing = false;
  function watch() {
    if (observing) return;
    var cards = document.getElementById('cards');
    if (!cards || !window.MutationObserver) return;
    observing = true;
    var t = null;
    new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(apply, 60);
    }).observe(cards, { childList: true });
  }

  document.addEventListener('DOMContentLoaded', function () { apply(); watch(); });
  setTimeout(function () { apply(); watch(); }, 400);
  setTimeout(function () { apply(); watch(); }, 1500);

  window.edaMemberExtras = { apply: function () { apply(); watch(); } };
})();
