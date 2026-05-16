/* ============================================================
   江田畜産 — 浮遊「電話はこちら」ボタン (日本国内のみ表示)
   - tel:09047241063 でモバイルから直接発信
   - 国外アクセスでは非表示
   ============================================================ */
(function () {
  'use strict';

  function isJapanLocale() {
    try {
      const lang = (navigator.language || '').toLowerCase();
      if (lang.startsWith('ja')) return true;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (tz === 'Asia/Tokyo') return true;
      const langs = (navigator.languages || []).join(',').toLowerCase();
      if (langs.includes('ja')) return true;
      return false;
    } catch (e) { return true; }
  }

  function init() {
    if (document.querySelector('.eda-floating-phone') || document.querySelector('.floating-phone-btn')) return;
    if (document.querySelector('[data-no-floating-line]')) return;
    if (!isJapanLocale()) return;

    const css = `
.eda-floating-phone {
  position: fixed; right: 16px; bottom: 16px; z-index: 92;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 18px 10px 12px;
  background: linear-gradient(135deg, #0F3D2E 0%, #0A2D21 100%);
  color: #fff; border-radius: 32px;
  border: 1.5px solid rgba(212,169,59,0.5);
  box-shadow: 0 8px 24px rgba(15,61,46,0.35), 0 2px 8px rgba(0,0,0,0.12);
  text-decoration: none;
  transition: all 0.3s cubic-bezier(.16,1,.3,1);
  font-family: 'Hiragino Kaku Gothic ProN', system-ui, sans-serif;
}
.eda-floating-phone:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(15,61,46,0.45); }
.eda-floating-phone-icon {
  width: 36px; height: 36px; border-radius: 50%;
  background: #D4A93B; color: #0A2D21;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.eda-floating-phone-text { display: flex; flex-direction: column; line-height: 1.2; }
.eda-floating-phone-text strong { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: #D4A93B; }
.eda-floating-phone-text .num { font-size: 14px; font-weight: 700; letter-spacing: 0.02em; margin-top: 2px; font-family: 'Inter', sans-serif; }
@media (max-width: 720px) {
  .eda-floating-phone { right: 14px; bottom: 14px; padding: 0; width: 52px; height: 52px; border-radius: 50%; justify-content: center; gap: 0; }
  .eda-floating-phone-icon { width: 52px; height: 52px; background: transparent; color: #D4A93B; }
  .eda-floating-phone-icon svg { width: 26px; height: 26px; }
  .eda-floating-phone-text { display: none; }
  body.has-sticky-cart .eda-floating-phone { bottom: 84px; }
}`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const a = document.createElement('a');
    a.href = 'tel:09047241063';
    a.className = 'eda-floating-phone';
    a.setAttribute('aria-label', '電話で江田畜産に問い合わせ 090-4724-1063');
    a.innerHTML = `
      <span class="eda-floating-phone-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </span>
      <span class="eda-floating-phone-text">
        <strong>電話はこちら</strong>
        <span class="num">090-4724-1063</span>
      </span>`;
    document.body.appendChild(a);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
