/* ============================================================
   購入回数（特典の段階）の数え方 — 唯一の置き場
   ------------------------------------------------------------
   2026-08-26 田崎さん決定: **単品のみ。定期便は数えない。**

   ここを1箇所にしている理由:
     ・checkout.html  … 何回目かで ¥0 の特典を自動同梱する
     ・mypage.html    … 「これまでのご注文 N回」「次回特典」「特典のあゆみ」
     ・staff.html     … 発送処理の「今回で何回目」「同梱する用紙」
   3つが別々に数えると、画面の案内と実際に入る特典がズレる。

   数え方（この4つが全部）:
     ① 定期便(mode が subscription で始まる)は数えない
     ② 届け先が空の行（テスト・決済未完了）は数えない
     ③ 同じ注文番号が複数行あっても1回（Stripe webhook の多重発火対策）
     ④ 同一人物の判定はメールアドレスの小文字一致

   注文オブジェクトは呼び出し元で形が違う（GASの生シート行 / ?action=orders の整形済み）
   ため、どちらの列名でも読めるようにしてある。
   ============================================================ */
(function (g) {
  'use strict';

  function pick(o, a, b) {
    if (!o) return '';
    var v = o[a];
    if (v === undefined || v === null || v === '') v = o[b];
    return v === undefined || v === null ? '' : v;
  }
  function orderNumber(o) { return String(pick(o, 'num', 'order_number')).trim(); }
  function orderEmail(o)  { return String(pick(o, 'email', 'customer_email')).trim().toLowerCase(); }
  function orderDate(o)   { return String(pick(o, 'date', 'placed_at')); }
  function isSubscription(o) { return String(pick(o, 'mode', 'mode')).indexOf('subscription') === 0; }
  function hasDestination(o) {
    var d = pick(o, 'dest', 'destinations_json');
    if (Array.isArray(d)) return d.length > 0;
    var s = String(d || '').trim();
    return !!s && s !== '[]';
  }

  /* 回数に数える注文か（②③以外の条件） */
  function isCountable(o) {
    if (!o) return false;
    if (isSubscription(o)) return false;
    if (!hasDestination(o)) return false;
    return true;
  }

  /* 同じお客様の注文配列 → これまでの回数。
     次の注文が何回目かを知りたいときは +1 する。 */
  function countOrders(orders) {
    if (!Array.isArray(orders)) return 0;
    var seen = {}, n = 0;
    orders.forEach(function (o) {
      var num = orderNumber(o);
      if (num) { if (seen[num]) return; seen[num] = 1; }
      if (isCountable(o)) n++;
    });
    return n;
  }

  /* 全お客様分の注文配列 → { 注文番号: その人の何本目か }。
     並び順に依存しないよう、日付の古い順に振り直してから数える。 */
  function seqIndex(orders) {
    var map = {};
    if (!Array.isArray(orders)) return map;
    var asc = orders.slice().sort(function (a, b) {
      var x = orderDate(a), y = orderDate(b);
      return x < y ? -1 : (x > y ? 1 : 0);
    });
    var seen = {}, count = {};
    asc.forEach(function (o) {
      var num = orderNumber(o);
      if (!num || seen[num]) return;
      seen[num] = 1;
      if (!isCountable(o)) return;
      var email = orderEmail(o);
      if (!email) return;
      count[email] = (count[email] || 0) + 1;
      map[num] = count[email];
    });
    return map;
  }

  g.EdaRewardCount = { countOrders: countOrders, seqIndex: seqIndex, isCountable: isCountable };
})(typeof window !== 'undefined' ? window : this);
