/* ============================================================
   江田畜産 — モバイル底部タブバー (DISABLED)
   Tom 指示で削除。既存ページの DOM 残骸を掃除するだけ。
   ============================================================ */
(function () {
  'use strict';
  function cleanup() {
    document.body.classList.remove('has-mobile-tabbar');
    document.querySelectorAll('.eda-mobile-tabbar, .mobile-tabbar').forEach(el => el.remove());
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanup);
  } else {
    cleanup();
  }
})();
