/* ============================================================
   江田畜産 — お支払いリンク（請求リンク）の共通ロジック
   ------------------------------------------------------------
   発行側 (invoice-new.html) と 支払い側 (invoice.html) が
   同じ計算・同じ検査値を使うための1ファイル。
   🔴 片方だけ直すと「リンクが無効です」になるので必ず両方で読む。

   URL パラメータ
     n  品目名（お客様に見える請求内容の名前）
     a  金額（円・整数）      … t=in なら税込額 / t=out なら税抜額
     t  税区分 in=税込 / out=税別（10%を上に乗せる）
     s  送料（円・整数）      … 0 = 送料込み（別途請求しない）
     to お客様名（任意・画面に「◯◯ 様」と出すだけ）
     m  ひとこと（任意・請求内容の下に出す）
     no 請求番号（任意・画面と注文メモに出す）
     k  検査値（上のうち a/t/s/n から計算。URL の数字を書き換えると無効になる）
   ============================================================ */
(function (global) {
  'use strict';

  function toInt(v) {
    var n = parseInt(String(v == null ? '' : v).replace(/[^\d-]/g, ''), 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /* 検査値: 金額・税区分・送料・品目名から作る短い文字列。
     お客様が URL の金額を書き換えると一致しなくなり、支払い画面が無効になる。 */
  function sign(inv) {
    var s = 'EDA|' + toInt(inv.amount) + '|' + (inv.tax === 'out' ? 'out' : 'in') + '|' +
            toInt(inv.ship) + '|' + String(inv.label || '');
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = (((h * 33) ^ s.charCodeAt(i)) >>> 0);
    return h.toString(36).slice(0, 7);
  }

  /* 内訳（表示とStripeに渡す金額の唯一の計算場所）
       goods … 商品代金（税込）＝ Stripe に渡す品目の金額
       tax   … 消費税（税別=上乗せ分 / 税込=内訳としての「うち消費税」）
       total … 請求合計（商品代金＋送料） */
  function breakdown(inv) {
    var a = toInt(inv.amount);
    var ship = toInt(inv.ship);
    var out = (inv.tax === 'out');
    var tax = out ? Math.round(a * 0.1) : (a - Math.round(a / 1.1));
    var goods = out ? a + tax : a;
    return { base: a, tax: tax, goods: goods, ship: ship, total: goods + ship, taxOut: out };
  }

  function buildQuery(inv) {
    var p = new URLSearchParams();
    p.set('n', String(inv.label || ''));
    p.set('a', String(toInt(inv.amount)));
    p.set('t', inv.tax === 'out' ? 'out' : 'in');
    p.set('s', String(toInt(inv.ship)));
    if (inv.to)   p.set('to', String(inv.to));
    if (inv.note) p.set('m', String(inv.note));
    if (inv.no)   p.set('no', String(inv.no));
    p.set('k', sign(inv));
    return p.toString();
  }

  function parse(search) {
    var p = new URLSearchParams(search || '');
    return {
      label: (p.get('n') || '').slice(0, 80),
      amount: toInt(p.get('a')),
      tax: p.get('t') === 'out' ? 'out' : 'in',
      ship: toInt(p.get('s')),
      to: (p.get('to') || '').slice(0, 40),
      note: (p.get('m') || '').slice(0, 200),
      no: (p.get('no') || '').slice(0, 40),
      k: p.get('k') || ''
    };
  }

  function valid(inv) {
    return !!inv && inv.amount > 0 && !!inv.label && inv.k === sign(inv);
  }

  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

  global.EDA_INVOICE = {
    toInt: toInt, sign: sign, breakdown: breakdown,
    buildQuery: buildQuery, parse: parse, valid: valid, yen: yen
  };
})(window);
