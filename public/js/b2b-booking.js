/* ============================================================
   B2B Booking Funnel — 企業向け予約導線統合スクリプト
   ============================================================
   対象ページ: global / restaurants / about / press / journal / journal-1
              buyer-deck (en/jp/it/es) / sales-deck
   消費者向け (shop / subscription / products / index) には適用しない

   機能:
   - スティッキー下部バー: スクロール 400px 以降に表示
   - Exit-intent モーダル: マウスが画面外に出る瞬間に表示 (1回限り)
   - モバイル: 上方向スクロール検知時に発火
   - ロケール対応: data-lang or html[lang] で言語切替

   配置: 各HTMLの </body> 直前で <script src="public/js/b2b-booking.js" defer></script>
   ============================================================ */

(function () {
  'use strict';

  const BOOK_URL = 'https://calendar.app.google/DjKHsVDhJHesaPM27';

  // ロケール判定
  const lang = (document.documentElement.lang || 'ja').toLowerCase();
  const isJa = /^ja/.test(lang);
  const isIt = /^it/.test(lang);
  const isEs = /^es/.test(lang);

  const T = {
    sticky_label:
      isIt ? 'Prenota una chiamata di 30 min con Tomoki Eda'
      : isEs ? 'Reserva una llamada de 30 min con Tomoki Eda'
      : isJa ? 'Tomoki Eda と 30分商談する'
      : 'Book a 30-min call with Tomoki Eda',
    sticky_button:
      isIt || isEs ? 'Prenota →' : isJa ? '予約 →' : 'Book →',
    sticky_sub:
      isIt ? 'JST 6-24 · 3 giorni di anticipo'
      : isEs ? 'JST 6-24 · 3 días de anticipación'
      : isJa ? 'JST 6-24時 · 3日先以降 · 1時間'
      : 'JST 6-24h · 3 days ahead · 1 hour',
    exit_title:
      isIt ? 'Prima di andare via…'
      : isEs ? 'Antes de irte…'
      : isJa ? 'お時間ありがとうございます'
      : 'Before you go…',
    exit_body:
      isIt ? 'Una breve chiamata di 30 min può rispondere a domande su prezzi, MOQ e logistica.'
      : isEs ? 'Una llamada rápida de 30 min puede aclarar precios, MOQ y logística.'
      : isJa ? '30分のオンライン商談で、卸価格・MOQ・配送条件をその場で確認できます。'
      : 'A 30-min online call answers pricing, MOQ, and shipping in one go.',
    exit_cta:
      isIt ? 'Prenota ora' : isEs ? 'Reservar ahora' : isJa ? '今すぐ予約する' : 'Book now',
    exit_dismiss:
      isIt ? 'Più tardi' : isEs ? 'Quizás más tarde' : isJa ? 'あとで' : 'Maybe later',
    your_tz: (function() {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offset = -(new Date().getTimezoneOffset() / 60);
        const offsetStr = (offset >= 0 ? '+' : '') + offset;
        return tz + ' (UTC' + offsetStr + ')';
      } catch (e) { return ''; }
    })()
  };

  /* ============ Styles ============ */
  function injectStyles() {
    if (document.getElementById('b2b-booking-style')) return;
    const css = `
.b2b-sticky-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: rgba(15,61,46,0.96);
  backdrop-filter: saturate(180%) blur(14px);
  -webkit-backdrop-filter: saturate(180%) blur(14px);
  color: white;
  padding: 12px max(16px, env(safe-area-inset-left)) calc(12px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-right));
  z-index: 80;
  transform: translateY(120%);
  transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 -10px 30px rgba(0,0,0,0.22);
  border-top: 1px solid rgba(212,169,59,0.32);
}
.b2b-sticky-bar.is-visible { transform: translateY(0); }
.b2b-sticky-bar-inner {
  max-width: 1200px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px;
}
.b2b-sticky-bar-text {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0; flex: 1;
}
.b2b-sticky-bar-text strong {
  font-size: 14px; font-weight: 700;
  color: white; letter-spacing: 0.02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.b2b-sticky-bar-text small {
  font-size: 11px;
  color: rgba(255, 229, 148, 0.72);
  letter-spacing: 0.04em;
}
.b2b-sticky-bar-btn {
  background: var(--color-gold, #D4A93B);
  color: #0A2D21;
  text-decoration: none;
  padding: 13px 22px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  transition: background 0.25s, transform 0.25s;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.b2b-sticky-bar-btn:hover { background: #FFE594; transform: translateY(-1px); }
.b2b-sticky-close {
  background: none;
  border: 1px solid rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.62);
  width: 32px; height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px;
  transition: background 0.2s, color 0.2s;
  flex-shrink: 0;
}
.b2b-sticky-close:hover { background: rgba(255,255,255,0.08); color: white; }
@media (max-width: 600px) {
  .b2b-sticky-bar-text small { display: none; }
  .b2b-sticky-bar-btn { padding: 11px 16px; font-size: 13px; }
  .b2b-sticky-close { width: 28px; height: 28px; font-size: 12px; }
}

.b2b-exit-modal-bg {
  position: fixed; inset: 0;
  background: rgba(6,15,11,0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 9990;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.b2b-exit-modal-bg.is-open { opacity: 1; pointer-events: auto; }
.b2b-exit-modal {
  background: linear-gradient(180deg, #0F3D2E 0%, #0A2D21 100%);
  color: white;
  border-radius: 20px;
  max-width: 480px; width: 100%;
  padding: 44px 36px 36px;
  position: relative;
  transform: scale(0.92);
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid rgba(212,169,59,0.32);
  box-shadow: 0 32px 80px rgba(0,0,0,0.48);
  text-align: center;
}
.b2b-exit-modal-bg.is-open .b2b-exit-modal { transform: scale(1); }
.b2b-exit-modal-close {
  position: absolute; top: 14px; right: 14px;
  width: 32px; height: 32px;
  background: rgba(255,255,255,0.08);
  border: none; border-radius: 50%;
  color: white;
  cursor: pointer;
  font-size: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.2s;
}
.b2b-exit-modal-close:hover { background: rgba(255,255,255,0.16); }
.b2b-exit-modal-icon {
  font-size: 44px;
  margin-bottom: 18px;
}
.b2b-exit-modal h3 {
  font-family: 'Cormorant Garamond', 'Shippori Mincho', serif;
  font-size: 28px;
  margin: 0 0 14px;
  color: #FFE594;
  font-weight: 500;
  line-height: 1.2;
}
.b2b-exit-modal p {
  font-size: 14px;
  line-height: 1.75;
  color: rgba(255,255,255,0.82);
  margin: 0 0 28px;
}
.b2b-exit-modal-cta {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--color-gold, #D4A93B);
  color: #0A2D21;
  padding: 16px 32px;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.04em;
  transition: background 0.25s, transform 0.25s;
}
.b2b-exit-modal-cta:hover { background: #FFE594; transform: translateY(-2px); }
.b2b-exit-modal-dismiss {
  display: block; width: 100%;
  background: none; border: none;
  color: rgba(255,255,255,0.5);
  font-size: 12px; letter-spacing: 0.04em;
  cursor: pointer;
  margin-top: 16px;
  padding: 8px;
}
.b2b-exit-modal-dismiss:hover { color: white; }
.b2b-exit-tz {
  display: block;
  font-size: 11px;
  color: rgba(255,229,148,0.62);
  margin-top: 14px;
  letter-spacing: 0.04em;
}
`;
    const style = document.createElement('style');
    style.id = 'b2b-booking-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ============ Sticky Bar ============ */
  function injectStickyBar() {
    if (document.querySelector('.b2b-sticky-bar')) return;
    if (sessionStorage.getItem('b2b-sticky-closed') === '1') return;
    const bar = document.createElement('div');
    bar.className = 'b2b-sticky-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'B2B booking shortcut');
    bar.innerHTML = `
      <div class="b2b-sticky-bar-inner">
        <div class="b2b-sticky-bar-text">
          <strong>${T.sticky_label}</strong>
          <small>${T.sticky_sub}</small>
        </div>
        <a href="${BOOK_URL}" target="_blank" rel="noopener" class="b2b-sticky-bar-btn">${T.sticky_button}</a>
        <button type="button" class="b2b-sticky-close" aria-label="閉じる / Close">✕</button>
      </div>
    `;
    document.body.appendChild(bar);
    bar.querySelector('.b2b-sticky-close').addEventListener('click', () => {
      bar.classList.remove('is-visible');
      sessionStorage.setItem('b2b-sticky-closed', '1');
    });

    let ticking = false;
    function update() {
      ticking = false;
      const y = window.pageYOffset || document.documentElement.scrollTop;
      // 400px 以上スクロール + ページ下端まで100px以内では非表示 (footer干渉防止)
      const docH = document.documentElement.scrollHeight;
      const winH = window.innerHeight;
      const nearBottom = (docH - y - winH) < 100;
      bar.classList.toggle('is-visible', y > 400 && !nearBottom);
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
  }

  /* ============ Exit-intent Modal ============ */
  function injectExitModal() {
    if (sessionStorage.getItem('b2b-exit-shown') === '1') return;
    const bg = document.createElement('div');
    bg.className = 'b2b-exit-modal-bg';
    bg.innerHTML = `
      <div class="b2b-exit-modal" role="dialog" aria-modal="true">
        <button class="b2b-exit-modal-close" aria-label="閉じる / Close">✕</button>
        <div class="b2b-exit-modal-icon" aria-hidden="true">📅</div>
        <h3>${T.exit_title}</h3>
        <p>${T.exit_body}</p>
        <a href="${BOOK_URL}" target="_blank" rel="noopener" class="b2b-exit-modal-cta">
          ${T.exit_cta} <span aria-hidden="true">→</span>
        </a>
        ${T.your_tz ? `<small class="b2b-exit-tz">Your timezone: ${T.your_tz}</small>` : ''}
        <button class="b2b-exit-modal-dismiss">${T.exit_dismiss}</button>
      </div>
    `;
    document.body.appendChild(bg);

    function open() {
      if (sessionStorage.getItem('b2b-exit-shown') === '1') return;
      bg.classList.add('is-open');
      sessionStorage.setItem('b2b-exit-shown', '1');
    }
    function close() { bg.classList.remove('is-open'); }
    bg.querySelector('.b2b-exit-modal-close').addEventListener('click', close);
    bg.querySelector('.b2b-exit-modal-dismiss').addEventListener('click', close);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // デスクトップ: マウスが画面上端外に出た瞬間
    let detached = false;
    function onMouseOut(e) {
      if (detached) return;
      if (e.clientY <= 0 && !e.relatedTarget) {
        // スクロール 500px 以上 進んでいる時のみ
        const y = window.pageYOffset || document.documentElement.scrollTop;
        if (y > 500) { open(); detached = true; document.removeEventListener('mouseout', onMouseOut); }
      }
    }
    document.addEventListener('mouseout', onMouseOut);

    // モバイル: 早すぎる上方向スクロール検知 (戻ろうとしている)
    let lastY = window.pageYOffset || 0;
    let lastT = Date.now();
    function onScroll() {
      if (detached) return;
      const y = window.pageYOffset || document.documentElement.scrollTop;
      const t = Date.now();
      const dy = y - lastY;
      const dt = t - lastT;
      // ページ下端から離れる方向に 80px/100ms 以上 = 帰ろうとしている
      if (dy < -80 && dt < 200 && y < 200 && lastY > 600) {
        open(); detached = true;
        window.removeEventListener('scroll', onScroll);
      }
      lastY = y; lastT = t;
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // 60秒滞在で表示しないユーザーには promptive モーダル (穏やか)
    setTimeout(() => {
      if (!detached && (window.pageYOffset || 0) > 1500) {
        open();
      }
    }, 60000);
  }

  /* ============ Boot ============ */
  function boot() {
    injectStyles();
    injectStickyBar();
    injectExitModal();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
