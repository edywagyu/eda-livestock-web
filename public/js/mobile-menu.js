/* ============================================================
   eda-livestock — モバイルメニュー 共通スクリプト
   対象: .primary-nav を持つ全ページ
   挙動:
     - 1024px以下でハンバーガーボタンを nav-utils 末尾に注入
     - クリックで右からドロワーが開く
     - .primary-nav .nav-list の内容を自動コピー + 追加CTA (Shop / 定期便 / LINE)
   ============================================================ */
(function () {
  'use strict';

  function injectStyles() {
    if (document.getElementById('eda-mobile-menu-style')) return;
    const css = `
.eda-mm-burger {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 0;
  width: 44px;
  height: 44px;
  display: none;
  align-items: center;
  justify-content: center;
}
@media (max-width: 1024px) {
  .eda-mm-burger { display: inline-flex; }
}
.eda-mm-root { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }
.eda-mm-root.open { pointer-events: auto; }
.eda-mm-overlay {
  position: absolute; inset: 0;
  background: rgba(6,15,11,0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity .3s ease;
}
.eda-mm-root.open .eda-mm-overlay { opacity: 1; }
.eda-mm-drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(86vw, 340px);
  background: linear-gradient(180deg, #0A1F16 0%, #061410 100%);
  color: #fff;
  transform: translateX(100%);
  transition: transform .35s cubic-bezier(.16,1,.3,1);
  display: flex; flex-direction: column;
  padding: 14px 0;
  box-shadow: -16px 0 40px rgba(0,0,0,0.4);
}
.eda-mm-root.open .eda-mm-drawer { transform: translateX(0); }
.eda-mm-head {
  display:flex; align-items:center; justify-content:space-between;
  padding: 6px 22px 16px;
  border-bottom: 1px solid rgba(212,169,59,0.2);
}
.eda-mm-head strong {
  font-family: 'Cormorant Garamond', serif;
  letter-spacing: 0.22em;
  font-size: 13px;
  color: #D4A93B;
  font-weight: 700;
}
.eda-mm-close {
  background: none; border: none;
  font-size: 26px; line-height: 1; color: inherit; cursor: pointer;
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
}
.eda-mm-nav { display: flex; flex-direction: column; padding: 10px 0; flex: 1; overflow-y: auto; }
.eda-mm-item {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 22px;
  color: #fff;
  text-decoration: none;
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  min-height: 48px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background .18s;
}
.eda-mm-item:hover { background: rgba(212,169,59,0.10); color: #FFE594; }
.eda-mm-item--cta {
  color: #FFE594;
  font-weight: 700;
  background: rgba(212,169,59,0.06);
}
.eda-mm-item--cta:hover { background: rgba(212,169,59,0.18); }
.eda-mm-foot { padding: 14px 22px 6px; border-top: 1px solid rgba(212,169,59,0.2); display: flex; flex-direction: column; gap: 8px; }
.eda-mm-line, .eda-mm-tel {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 12px 18px;
  border-radius: 26px;
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 13.5px;
  font-weight: 700;
  text-decoration: none;
  min-height: 44px;
}
.eda-mm-line { background: #06C755; color: #fff; }
.eda-mm-tel { background: rgba(255,255,255,0.08); color: #FFE594; border: 1px solid rgba(212,169,59,0.4); }
`;
    const style = document.createElement('style');
    style.id = 'eda-mobile-menu-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildDrawer(navList) {
    // .primary-nav のリンクを複製
    const links = Array.from(navList.querySelectorAll('a')).map(a => ({
      href: a.getAttribute('href') || '#',
      text: a.textContent.trim()
    }));

    // ハンバーガーボタン
    const burger = document.createElement('button');
    burger.className = 'eda-mm-burger';
    burger.setAttribute('aria-label', 'メニューを開く');
    burger.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';

    // ドロワー本体
    const root = document.createElement('div');
    root.className = 'eda-mm-root';
    root.setAttribute('aria-hidden', 'true');

    const navHtml = links.map(l => `<a href="${l.href}" class="eda-mm-item">${l.text}</a>`).join('');

    root.innerHTML = `
      <div class="eda-mm-overlay" data-mm-close></div>
      <aside class="eda-mm-drawer" role="dialog" aria-modal="true" aria-label="メニュー">
        <div class="eda-mm-head">
          <strong>MENU</strong>
          <button class="eda-mm-close" data-mm-close aria-label="閉じる">✕</button>
        </div>
        <nav class="eda-mm-nav">
          <a href="shop.html" class="eda-mm-item eda-mm-item--cta">🛒 Online Shop</a>
          <a href="subscription.html" class="eda-mm-item eda-mm-item--cta">⭐ 定期便を申込</a>
          ${navHtml}
        </nav>
        <div class="eda-mm-foot">
          <a href="https://line.me/R/ti/p/@706sgiuq" target="_blank" rel="noopener" class="eda-mm-line">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 5.93 2 10.74c0 4.31 3.82 7.92 8.98 8.61.35.07.82.23.94.52.11.27.07.69.04.96l-.15.93c-.05.28-.22 1.1.96.6 1.18-.5 6.38-3.76 8.71-6.44C23.34 14.02 22 12.51 22 10.74 22 5.93 17.52 2 12 2z"/></svg>
            LINE で質問する
          </a>
          <a href="tel:09047241063" class="eda-mm-tel">
            📞 090-4724-1063
          </a>
        </div>
      </aside>
    `;

    function open() {
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      root.classList.remove('open');
      root.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    burger.addEventListener('click', open);
    root.querySelectorAll('[data-mm-close]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    return { burger, root };
  }

  function init() {
    const nav = document.querySelector('.primary-nav');
    if (!nav) return;
    const navList = nav.querySelector('.nav-list');
    if (!navList) return;
    if (document.querySelector('.eda-mm-root')) return; // 既にある（index.html）

    injectStyles();
    const { burger, root } = buildDrawer(navList);

    // nav-utils の末尾に挿入
    const utils = document.querySelector('.nav-utils');
    if (utils) utils.appendChild(burger);
    else nav.parentElement.appendChild(burger);

    document.body.appendChild(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
