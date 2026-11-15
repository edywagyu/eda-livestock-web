/* ============================================================
   訳あり品「通常品と比べていくら安いか」の表示（2026-11-15 田崎さん指示）
   ------------------------------------------------------------
   使うところ: line-members-wakeari.html（一覧カード）/ product.html（商品ページ）

   🔴 景表法まわりの決まりごと。ここを崩さないこと。
   ・取り消し線は**通常品の価格にだけ**引く。訳あり品と通常品は**別の商品**で、
     訳あり品がその値段で売られていたことは一度も無い＝そのままでは二重価格表示
     （有利誤認）になる。だから必ず次の2つをセットで出すこと:
       ① 取り消した価格の**直前に「通常品」ラベル**を置く
       ② **2行目で比較相手の商品名と内容量**を明記する（この行が取り消し線を
          許容する前提。消したら比較ごと出さないのと同じ扱いにすること）
   ・「→」のような値下げを思わせる記号は使わない（同じ商品が値下げされたと読める）。
   ・「通常価格」「定価」「◯%OFF」は使わない（P074 / P076 の書き方に合わせる）。
   ・金額と差額は products のライブ値から毎回計算する。手書きの数字は置かない。
   ・取り消し線を使う場合は、取り消した価格の直前に必ず「通常品」と書く。
     さらに2行目で、比べた通常品の商品名と内容量を明記する。
   ・金額は税込。2行目に「価格は税込」と添える。

   🔴 出さない条件（どれか1つでも当たれば比較ごと出さない）
   ・ライブ値がまだ来ていない ＝ 同梱マスターの古い価格・在庫で書かない
     （2026-11-15 レビュー指摘。同梱マスターの P024 は在庫16・¥4,750 のまま古い）
   ・比較相手が見つからない
   ・比較相手が published=TRUE でない ＝ 不明なときも出さない（安全側）
   ・比較相手が comingSoon ＝ まだ売っていない
   ・比較相手が限定枠の期間外（発売前／販売停止／表示終了）＝ いま買えない
   ・比較相手の在庫が0 ＝ いま買えない。「通常 ¥◯」と書くと実態と合わない
   ・比較相手の内容量が訳あり品と違う ＝ 内容量の違う単純比較はしない
   ・比較相手の価格が訳あり品以下 ＝ 安くないのに「お得」と書かない
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
    /* 2026-11-15 田崎さん指示で取り消し線の見た目にする。
       🔴 取り消した価格の直前に必ず「通常品」と書くこと。ラベルを外して価格だけを
          取り消し線にすると「この商品が値下げされた」と読め、別商品どうしの比較
          なので二重価格表示（有利誤認）になる。
       🔴 区切りは「／」。矢印「→」は使わない（値下げに見える・2026-11-15 レビュー指摘）。
       🔴 2行目（wk-note）は必須。何と比べたのかを書く行で、これがあるから
          取り消し線を使ってよい。消すなら比較ごと出さないこと。 */
    return '<span class="wk-row">'
         +   '<span class="wk-lbl">通常品</span>'
         +   '<s class="wk-was">' + yen(rp) + '</s>'
         +   '<span class="wk-sep">／</span>'
         +   '<span class="wk-lbl">訳あり</span>'
         +   '<b class="wk-now">' + yen(p) + '</b>'
         +   '<span class="wk-sep">／</span>'
         +   '<b class="wk-save">' + yen(rp - p) + ' お得</b>'
         + '</span>'
         + '<span class="wk-note">通常品＝' + esc(reg.name) + '（' + esc(reg.variant) + '）'
         +   'との比較です／価格は税込</span>';
  }

  window.edaWakeariCompare = { html: html, liveReady: liveReady };
})();
