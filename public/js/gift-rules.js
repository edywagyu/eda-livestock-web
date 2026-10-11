/* ============================================================
   🎁 ¥0 で同梱する特典の条件 — 唯一の置き場
   ------------------------------------------------------------
   ここを1箇所にしている理由は reward-count.js と同じ。
     ・checkout.html      … 実際に ¥0 の行を足す
     ・gift-notice.js     … ログイン中のお客様に「今回◯◯が付きます」と出す
   別々に持つと、画面の案内と実際に入る特典がズレる。

   🔴 title は products シートの name と1文字も変えないこと。
      決済後の在庫減算は商品名の完全一致でしか引かない。目印は variant 側に入れる。
   🔴 defer を付けずに読み込むこと（checkout.html のインライン定義より先に要る）。
   ============================================================ */
(function (g) {
  'use strict';
  g.EDA_GIFT_RULES = {
    MARK: '🎁',

    /* 購入回数特典。マイページの案内と同じ条件。
       🔴 2026-09-08 田崎さん指示で金額条件を撤廃（5,000円 → 0円）。
          0 にしておけば「自宅に届く荷物がある注文なら必ず付く」になる。
          金額で絞りたくなったらここに数字を戻すだけでよい。 */
    REWARD_MIN_SUBTOTAL: 0,
    /* 🔗 ご注文特典を「公式LINE連携済みの方だけ」に限定するか（2026-09-08 田崎さん指示）。
       連携率が 758人中90人(12%)しかなく、連携する理由が無かったため。
       false に戻せば全員が対象に戻る。送料の特典(5回目)はGAS側の判定なので別建て。 */
    REWARD_LINE_ONLY: true,
    /* 🎁 2026-09-08 田崎さん指示で階段を組み替えた。
       ① 初回特典を 10%OFFクーポン(LINE10) から「平飼い鶏 モモ 1袋」に変更。
          53人に配ったクーポンで買ったのは1人(1.9%)だったため、値引きではなく現物にする。
          クーポンと違って入力が要らない＝コードの打ち間違いや期限切れで落ちない。
       ② 2回目の「送料半額」をやめて「送料無料」にし、5回目へ移した。
          以降の現物特典は全部ひとつ前へ繰り下げ（旧3→2 / 旧4→3 / 旧5→4）。
       🔴 5回目の送料無料はここには書かない。送料は商品行ではなく
          GAS の calcShipping が決めるため、REWARD_BY_STAGE に混ぜると
          ¥0の商品行として同梱されてしまう。実体は Code.js の repeatShipStage_()。 */
    REWARD_BY_STAGE: {
      1: { title: '平飼い鶏 モモ', variant: '1袋 200g', qty: 1, label: '初回ご注文特典',   img: 'public/images/products/drive/chicken-thigh.jpg' },
      2: { title: '平飼い鶏 モモ', variant: '1袋 200g', qty: 1, label: '2回目ご注文特典', img: 'public/images/products/drive/chicken-thigh.jpg' },
      3: { title: 'ハンバーグ',    variant: '1個 130g', qty: 2, label: '3回目ご注文特典', img: 'public/images/products/drive/hamburg.jpg' },
      4: { title: '赤身焼肉',      variant: '1袋 200g', qty: 1, label: '4回目ご注文特典', img: 'public/images/products/drive/akami-yakiniku.jpg' }
    },

    /* キャンペーン特典（¥0 で同梱する品）。期間を過ぎたら自動で付かなくなる＝撤去作業は不要。
       2026-10-11 更新（田崎さん指示）: 公式LINEで 10/6・10/8・10/11 の3配信で告知した
       「¥15,000以上のご注文に 和牛ミンチ200g＋バラ焼肉200g の2袋」。
         ・🔴 ここが2品になったのは今回が初めて。items 配列が正で、1品だけのときも
           items に1件書く。古い単品キー(title/variant/qty/img)も読めるようにしてあるが、
           新しく書くときは items を使う。
         ・🔴 title は products シートの name と1文字も変えない。和牛ミンチの name は
           「和牛ミンチ」ではなく『ミンチ』。お客様に見せる名前は display に書く。
         ・¥15,000 は「自宅に届く荷物」の小計で判定する（ギフトだけの注文には付かない）。
         ・10/6(火) 18:00 〜 10/11(日) 23:59。配信本文の締切と1分もズラさない。
         ・ミンチ・バラ焼肉とも他のセットの構成品でもあるので、在庫はキャンペーン中に見ておく。
           在庫を割った品は checkout.html 側で自動的に外れる＝売り越さない。
       前回は 2026-09-29 の肉の日・バラ焼肉1袋・金額条件なしだった。 */
    CAMPAIGN: {
      label: '¥15,000以上プレゼント',
      minSubtotal: 15000,                 /* 0 = 金額条件なし（全注文） */
      from:  [2026, 9, 6, 18, 0, 0],      /* 月は 0 始まり＝9 は10月 */
      until: [2026, 9, 11, 23, 59, 59],
      items: [
        { title: 'ミンチ',   variant: '1袋 200g', qty: 1, display: '和牛ミンチ 200g',
          img: 'public/images/products/drive/minced.jpg' },
        { title: 'バラ焼肉', variant: '1袋 200g', qty: 1, display: 'バラ焼肉 200g',
          img: 'public/images/products/drive/yakiniku-brisket-2026.jpg' }
      ]
    },

    /* キャンペーン特典の品を配列で返す。items があればそれ、無ければ古い単品キーを
       1件の配列に包む＝過去の書き方のまま置いてある CAMPAIGN も壊さない。 */
    campaignItems: function () {
      var c = this.CAMPAIGN;
      if (!c) return [];
      if (c.items && c.items.length) return c.items;
      return c.title ? [{ title: c.title, variant: c.variant, qty: c.qty, display: c.display, img: c.img }] : [];
    },

    /* お客様に見せる1行（「和牛ミンチ 200g＋バラ焼肉 200g」）。display があればそれを使う。
       display が無い品は「名前 variant」で組む＝古い書き方でも文章になる。 */
    campaignText: function () {
      return this.campaignItems().map(function (i) {
        return (i.display || (i.title + ' ' + i.variant)) + (i.qty > 1 ? '×' + i.qty : '');
      }).join('＋');
    },

    /* 配列 → Date。checkout.html と gift-notice.js で同じ解釈をさせるため。 */
    at: function (a) { return new Date(a[0], a[1], a[2], a[3], a[4], a[5]); }
  };
})(typeof window !== 'undefined' ? window : this);
