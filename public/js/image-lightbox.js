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
