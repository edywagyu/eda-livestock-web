/* ============================================================
   error-tracker.js — スタンドアロン グローバルエラートラッカー
   全ページ用（bundle を読まないページに <head> で読み込む）。
   - window error / unhandledrejection を捕捉し GAS client_errors へ送信
   - EDA_API があればそれを使い、無ければ GAS へ直接 POST（自己完結）
   - window.__edaErrTracker で二重登録ガード（bundle内トラッカーと共存可）
   ============================================================ */
(function () {
  'use strict';
  if (window.__edaErrTracker) return;       // bundle版/二重ロード防止
  window.__edaErrTracker = true;

  // 公開情報（pk_live と同様にフロント露出OK）。本番GAS web app。
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ/exec';
  var sent = 0;
  var MAX_SEND = 10;                          // 同セッション最大10回（無限ループ防止）

  function send(payload) {
    if (sent >= MAX_SEND) return;
    sent++;
    var body = {
      type:    payload.type || '',
      message: payload.message || '',
      source:  payload.source || '',
      line:    payload.line || '',
      col:     payload.col || '',
      stack:   payload.stack || '',
      url:     location.href,
      ua:      navigator.userAgent,
      ts:      Date.now()
    };
    try {
      if (window.EDA_API && window.EDA_API.post) {
        window.EDA_API.post('client_error', body).catch(function () {});
      } else {
        // GAS は text/plain で受け取れる（CORS 簡略化）
        fetch(GAS_URL + '?action=client_error', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body)
        }).catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('error', function (e) {
    send({
      type: 'js_error',
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 1500) : ''
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason || {};
    send({
      type: 'promise_rejection',
      message: reason.message || String(e.reason).slice(0, 500),
      stack: reason.stack ? String(reason.stack).slice(0, 1500) : ''
    });
  });
})();
