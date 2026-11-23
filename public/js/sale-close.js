/* ============================================================
   販売終了時刻 — 「カートに入っている分まで含めて」買えなくする
   ------------------------------------------------------------
   limited-stock.js の limitedSoldOutAt / limitedUntil は
   「店頭の表示」と「新しくカートに入れること」を止めるだけで、
   すでにカートに入っているぶんはそのまま決済できる（カート内は
   localStorage にあり、GAS はシートの実在庫しか見ないため）。
   それは「締切後も少し待つ」運用には都合がよいが、本当に締めたい
   時刻には何も止まらない。その最後の栓がこのファイル。

   使い方: 下の CLOSE_AT に「商品名 → この時刻を過ぎたら完全に買えない」
   を1行足すだけ。商品名は products シートの name と1文字も変えない
   （決済も在庫減算も名前で引くため）。
   終わった商品は行を消さずに残しておいてよい（過ぎた時刻は常に閉じる）。

   🔴 これはお客様の画面で止めるもの。サーバー側(GAS)の最終防壁ではない。
      古いタブ・キャッシュから直接叩かれる経路までは塞がない。
   ============================================================ */
(function (global) {
  'use strict';

  var CLOSE_AT = {
    /* 2026-11-15 田崎さん指示。
       11/16(月)00:00 に店頭から消えて新規のカート追加は止まる
       （products-master.js の limitedSoldOutAt / limitedUntil）。
       そこから丸1日は、すでにカートに入れている方の決済を受ける。
       この時刻でその猶予も終わり。 */
    '江田和牛 ハンバーグと平飼い鶏の食卓セット': '2026/11/16 23:59',

    /* 2026-11-23 田崎さん指示「11月24日0時になったら販売中止」。
       products-master.js の limitedSoldOutAt '2026/11/23 23:59' は
       limited-stock.js の parseUntil が秒を :59 で読むので
       11/24 00:00:00 に店頭から消えて新規のカート追加も止まる。
       ただしそれだけでは、すでにカートに入れている分の決済は通ってしまう。
       ハンバーグのセットのような猶予は置かない指示なので、同じ時刻で栓をする。 */
    '訳あり切り落とし 期間限定': '2026/11/24 00:00'
  };

  /* 'YYYY/MM/DD HH:mm' を端末のローカル時刻として読む。
     limited-stock.js の parseUntil と同じ規則にそろえてある
     （new Date('2026/11/16 23:59') は Safari でも通る書式）。 */
  function parseAt(s) {
    if (!s) return null;
    var d = new Date(String(s).replace(/-/g, '/'));
    return isNaN(d.getTime()) ? null : d;
  }

  function closeAtOf(title) {
    return parseAt(CLOSE_AT[String(title || '').trim()]);
  }

  function isClosed(title, now) {
    var at = closeAtOf(title);
    if (!at) return false;
    return (now || new Date()) > at;
  }

  /* カートの中から「もう買えない商品名」を重複なしで返す */
  function closedTitlesIn(items) {
    var seen = {}, out = [];
    (items || []).forEach(function (it) {
      var t = (it && (it.title || it.name)) || '';
      if (!t || seen[t]) return;
      if (isClosed(t)) { seen[t] = true; out.push(t); }
    });
    return out;
  }

  global.EDA_SALE_CLOSE = {
    isClosed: isClosed,
    closeAtOf: closeAtOf,
    closedTitlesIn: closedTitlesIn
  };
})(typeof window !== 'undefined' ? window : this);
