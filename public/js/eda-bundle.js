/* ============================================================
   EDA-LIVESTOCK 統合バンドル
   生成元: eda-config.js + error-tracker.js + mobile-menu.js
          + line-float.js + image-lightbox.js + mobile-tabbar.js
          + mobile-nav-hide.js + pdp-link.js
   ============================================================ */

/* ===== eda-config.js ===== */
/* ============================================================
   江田畜産 — 共通フロント設定
   ============================================================
   GAS Web App の URL をここに 1 箇所だけ書きます。
   デプロイ後に下記 GAS_URL を本番値に書き換えてください。
*/
(function (global) {
  'use strict';

  // ↓↓↓ 本番 GAS Web App URL (2026-05-12 デプロイ) ↓↓↓
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbyeq8to-87YAGhCvrOr_4whJehcWZAXchq4tMo4ec-zkIvrlqfhWWtd4J5ZtaV84gs/exec';
  // ↑↑↑ ここまで ↑↑↑

  // localStorage で上書き可能 (ステージング/ローカルで別URL試す用)
  const overridden = (function(){ try { return localStorage.getItem('eda-gas-url') || ''; } catch(e) { return ''; } })();
  const FINAL_URL = overridden || GAS_URL;

  global.EDA_CONFIG = {
    GAS_URL: FINAL_URL,
    // テスター告知用
    isProduction: !FINAL_URL.includes('REPLACE_WITH'),
    // フロント側で Stripe Checkout を直接呼ぶことはない (GAS 経由)
    // ただし Stripe.js を読み込んで Apple Pay などのトークン化に使う場合は publishable key を入れる
    STRIPE_PUBLISHABLE_KEY: 'pk_live_51PNNcrGSkhU1UEciCMf2g2dI6aO2x4uQYqIOqm772au6vGfsS4E2t6sQNsTqK2nqwA6JFznKqMkp2xM06UFvr9rB00l0i8uN3T',
    // LINE 公式 ID
    LINE_AT_ID: '@706sgiuq',
    // LIFF ID (LINE Front-end Framework) ← Tom が LINE Developers Console で発行後ここに記入
    // 形式: 1234567890-AbcdEfgh (アプリ作成後の "LIFF ID")
    LIFF_ID: '',
    // 連絡先
    PHONE: '09047241063',
    EMAIL: 'backoffice@eda-livestock.com'
  };

  // ヘルパー: GAS への fetch を統一
  global.EDA_API = {
    async get(action, params) {
      const url = new URL(FINAL_URL);
      url.searchParams.set('action', action);
      Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      try {
        const res = await fetch(url.toString());
        return await res.json();
      } catch (e) {
        console.error('[EDA_API.get]', action, e);
        return { ok: false, error: e.message };
      }
    },
    async post(action, body) {
      const url = new URL(FINAL_URL);
      url.searchParams.set('action', action);
      try {
        const res = await fetch(url.toString(), {
          method: 'POST',
          // GAS は text/plain で受け取れる (CORS 簡略化のため)
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body || {})
        });
        return await res.json();
      } catch (e) {
        console.error('[EDA_API.post]', action, e);
        return { ok: false, error: e.message };
      }
    }
  };
})(window);

/* ===== error-tracker.js ===== */
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

/* ===== mobile-menu.js ===== */
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

/* ===== line-float.js (REPURPOSED: 電話ボタン) ===== */
/* ============================================================
   江田畜産 — 浮遊「電話はこちら」ボタン (日本国内のみ表示)
   - 国外アクセスでは非表示
   - tel:09047241063 でモバイルから直接発信
   - デスクトップでは番号を可読表示
   ============================================================ */
(function () {
  'use strict';

  /* 日本以外のロケールでは非表示 (簡易判定) */
  function isJapanLocale() {
    try {
      const lang = (navigator.language || '').toLowerCase();
      if (lang.startsWith('ja')) return true;
      /* タイムゾーン判定 (より精度高) */
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (tz === 'Asia/Tokyo') return true;
      /* navigator.languages にも 'ja' 含まれていれば OK */
      const langs = (navigator.languages || []).join(',').toLowerCase();
      if (langs.includes('ja')) return true;
      return false;
    } catch (e) {
      return true; /* 判定失敗時は表示 (default fallback) */
    }
  }

  function init() {
    if (document.querySelector('.eda-floating-phone') || document.querySelector('.floating-phone-btn')) return;
    if (document.querySelector('[data-no-floating-line]')) return;
    if (!isJapanLocale()) return;  /* 海外 IP / 設定では非表示 */

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
  .eda-floating-phone {
    right: 14px; bottom: 14px;
    padding: 0;
    width: 52px; height: 52px;
    border-radius: 50%;
    justify-content: center;
    gap: 0;
  }
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

/* ===== image-lightbox.js ===== */
/* ============================================================
   eda-livestock — 商品画像 Lightbox
   - 対象: .product-card-img / .gift-product-img / data-lightbox 要素
   - クリックで拡大表示, ESC/外側クリックで閉じる
   ============================================================ */
(function () {
  'use strict';

  function init() {
    const css = `
.eda-lightbox-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.92);
  display: none;
  align-items: center; justify-content: center;
  padding: 5vh 5vw;
  cursor: zoom-out;
  animation: edaLightboxFadeIn 0.2s ease-out;
}
.eda-lightbox-overlay.open { display: flex; }
.eda-lightbox-img {
  max-width: 100%; max-height: 90vh;
  object-fit: contain;
  box-shadow: 0 24px 64px rgba(0,0,0,0.7);
  border-radius: 4px;
}
.eda-lightbox-close {
  position: absolute; top: 16px; right: 16px;
  background: rgba(255,255,255,0.1); border: 0;
  color: #fff; font-size: 28px;
  width: 44px; height: 44px;
  border-radius: 50%;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.2s;
}
.eda-lightbox-close:hover { background: rgba(255,255,255,0.2); }
.eda-lightbox-caption {
  position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
  color: rgba(255,255,255,0.9);
  font-size: 13px;
  background: rgba(0,0,0,0.5);
  padding: 8px 16px;
  border-radius: 16px;
  white-space: nowrap;
  max-width: 90vw;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes edaLightboxFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
/* 拡大可能であることを示すカーソル */
.product-card-img, .gift-product-img { cursor: zoom-in; }
`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'eda-lightbox-overlay';
    overlay.innerHTML = '<button class="eda-lightbox-close" aria-label="閉じる">×</button><img class="eda-lightbox-img" alt=""><div class="eda-lightbox-caption"></div>';
    document.body.appendChild(overlay);

    const img = overlay.querySelector('.eda-lightbox-img');
    const caption = overlay.querySelector('.eda-lightbox-caption');

    function open(src, alt) {
      img.src = src;
      img.alt = alt || '';
      caption.textContent = alt || '';
      caption.style.display = alt ? '' : 'none';
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      img.src = '';
    }

    overlay.addEventListener('click', (e) => {
      // 画像クリックは無視, 外側クリックや close ボタンクリックで閉じる
      if (e.target === img) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });

    /* 商品画像クリック → lightbox オープン */
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.product-card-img, .gift-product-img, [data-lightbox]');
      if (!card) return;
      // 背景画像 or <img> から URL を取得
      let src = '';
      let alt = '';
      const innerImg = card.querySelector('img');
      if (innerImg) {
        src = innerImg.currentSrc || innerImg.src;
        alt = innerImg.alt;
      } else {
        // CSS background-image から抽出
        const bg = window.getComputedStyle(card).backgroundImage || '';
        const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
        if (m) src = m[1];
      }
      if (!src) return;
      // 商品名取得 (キャプション用)
      const productCard = card.closest('.product-card, .gift-product-card');
      if (productCard) {
        alt = (productCard.querySelector('.product-name, h3')?.textContent || '').trim();
      }
      e.preventDefault();
      open(src, alt);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ===== mobile-tabbar.js (DISABLED) ===== */
/* Tom 指示で削除。既存ページの DOM・body class クリーンアップだけ実行 */
(function () {
  'use strict';
  function cleanup() {
    document.body.classList.remove('has-mobile-tabbar');
    document.querySelectorAll('.eda-mobile-tabbar, #edaMobileTabbar, .mobile-tabbar').forEach(el => el.remove());
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanup);
  } else {
    cleanup();
  }
})();

/* ===== mobile-nav-hide.js ===== */
/* スクロール方向で .site-header を隠す (モバイルのみ) */
(function () {
  if (window.innerWidth > 720) return;
  const header = document.querySelector('.site-header');
  if (!header) return;
  let lastY = window.scrollY;
  let raf = null;
  window.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      const y = window.scrollY;
      const dy = y - lastY;
      if (Math.abs(dy) > 8) {
        if (dy > 0 && y > 80) header.classList.add('nav-hidden');
        else header.classList.remove('nav-hidden');
        lastY = y;
      }
      raf = null;
    });
  }, { passive: true });
})();

/* ===== pdp-link.js ===== */
/* ============================================================
   Shop の商品カードを PDP (product.html?id=XXX) にリンク
   - 商品名で products-master.js と照合 → productId を取得
   - .product-name をクリック → product.html?id={productId}
   - data-pdp-href 属性で各カードに URL を付与
   ============================================================ */
(function () {
  'use strict';

  /* 名前を正規化（空白・括弧内・全半角の差を吸収） */
  function norm(s) {
    return (s || '')
      .replace(/\s+/g, '')
      .replace(/[()（）]/g, '')
      .replace(/\d+g/gi, '')
      .toLowerCase()
      .trim();
  }

  function init() {
    if (!window.EDA_PRODUCTS_MASTER) {
      setTimeout(init, 200);
      return;
    }
    const products = window.EDA_PRODUCTS_MASTER.products || [];

    document.querySelectorAll('.product-card').forEach(card => {
      const nameEl = card.querySelector('.product-name');
      if (!nameEl) return;
      const name = nameEl.textContent.trim();
      const nNorm = norm(name);

      let match = products.find(p => p.name === name);
      if (!match) {
        match = products.find(p => norm(p.name) === nNorm);
      }
      if (!match) {
        match = products.find(p => norm(p.name).startsWith(nNorm) || nNorm.startsWith(norm(p.name)));
      }
      if (!match) return;

      const href = 'product.html?id=' + encodeURIComponent(match.productId);
      card.setAttribute('data-pdp-href', href);
      card.style.cursor = 'pointer';

      /* タイトル + 画像エリアをクリック → PDP 遷移 */
      /* ボタン・select はそのまま動作 */
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, select, input, a, .btn-add-cart, .variant-select')) return;
        location.href = href;
      });

      nameEl.style.cursor = 'pointer';
      nameEl.style.textDecoration = 'underline';
      nameEl.style.textDecorationThickness = '1px';
      nameEl.style.textUnderlineOffset = '4px';
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        location.href = href;
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* ===== sw-register.js ===== */
/* Service Worker 登録 + Reveal IntersectionObserver (unobserve 対応) */
(function () {
  'use strict';
  /* === Service Worker 登録 === */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  /* === .reveal クラスを IntersectionObserver で表示し unobserve で解放 === */
  function initReveal() {
    const els = document.querySelectorAll('.reveal:not(.is-visible)');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target); /* メモリ解放 */
        }
      });
    }, { rootMargin: '0px 0px -80px 0px', threshold: 0.05 });
    els.forEach(el => io.observe(el));
  }

  /* === ビューポート外の装飾アニメを停止 === */
  function initOffscreenPause() {
    const els = document.querySelectorAll('.animate-paused-when-offscreen');
    if (!els.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('in-view', entry.isIntersecting);
      });
    }, { rootMargin: '50px' });
    els.forEach(el => io.observe(el));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { initReveal(); initOffscreenPause(); });
  } else {
    initReveal(); initOffscreenPause();
  }
})();
