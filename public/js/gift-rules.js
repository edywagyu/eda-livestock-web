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

    /* 購入回数特典（2026-08-26 田崎さん指示）。マイページの案内と同じ条件。 */
    REWARD_MIN_SUBTOTAL: 5000,
    REWARD_BY_STAGE: {
      3: { title: '平飼い鶏 モモ', variant: '1袋 200g', qty: 1, label: '3回目ご注文特典', img: 'public/images/products/drive/chicken-thigh.jpg' },
      4: { title: 'ハンバーグ',    variant: '1個 130g', qty: 2, label: '4回目ご注文特典', img: 'public/images/products/drive/hamburg.jpg' }
    },

    /* 肉の日キャンペーン特典（2026-08-27〜08-30）。期間を過ぎたら自動で付かなくなる。 */
    CAMPAIGN: {
      title: '切り落とし',
      variant: '1袋 200g',
      qty: 1,
      label: '肉の日キャンペーン特典',
      img: 'public/images/products/drive/kiriotoshi.jpg',
      minSubtotal: 10000,
      from:  [2026, 7, 27, 0, 0, 0],      /* 月は 0 始まり */
      until: [2026, 7, 30, 23, 59, 59]
    },

    /* 配列 → Date。checkout.html と gift-notice.js で同じ解釈をさせるため。 */
    at: function (a) { return new Date(a[0], a[1], a[2], a[3], a[4], a[5]); }
  };
})(typeof window !== 'undefined' ? window : this);
