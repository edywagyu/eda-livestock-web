/* ============================================================
   江田畜産 — 日本国内限定アクセス (geo-block)
   - 対象: shop.html / subscription.html
   - 仕組み: ipapi.co の無料 API で国コード判定 (1日 1000リクエスト無料)
   - 日本以外: 海外専用ページへリダイレクト (global.html)
   ============================================================ */
(function () {
  'use strict';

  // 開発者用: ?bypass=tom で国チェックをバイパス
  if (location.search.includes('bypass=tom')) {
    localStorage.setItem('eda-geo-bypass', '1');
  }
  if (localStorage.getItem('eda-geo-bypass') === '1') return;

  // セッション内で1回確認すれば OK
  const cached = sessionStorage.getItem('eda-geo-country');
  if (cached === 'JP') return;     // 日本なので通過
  if (cached && cached !== 'JP') { redirectToGlobal(); return; }

  function redirectToGlobal() {
    // 既に global.html にいる場合はスキップ (ループ防止)
    if (location.pathname.endsWith('global.html')) return;
    location.href = 'global.html?reason=geo';
  }

  /* ipapi.co (無料・無認証) で国判定 */
  fetch('https://ipapi.co/country/')
    .then(res => res.text())
    .then(country => {
      country = (country || '').trim().toUpperCase();
      if (!country || country.length !== 2) {
        // 取得失敗時は通過させる (フェイルセーフ)
        sessionStorage.setItem('eda-geo-country', 'UNKNOWN');
        return;
      }
      sessionStorage.setItem('eda-geo-country', country);
      if (country !== 'JP') redirectToGlobal();
    })
    .catch(() => {
      // 通信エラーは通過 (フェイルセーフ)
      sessionStorage.setItem('eda-geo-country', 'ERR');
    });
})();
