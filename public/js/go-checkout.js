/* ============================================================
   決済へ進む ボタンの出し入れ
   2026-10-27 田崎さん指示（決済導線）
   ------------------------------------------------------------
   ページに置いてある <a class="eda-gocheckout"> を、
   カートに1点でも入っていたら出す／空なら消す。それだけ。

   🔴 金額の計算には一切触らない。
      小計も送料も出さない（お米の常温便 ¥1,100 等でレジの合計と
      食い違うため）。点数だけ数えて表示する。
   🔴 カートの中身も書き換えない。読むだけ。
      既存の addToCart / renderCart / カートドロワー / レジは無改造。
   ------------------------------------------------------------
   仕組みは このリポジトリに既にある simple-sticky-cart と同じ型:
     ・#cartBadge があればその変化を見る（一覧ページ)
     ・無ければ localStorage を読む（商品ページ)
     ・クリックと storage イベントの後に取り直す
   ============================================================ */
(function () {
  'use strict';

  var CART_KEY = 'eda-cart';

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }

  function countFromCart() {
    return read().reduce(function (s, i) {
      var q = i && Number(i.qty);
      return s + (q > 0 ? q : 1);
    }, 0);
  }

  function sync() {
    var btns = document.querySelectorAll('.eda-gocheckout');
    if (!btns.length) return;

    var n = countFromCart();

    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var cnt = b.querySelector('[data-gc-count]');
      if (cnt) cnt.textContent = n;
      if (n > 0) {
        b.classList.add('is-on');
        b.removeAttribute('aria-hidden');
      } else {
        b.classList.remove('is-on');
        b.setAttribute('aria-hidden', 'true');
      }
    }

    /* 右下に出ている間だけ、同じ右下に出る他のもの（クーポンのポップ等）を
       上に逃がすための目印。逃がす量は go-checkout.css 側に書いてある。 */
    document.body.classList.toggle('has-gocheckout', n > 0);
  }

  var timer = null;
  function syncSoon(ms) {
    clearTimeout(timer);
    timer = setTimeout(sync, ms == null ? 150 : ms);
  }

  /* カートに積む経路が複数ある（カード・PDP・バンドル・まとめ買い）ので、
     押されたら少し遅れて取り直す。simple-sticky-cart と同じやり方。 */
  document.addEventListener('click', function () { syncSoon(150); }, true);
  window.addEventListener('storage', function () { syncSoon(0); });
  window.addEventListener('pageshow', function () { syncSoon(0); });

  /* 一覧ページはヘッダーのバッジが正確に更新されるので、その変化も拾う */
  function watchBadge() {
    var badge = document.getElementById('cartBadge');
    if (!badge || typeof MutationObserver === 'undefined') return;
    new MutationObserver(function () { syncSoon(0); })
      .observe(badge, { childList: true, characterData: true, subtree: true });
  }

  function init() {
    watchBadge();
    sync();
    /* 商品データの読み込み後にカートが整理される実装があるので、念のため1回 */
    setTimeout(sync, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
