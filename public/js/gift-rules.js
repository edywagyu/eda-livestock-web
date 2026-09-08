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

    /* キャンペーン特典（¥0 で同梱する1品）。期間を過ぎたら自動で付かなくなる＝撤去作業は不要。
       2026-09-07 更新（田崎さん指示）: 特大ハンバーグ新発売の配信に合わせて切り落としを再開。
         ・条件は「自宅に届く小計 ¥10,000 以上」。送料無料ライン ¥11,000 の手前に置く。
         ・9/7(月) 23:59 まで（2026-09-07 田崎さん指示で今日までに短縮）。
         ・切り落としの在庫が特典ぶんを割ったら checkout.html 側で自動的に付かなくなる。
       前回は「肉の日キャンペーン特典」2026-08-27〜08-30・同じ切り落とし1袋だった。 */
    CAMPAIGN: {
      title: '切り落とし',
      variant: '1袋 200g',
      qty: 1,
      label: '切り落としプレゼント',
      img: 'public/images/products/drive/kiriotoshi.jpg',
      minSubtotal: 10000,
      from:  [2026, 8, 7, 18, 0, 0],      /* 月は 0 始まり＝8 は9月 */
      until: [2026, 8, 7, 23, 59, 59]
    },

    /* 配列 → Date。checkout.html と gift-notice.js で同じ解釈をさせるため。 */
    at: function (a) { return new Date(a[0], a[1], a[2], a[3], a[4], a[5]); }
  };
})(typeof window !== 'undefined' ? window : this);
