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

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';
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

  /* LINE 連携済みなら line_uid を返す (LINE内ブラウザ = LIFF で public/js/liff-uid.js が保存)。
     通常ブラウザ・未連携は空文字。 */
  function getLineUid() {
    try {
      const raw = localStorage.getItem('eda-mypage-session');
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.line_uid) return s.line_uid;
      }
      return localStorage.getItem('eda-member-line-uid') || '';
    } catch (e) {
      return '';
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

    /* 全イベントに line_uid を自動添付。カゴ落ちリマインド (CartRecovery.gs) が
       「カートに入れて離脱したのが誰か」を特定するために使う。未連携なら付けない。 */
    const uid = getLineUid();
    if (uid) payload.meta = Object.assign({}, payload.meta || {}, { line_uid: uid });

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
    /* 現在のセッションID。読み取り専用（最終アクティブ時刻を更新しない＝
       これを呼んでもセッションが延命されない）。cart-holds.js / checkout.html が
       「自分のカート確保」を識別するために使う。 */
    sessionId: function() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (e) { return ''; } },
    /* よく使うイベント用ショートカット */
    pageView: function() { send('page_view', {}); },
    viewItem: function(productId, value, meta) { send('view_item', { product_id: productId, value: value, meta: meta }); },
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

    /* src 付き流入の計測 (2026-07-27)
       リッチメニュー等のリンクに ?src=richmenu&l=A を付けると、遷移先の
       このページで src_click を記録。誰が(連携済uid)・いつ(曜日/時刻)・
       どのメニューから来たかが分かる。LIFF リンクを壊さずに計測できる
       (c.html を挟まないので liff.line.me の自動ログイン/会員価格は無事)。*/
    try {
      var _p = new URLSearchParams(location.search);
      var _src = _p.get('src');
      if (_src) {
        var _now = new Date();
        send('src_click', {
          product_id: _p.get('l') || '',   // ボタン名(A..F 等)を product_id 列へ
          meta: {
            src: _src,                      // 例 richmenu
            l: _p.get('l') || '',
            dow: _now.getDay(),             // 0=日 … 6=土 (JST)
            hour: _now.getHours()          // 0-23
          }
        });
        /* 「誰が」は send() が meta.line_uid を全イベントに自動添付する（getLineUid）。
           ここで自前に持たない。旧実装は localStorage の 'eda-line-uid' を読んでいたが、
           liff-uid.js が実際に書くキーは 'eda-member-line-uid' で、常に空だった。 */
      }
    } catch (e) {}

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
