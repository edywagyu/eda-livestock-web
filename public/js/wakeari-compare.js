/* ============================================================
   訳あり品「通常品と比べていくら安いか」の表示（2026-11-15 田崎さん指示）
   ------------------------------------------------------------
   使うところ: line-members-wakeari.html（一覧カード）/ product.html（商品ページ）

   出すもの（2026-11-15 田崎さん指示でここまで削った）:
       通常のヒレステーキ（1枚 150g） ¥4,750   ← 小さく1行・金額に取り消し線
     売価そのものはページ側の既存の価格表示をそのまま使う（赤字）。
     金額を二度出さないため、この関数は売価を出さない。

   🔴 景表法の最低ライン。ここだけは絶対に崩さないこと。
   ・**比較相手の商品名と内容量を必ず書く。** これが削れる最後の線。
     消費者庁「不当な価格表示についての景品表示法上の考え方」では、比較対照が
     **他の商品の価格**のときは、どの商品の価格かを明示しないと不当表示になる。
     訳あり品は通常品の値段で売られていたことが一度も無いので、
     「通常 ¥4,750」のように商品名を落とすと「この商品が値下げされた」としか
     読めず、有利誤認になる（2026-11-15 レビュー指摘）。
     田崎さんが消してよいと言ったのは「お得」「◯◯との比較です」の説明文であって、
     比較相手が何かを示すこの部分ではない。
   ・「→」のような値下げを思わせる記号は使わない（同じ商品が値下げされたと読める）。
   ・「通常価格」「定価」「◯%OFF」は使わない（P074 / P076 の書き方に合わせる）。
   ・金額は products のライブ値から毎回計算する。手書きの数字は置かない。
   ・税込であることはページ側で明示する（一覧は冒頭の「表示価格はすべて税込です。」、
     商品ページは価格直下の「表示価格はすべて税込 / 別途 送料…」）。ここには書かない。

   🔴 出さない条件（どれか1つでも当たれば比較ごと出さない）
   ・ライブ値がまだ来ていない ＝ 同梱マスターの古い価格・在庫で書かない
     （2026-11-15 レビュー指摘。同梱マスターの P024 は在庫16・¥4,750 のまま古い）
   ・比較相手が見つからない
   ・比較相手が published=TRUE でない ＝ 不明なときも出さない（安全側）
   ・比較相手が comingSoon ＝ まだ売っていない
   ・比較相手が限定枠の期間外（発売前／販売停止／表示終了）＝ いま買えない
   ・比較相手の在庫が0 ＝ いま買えない。「通常 ¥◯」と書くと実態と合わない
   ・比較相手の内容量が訳あり品と違う ＝ 内容量の違う単純比較はしない
   ・比較相手の価格が訳あり品以下 ＝ 安くないのに高い価格を取り消して見せない
   ============================================================ */
(function () {
  'use strict';

  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function ms(v) { var t = v ? new Date(v).getTime() : 0; return isNaN(t) ? 0 : t; }

  /* 限定枠（limitedStartAt / limitedSoldOutAt / limitedUntil）で、いま買えない状態か。 */
  function limitedClosed(reg) {
    var now = Date.now();
    var start = ms(reg.limitedStartAt);
    if (start && now < start) return true;                 /* 発売前 */
    var sold = ms(reg.limitedSoldOutAt);
    if (sold && now >= sold) return true;                  /* 販売停止 */
    var until = ms(reg.limitedUntil);
    if (until && now >= until) return true;                /* 表示終了 */
    return false;
  }

  /* ライブ値（public_catalog / products-loader.js が入れた値）が来ているか。
     来ていないあいだは同梱マスターの古い数字しか無いので、比較は出さない。 */
  function liveReady() {
    var m = window.EDA_PRODUCTS_MASTER;
    return !!(m && typeof m.version === 'string' && m.version.indexOf('gas-') === 0);
  }

  /* reg     … 比較する通常品のライブ行（name / variant / price / stock / published）
     price   … 訳あり品のいまの売価（1口ぶん）
     variant … 訳あり品の内容量（reg.variant と一致しなければ出さない） */
  function html(reg, price, variant) {
    if (!reg) return '';
    var pub = reg.published;
    if (!(pub === true || String(pub).trim().toUpperCase() === 'TRUE')) return '';
    if (reg.comingSoon === true || String(reg.comingSoon).trim().toUpperCase() === 'TRUE') return '';
    if (limitedClosed(reg)) return '';
    if (!(Number(reg.stock) > 0)) return '';
    var rp = Number(reg.price) || 0;
    var p  = Number(price) || 0;
    if (!(rp > p)) return '';
    if (String(reg.variant || '').trim() !== String(variant || '').trim()) return '';
    /* 🔴 商品名と内容量は絶対に消さないこと（冒頭の注意書きのとおり）。
       取り消し線は金額にだけ引く。売価はページ側の価格表示が赤字で出す。 */
    return '<span class="wk-lbl">通常の' + esc(reg.name) + '（' + esc(reg.variant) + '）</span>'
         + '<s class="wk-was">' + yen(rp) + '</s>';
  }

  window.edaWakeariCompare = { html: html, liveReady: liveReady };
})();
