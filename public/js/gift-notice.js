/* ============================================================
   🎁 ログイン中のお客様に「今回のご購入で◯◯が付きます」を右上に出す
   ------------------------------------------------------------
   2026-08-27 たろ指示。

   出す条件:
     ・マイページにログイン済み（localStorage の eda-mypage-session がある）
     ・付く特典が1つ以上ある、または「あと¥◯◯で付く」状態
   条件は checkout.html と同じ gift-rules.js を見る＝案内と実物がズレない。

   🔴 金額の判定はカート(eda-cart)の小計。checkout の「自宅ぶん小計」とは
      ギフト分の扱いが違うので、ギフトだけの注文では実際には付かない。
      そのため文面は必ず「〜が付きます」ではなく条件つきの言い方にする。
   ============================================================ */
(function () {
  'use strict';

  var SESSION_KEY = 'eda-mypage-session';
  var CART_KEY    = 'eda-cart';
  var HIDE_KEY    = 'eda-gift-notice-hidden';

  function readJSON(k, fallback) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }

  function cartSubtotal() {
    var cart = readJSON(CART_KEY, []);
    if (!Array.isArray(cart)) return 0;
    return cart.reduce(function (s, it) {
      return s + (Number(it && it.price) || 0) * (Number(it && it.qty) || 1);
    }, 0);
  }

  function customerName(session) {
    var c = (session && session.cache && session.cache.customer) || null;
    var n = (c && (c.name || c.customer_name)) || '';
    n = String(n).trim();
    if (n) return n;
    var mail = String((session && session.email) || '').trim();
    return mail ? mail.split('@')[0] : '';
  }

  function stageOf(session) {
    var orders = (session && session.cache && session.cache.orders) || [];
    if (!window.EdaRewardCount || !Array.isArray(orders)) return 0;
    return window.EdaRewardCount.countOrders(orders) + 1;   /* 次の注文が何回目か */
  }

  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

  function build() {
    var R = window.EDA_GIFT_RULES;
    if (!R) return null;
    var session = readJSON(SESSION_KEY, null);
    if (!session) return null;                       /* 未ログインには出さない */

    var name = customerName(session);
    if (!name) return null;

    var sub  = cartSubtotal();
    var rows = [];

    /* ① 購入回数特典 */
    var r = R.REWARD_BY_STAGE[stageOf(session)];
    if (r) {
      rows.push(sub >= R.REWARD_MIN_SUBTOTAL
        ? { on: true,  text: r.title + (r.qty > 1 ? '（' + r.qty + '点）' : '') + ' が付いてきます', sub: r.label }
        : { on: false, text: 'あと ' + yen(R.REWARD_MIN_SUBTOTAL - sub) + ' で ' + r.title + ' が付いてきます', sub: r.label });
    }

    /* ② 肉の日キャンペーン特典（期間内だけ） */
    var C = R.CAMPAIGN, now = new Date();
    if (C && now >= R.at(C.from) && now <= R.at(C.until)) {
      rows.push(sub >= C.minSubtotal
        ? { on: true,  text: C.title + ' ' + C.variant + ' が付いてきます', sub: C.label }
        : { on: false, text: 'あと ' + yen(C.minSubtotal - sub) + ' で ' + C.title + ' が付いてきます', sub: C.label });
    }

    if (!rows.length) return null;
    return { name: name, rows: rows };
  }

  function render(data) {
    var el = document.getElementById('edaGiftNotice');
    if (!data) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('aside');
      el.id = 'edaGiftNotice';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      el.addEventListener('click', function (e) {
        if (!e.target.closest('.egn-close')) return;
        try { localStorage.setItem(HIDE_KEY, new Date().toDateString()); } catch (err) {}
        el.remove();
      });
    }
    var lines = data.rows.map(function (r) {
      return '<li class="egn-row' + (r.on ? ' is-on' : '') + '">'
           + '<span class="egn-dot">' + (r.on ? '🎁' : '＋') + '</span>'
           + '<span><b>' + esc(r.text) + '</b><small>' + esc(r.sub) + '</small></span></li>';
    }).join('');
    el.innerHTML =
      '<button class="egn-close" type="button" aria-label="閉じる">×</button>'
      + '<p class="egn-head">' + esc(data.name) + ' 様｜今回のご購入で</p>'
      + '<ul class="egn-list">' + lines + '</ul>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function refresh() {
    var hidden = false;
    try { hidden = localStorage.getItem(HIDE_KEY) === new Date().toDateString(); } catch (e) {}
    render(hidden ? null : build());
  }

  function start() {
    refresh();
    /* カートを触ったら金額が変わる＝「あと¥◯◯」を追従させる */
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key === CART_KEY || e.key === SESSION_KEY) refresh();
    });
    document.addEventListener('eda:cart-changed', refresh);
    setInterval(refresh, 4000);   /* 同一タブ内の localStorage 変更は storage が飛ばないため */
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
