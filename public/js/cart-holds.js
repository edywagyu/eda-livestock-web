/* ============================================================
   カート確保（他のお客様が確保中の数）
   ------------------------------------------------------------
   GAS ?action=cart_holds を定期取得し、「残り○」表示から
   他のお客様がカートに入れている分を差し引く。
   ＝ 売れていなくても、他の人がカートに入れた瞬間に残数が減る。

   ⚠️ この数字は GAS 側の在庫検証（validateStockBeforeCheckout）と同じ値。
      確保中の分は他のお客様が実際に買えない。
      表示だけ減らす「演出用カウンタ」には絶対にしないこと（景表法・有利誤認）。
      止めるときは GAS の Script Property CART_HOLD_ENFORCE=false にする。
      そうすると API が holds:{} を返すので、表示も自動で元に戻る。

   公開する関数:
     window.edaHeldCount(title)        … その商品の他人による確保数
     window.edaAvailable(title, stock) … 表示すべき残数 = stock - 確保数
     window.edaRefreshCartHolds()      … 手動で再取得

   関連: gas/cart_holds.gs
   ============================================================ */
(function () {
  'use strict';

  var GAS_URL = 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';
  var POLL_MS = 45 * 1000;        /* GAS 側は 30 秒キャッシュなので、これ以上速くしても意味がない */
  var SESSION_KEY = 'eda-sess';   /* analytics.js と同じキー */

  window.EDA_CART_HOLDS = window.EDA_CART_HOLDS || {};

  function mySessionId() {
    if (window.edaAnalytics && typeof window.edaAnalytics.sessionId === 'function') {
      return window.edaAnalytics.sessionId();
    }
    try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; }
  }

  window.edaHeldCount = function (title) {
    var n = Number(window.EDA_CART_HOLDS[title]);
    return isFinite(n) && n > 0 ? n : 0;
  };

  /* 表示用の残数。stock が数値でなければ触らない（null を返して呼び出し側にフォールバックさせる） */
  window.edaAvailable = function (title, stock) {
    var s = Number(stock);
    if (!isFinite(s)) return null;
    return Math.max(0, s - window.edaHeldCount(title));
  };

  /* 取得後に既存の描画関数を叩き直す。増えたら足す */
  function rerender() {
    ['refreshNikunohiLeft', 'refreshStockBadges', 'pdpApplyStock'].forEach(function (fn) {
      if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
    });
  }

  var inFlight = false;

  function load() {
    if (inFlight) return;
    inFlight = true;
    var url = GAS_URL + '?action=cart_holds&session_id=' + encodeURIComponent(mySessionId());
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        /* enforced=false（＝実際には押さえていない）なら確保表示もしない */
        window.EDA_CART_HOLDS = (data.enforced === false) ? {} : (data.holds || {});
        window.EDA_CART_HOLD_MINUTES = Number(data.hold_minutes) || 30;
        rerender();
      })
      .catch(function () { /* 取れなければ確保ゼロのまま＝在庫そのままを表示 */ })
      .then(function () { inFlight = false; });
  }

  window.edaRefreshCartHolds = load;

  function boot() {
    load();
    setInterval(function () {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    /* タブに戻ってきたら即更新（放置後に古い残数を見せない） */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') load();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
