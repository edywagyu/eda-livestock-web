/* ============================================================
   江田畜産 軽量アクセス解析 (GA4 代替・自前)
   ------------------------------------------------------------
   ・page_view を自動送信 (ロード時)
   ・カート追加 / 決済開始 / 購入完了 等を window.edaAnalytics で送信可能
   ・session_id は localStorage で 30 分非活性後にローテーション

   GAS endpoint: POST ?action=log_event
   ============================================================ */

(function() {
  'use strict';

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbzZ6h0ggkCSqccyO3HQfye4ZE7QLXsDqzb6slF-uKIHKWr4yNTIgV7-QqOa7TujPG1i/exec';
  const SESSION_KEY = 'eda-sess';
  const LAST_ACTIVE_KEY = 'eda-sess-last';
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 分

  function genId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getSessionId() {
    try {
      const last = parseInt(localStorage.getItem(LAST_ACTIVE_KEY) || '0');
      const now = Date.now();
      let sid = localStorage.getItem(SESSION_KEY);
      if (!sid || (now - last) > SESSION_TIMEOUT_MS) {
        sid = genId();
        localStorage.setItem(SESSION_KEY, sid);
      }
      localStorage.setItem(LAST_ACTIVE_KEY, String(now));
      return sid;
    } catch (e) {
      return genId();
    }
  }

  function send(event_type, props) {
    if (!GAS_URL) return;
    const payload = Object.assign({
      event_type: event_type,
      session_id: getSessionId(),
      page: location.pathname,
      referrer: document.referrer || '',
      ua: navigator.userAgent.slice(0, 200)
    }, props || {});

    /* fire and forget — UX に影響しないよう非同期 */
    try {
      const body = JSON.stringify(payload);
      /* navigator.sendBeacon は タブ閉じる直前でも届く / GAS は text/plain 必須 */
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'text/plain' });
        navigator.sendBeacon(GAS_URL + '?action=log_event', blob);
      } else {
        fetch(GAS_URL + '?action=log_event', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: body,
          keepalive: true
        }).catch(() => {});
      }
    } catch (e) {}
  }

  /* グローバル API */
  window.edaAnalytics = {
    track: send,
    /* よく使うイベント用ショートカット */
    pageView: function() { send('page_view', {}); },
    viewItem: function(productId, value) { send('view_item', { product_id: productId, value: value }); },
    addToCart: function(productId, value, meta) { send('add_to_cart', { product_id: productId, value: value, meta: meta }); },
    removeFromCart: function(productId, value) { send('remove_from_cart', { product_id: productId, value: value }); },
    viewCart: function(value) { send('view_cart', { value: value }); },
    beginCheckout: function(value, meta) { send('begin_checkout', { value: value, meta: meta }); },
    lineClick: function() { send('line_click', {}); },
    quizStart: function() { send('quiz_start', {}); },
    quizComplete: function(meta) { send('quiz_complete', { meta: meta }); }
  };

  /* 自動: ページロード時に page_view 送信 */
  function autoFire() {
    window.edaAnalytics.pageView();

    /* LINE 友だち追加リンクのクリック自動計測 */
    document.addEventListener('click', function(e) {
      const a = e.target && e.target.closest && e.target.closest('a[href*="line.me"]');
      if (a) {
        window.edaAnalytics.lineClick();
      }
    }, true);

    /* 予約リンク (calendar.app.google) クリック計測
       data-b2b-cta 属性 or href マッチで自動検出 → どのページ/位置から流入したか分かる */
    document.addEventListener('click', function(e) {
      const a = e.target && e.target.closest && e.target.closest('a[href*="calendar.app.google"]');
      if (!a) return;
      const source = a.dataset.b2bCta || a.getAttribute('aria-label') || a.textContent.trim().slice(0, 50) || 'unknown';
      send('booking_click', {
        source: source,
        page: location.pathname,
        referrer: document.referrer || ''
      });
    }, true);

    /* WhatsApp リンクも計測 */
    document.addEventListener('click', function(e) {
      const a = e.target && e.target.closest && e.target.closest('a[href*="wa.me"]');
      if (a) { send('whatsapp_click', { page: location.pathname }); }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFire);
  } else {
    autoFire();
  }
})();
