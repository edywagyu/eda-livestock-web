/* 江田畜産 — 商品詳細ページ「どの部位ですか？」の牛の部位図（2026-10-01）
   使い方: EDA_CUT_MAP.render(container, productId)

   ・図は部位ごとに1枚の画像。public/images/cuts/ に置き、下の PARTS に登録する
   ・商品への割り当ては MAP。商品の部位と図の色が一致するものだけを入れている
     （「ウチモモ／ランプ」のように2部位の商品は2枚並べる）
   ・登録の無い商品には何も出さない。鶏・ホルモン・混合セットに牛の図が出ないのはこのため
   ・文字から推測して光らせることは意図的にやっていない（誤表示を防ぐため） */
window.EDA_CUT_MAP = (function () {
  'use strict';

  var DIR = 'public/images/cuts/';

  /* 部位キー → { f: ファイル名, p: 表示する部位名 } */
  var PARTS = {
    sotomomo: { f: 'cut-sotomomo.webp', p: 'ソトモモ' },
    uchimomo: { f: 'cut-uchimomo.webp', p: 'ウチモモ' },
    ranpu:    { f: 'cut-ranpu.webp',    p: 'ランプ' },
    hire:     { f: 'cut-hire.webp',     p: 'ヒレ' },
    sirloin:  { f: 'cut-sirloin.webp',  p: 'サーロイン' },
    ude:      { f: 'cut-ude.webp',      p: 'ウデ' },
    katarosu: { f: 'cut-katarosu.webp', p: '肩ロース' },
    bara:     { f: 'cut-bara.webp',     p: 'カタバラ・トモバラ' }
  };

  /* 商品ID → 部位キーの配列。
     ⚠️ 商品の部位と図の色が完全に一致するものだけを入れる。
     未登録のまま残している商品と、その理由:
       P005/P041/P031 切り落とし・訳ありスライス … ウデ＋肩ロース＋ソトモモの3色の図が無い
       P006/P027/P030/P033 バラ焼肉・焼肉セット … トモバラだけを塗った図が無い
                                                  （cut-bara.webp はカタバラも塗られている）
       P010B/P042 ミンチ … バラ＋ランプの図が無い
       P035/P036/P037 カメノコ・シンシン … シンタマの図が無い
       P008/P019 ハンバーグ … スネ＋ネックの図が無い
       P028 イチボステーキ … イチボの図が無い
       P021 有機JASリブアイ … リブロースの図が無い
       P009/P010 ローストビーフ・生ハム … モモ全体の図が無い
       P039/P040 食べ比べセット … 3部位になるため図が3枚並ぶ。要・合成図
       P007 ホルモン（小腸＝内臓）/ P043 不揃いセット / 鶏6点 … 牛の部位図では示せない */
  var MAP = {
    P004: ['sotomomo'],              /* 赤身スライス */
    P001: ['sirloin'],               /* サーロインステーキ（ロース芯） */
    P020: ['sirloin'],               /* 有機JAS サーロイン */
    P024: ['hire'],                  /* ヒレステーキ */
    P032: ['hire'],                  /* ヒレサイコロステーキ */
    P017: ['hire'],                  /* ヒレステーキ ギフト【松】 */
    P022: ['hire'],                  /* 有機JAS ヒレ */
    P023: ['ude'],                   /* ミスジステーキ（肩甲骨の内側＝ウデ） */
    P025: ['ude'],                   /* 赤身焼肉 */
    P026: ['katarosu'],              /* 霜降スライス */
    P034: ['katarosu'],              /* LINE会員限定 霜降スライス まとめ買い */
    P002: ['uchimomo', 'ranpu'],     /* 赤身ステーキ */
    P003: ['uchimomo', 'ranpu'],     /* サイコロステーキ */
    P018: ['uchimomo', 'ranpu']      /* 赤身ステーキ ギフト【竹】 */
  };

  var CSS = '' +
    '.cutmap{margin:16px 0 2px}' +
    '.cutmap-figs{display:flex;flex-wrap:wrap;gap:10px}' +
    '.cutmap-figs img{width:100%;max-width:460px;height:auto;display:block;border-radius:6px}' +
    '.cutmap-figs.is-multi img{max-width:300px}' +
    '.cutmap-note{margin:6px 0 0;font-size:12px;color:#8C8372;line-height:1.7}';

  function injectCss() {
    if (document.getElementById('cutmap-css')) return;
    var st = document.createElement('style');
    st.id = 'cutmap-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* container の中に図を描く。登録の無い商品なら何もしない（false を返す） */
  function render(container, productId) {
    if (!container) return false;
    var keys = (MAP[productId] || []).filter(function (k) { return PARTS[k]; });
    if (!keys.length) return false;
    injectCss();

    var wrap = document.createElement('div');
    wrap.className = 'cutmap';

    var figs = document.createElement('div');
    figs.className = 'cutmap-figs' + (keys.length > 1 ? ' is-multi' : '');
    keys.forEach(function (k) {
      var it = PARTS[k];
      var img = document.createElement('img');
      img.src = DIR + it.f;
      img.alt = '牛の部位図。色のついたところが' + it.p + 'です';
      img.loading = 'lazy';
      img.decoding = 'async';
      figs.appendChild(img);
    });
    wrap.appendChild(figs);

    var names = keys.map(function (k) { return PARTS[k].p; }).join('・');
    var note = document.createElement('p');
    note.className = 'cutmap-note';
    note.textContent = '色のついたところが、この商品の部位です（' + names + '）。';
    wrap.appendChild(note);

    container.appendChild(wrap);
    return true;
  }

  return { render: render, parts: PARTS, map: MAP };
})();
