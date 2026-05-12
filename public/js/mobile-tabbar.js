/* ============================================================
   江田畜産 — モバイル底部タブバー
   - Apple / Instagram / NIKE パターン
   - 5 タブ: Home / Shop / Cart / 定期便 / マイページ
   - スクロールダウンで隠す, アップで再表示
   - カートバッジ自動更新
   ============================================================ */
(function () {
  'use strict';

  // checkout / order-complete / 404 / staff など UI 集中するページは除外
  const SKIP_PATHS = ['/checkout.html', '/order-complete.html', '/404.html', '/staff.html', '/dashboard.html', '/test-checkout.html'];
  const path = location.pathname;
  if (SKIP_PATHS.some(p => path.endsWith(p))) return;

  function init() {
    // 既に追加されている場合 skip
    if (document.querySelector('.eda-mobile-tabbar')) return;

    // 現在のパスから active を判定
    const isActive = (file) => {
      const cleanPath = path.replace(/\/$/, '') || '/index.html';
      return cleanPath.endsWith(file);
    };

    const tabs = [
      {
        href: 'index.html',
        label: 'ホーム',
        active: isActive('/index.html') || path === '/' || path.endsWith('/'),
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12L12 4l9 8"/><path d="M5 10v10h14V10"/></svg>'
      },
      {
        href: 'shop.html',
        label: 'Shop',
        active: isActive('/shop.html'),
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M3 4h2l2.7 12.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.5L22 8H6"/></svg>'
      },
      {
        href: 'subscription.html',
        label: '定期便',
        active: isActive('/subscription.html'),
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4M16 3v4"/></svg>'
      },
      {
        href: 'shop.html?openCart=1',
        label: 'カート',
        active: false,
        isCart: true,
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>'
      },
      {
        href: 'mypage.html',
        label: 'マイページ',
        active: isActive('/mypage.html'),
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>'
      }
    ];

    const html = `
      <nav class="eda-mobile-tabbar" id="edaMobileTabbar" aria-label="モバイルメインナビ">
        <div class="eda-mobile-tabbar-inner">
          ${tabs.map(t => `
            <a href="${t.href}" class="eda-mobile-tab ${t.active ? 'active' : ''}" ${t.isCart ? 'data-cart-tab' : ''}>
              ${t.icon}
              <span>${t.label}</span>
              ${t.isCart ? '<span class="eda-mobile-tab-badge" id="edaTabCartBadge">0</span>' : ''}
            </a>
          `).join('')}
        </div>
      </nav>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.body.classList.add('has-mobile-tabbar');

    /* スクロール方向で表示・非表示 */
    const tabbar = document.getElementById('edaMobileTabbar');
    let lastY = window.scrollY;
    let raf = null;
    window.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        const dy = y - lastY;
        if (Math.abs(dy) > 6) {
          if (dy > 0 && y > 100) {
            tabbar.classList.add('hide');
          } else {
            tabbar.classList.remove('hide');
          }
          lastY = y;
        }
        raf = null;
      });
    }, { passive: true });

    /* カートバッジ自動更新 (localStorage監視) */
    const badgeEl = document.getElementById('edaTabCartBadge');
    function updateCartBadge() {
      try {
        const cart = JSON.parse(localStorage.getItem('eda-cart') || '[]');
        const total = cart.reduce((s, i) => s + (i.qty || 1), 0);
        if (badgeEl) {
          badgeEl.textContent = total;
          badgeEl.classList.toggle('show', total > 0);
        }
      } catch (e) {}
    }
    updateCartBadge();
    window.addEventListener('storage', updateCartBadge);
    setInterval(updateCartBadge, 2000);

    /* ?openCart=1 で着地したら shop のカートをすぐ開く */
    if (path.endsWith('shop.html') && location.search.includes('openCart=1')) {
      setTimeout(() => {
        const btn = document.getElementById('cartBtn') || document.querySelector('.nav-cart');
        if (btn) btn.click();
      }, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
