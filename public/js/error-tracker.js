/* ============================================================
   グローバルエラートラッカー (簡易版 Sentry)
   - window.onerror / unhandledrejection を捕捉
   - GAS の /_logs シートに送信 (fire-and-forget)
   ============================================================ */
(function () {
  'use strict';
  let sent = 0;
  const MAX_SEND = 10; // 同セッションで最大10回 (無限ループ防止)

  function send(payload) {
    if (sent >= MAX_SEND) return;
    sent++;
    try {
      if (window.EDA_API) {
        window.EDA_API.post('client_error', {
          ...payload,
          url: location.href,
          ua: navigator.userAgent,
          ts: Date.now()
        }).catch(() => {});
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
    const reason = e.reason || {};
    send({
      type: 'promise_rejection',
      message: reason.message || String(e.reason).slice(0, 500),
      stack: reason.stack ? String(reason.stack).slice(0, 1500) : ''
    });
  });
})();
