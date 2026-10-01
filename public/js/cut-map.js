/* 江田畜産 — 商品詳細ページ「どの部位ですか？」の牛の部位図（2026-10-01）
   使い方: EDA_CUT_MAP.render(container, productId)

   ・図は1商品1枚の画像。public/images/cuts/ に置き、下の IMAGES に商品IDで登録する
   ・登録の無い商品には何も出さない（牛の図が嘘になる鶏・ホルモン・混合セットを守るため、
     「文字から推測して光らせる」ことは意図的にやっていない）
   ・画像を足したら IMAGES に1行足すだけで、その商品に出るようになる */
window.EDA_CUT_MAP = (function () {
  'use strict';

  var DIR = 'public/images/cuts/';

  /* 商品ID → { f: ファイル名, p: 部位名 } */
  var IMAGES = {
    P004: { f: 'cut-sotomomo.webp', p: 'ソトモモ' }   /* 赤身スライス（2026-10-01 お試しで1商品だけ） */
  };

  var CSS = '' +
    '.cutmap{margin:16px 0 2px}' +
    '.cutmap img{width:100%;max-width:460px;height:auto;display:block;border-radius:6px}' +
    '.cutmap-note{margin:4px 0 0;font-size:12px;color:#8C8372;line-height:1.7}';

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
    var it = IMAGES[productId];
    if (!it) return false;
    injectCss();

    var wrap = document.createElement('div');
    wrap.className = 'cutmap';

    var img = document.createElement('img');
    img.src = DIR + it.f;
    img.alt = '牛の部位図。色のついたところが' + it.p + 'です';
    img.loading = 'lazy';
    img.decoding = 'async';
    wrap.appendChild(img);

    var note = document.createElement('p');
    note.className = 'cutmap-note';
    note.textContent = '色のついたところが、この商品の部位です（' + it.p + '）。';
    wrap.appendChild(note);

    container.appendChild(wrap);
    return true;
  }

  return { render: render, images: IMAGES };
})();
