/* ============================================================
   eda-livestock — 浮遊LINE質問ボタン 共通スクリプト
   - 対象: 全顧客向けページ (shop / subscription / checkout
            以外で .floating-phone-btn を既に持つページはスキップ)
   - 効果: 右下に LINE@706sgiuq への直リンクを配置
   ============================================================ */
(function () {
  'use strict';

  function init() {
    // 既に専用LINE/電話ボタンを持つページはスキップ
    if (document.querySelector('.eda-floating-line') || document.querySelector('.floating-phone-btn')) return;
    if (document.querySelector('[data-no-floating-line]')) return;

    const css = `
.eda-floating-line {
  position: fixed; right: 16px; bottom: 16px; z-index: 92;
  display: inline-flex; align-items: center; gap: 10px;
  padding: 10px 16px 10px 12px;
  background: linear-gradient(135deg, #06C755 0%, #0AB04C 100%);
  color: #fff; border-radius: 32px;
  border: 1.5px solid rgba(255,255,255,0.4);
  box-shadow: 0 8px 24px rgba(6,199,85,0.35), 0 2px 8px rgba(0,0,0,0.1);
  text-decoration: none;
  transition: all 0.3s cubic-bezier(.16,1,.3,1);
  font-family: 'Noto Sans JP', sans-serif;
}
.eda-floating-line:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(6,199,85,0.5); }
.eda-floating-line-icon {
  width: 36px; height: 36px; border-radius: 50%;
  background: #fff; color: #06C755;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.eda-floating-line-text { display: flex; flex-direction: column; line-height: 1.2; }
.eda-floating-line-text strong { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
.eda-floating-line-text small { font-size: 10px; color: rgba(255,255,255,0.85); margin-top: 2px; }
@media (max-width: 720px) {
  .eda-floating-line { right: 12px; bottom: 12px; padding: 8px 14px 8px 10px; gap: 8px; }
  .eda-floating-line-icon { width: 32px; height: 32px; }
  .eda-floating-line-text strong { font-size: 11.5px; }
  .eda-floating-line-text small { font-size: 9px; }
  /* sticky-cart-bar が出ているときは LINE ボタンを上に持ち上げる (衝突回避) */
  body.has-sticky-cart .eda-floating-line { bottom: 84px; }
}`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const a = document.createElement('a');
    a.href = 'https://line.me/R/ti/p/@706sgiuq';
    a.target = '_blank';
    a.rel = 'noopener';
    a.className = 'eda-floating-line';
    a.setAttribute('aria-label', 'LINE で江田畜産に質問');
    a.innerHTML = `
      <span class="eda-floating-line-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 5.93 2 10.74c0 4.31 3.82 7.92 8.98 8.61.35.07.82.23.94.52.11.27.07.69.04.96l-.15.93c-.05.28-.22 1.1.96.6 1.18-.5 6.38-3.76 8.71-6.44C23.34 14.02 22 12.51 22 10.74 22 5.93 17.52 2 12 2z"/>
        </svg>
      </span>
      <span class="eda-floating-line-text">
        <strong>LINE で質問</strong>
        <small>江田畜産公式 / 平日9-18時 返信</small>
      </span>`;
    document.body.appendChild(a);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
