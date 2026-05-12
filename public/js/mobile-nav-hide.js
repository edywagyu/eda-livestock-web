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
