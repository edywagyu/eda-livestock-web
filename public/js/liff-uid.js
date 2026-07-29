/* ============================================================
   LINE内ブラウザ(LIFF)なら line_uid を自動取得して localStorage に保存
   ------------------------------------------------------------
   ・通常ブラウザ / LINE 未ログインでは何もしない (無処理で return)
   ・保存先は checkout.html・shop.html・products.html の内蔵版と同一キー
       eda-mypage-session.line_uid  … マイページ/注文紐付け用
       eda-member-line-uid          … 会員ゲート用の独立キー
   ・analytics.js がこのキーを読んで全イベントに line_uid を添付する
     → カゴ落ちリマインド (CartRecovery.gs) が「誰が離脱したか」を特定できる

   使い方 (LIFF SDK の後ろに置くこと):
     <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
     <script src="public/js/liff-uid.js?v=001" defer></script>
   ============================================================ */
(function () {
  var LIFF_ID = '1657458587-mz1dR9e6';

  function save(p) {
    if (!p || !p.userId) return;
    try {
      var k = 'eda-mypage-session', s = {};
      try { s = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) {}
      if (!s.line_uid) {
        s.line_uid = p.userId;
        s.display_name = p.displayName || '';
        s.picture_url = p.pictureUrl || '';
        localStorage.setItem(k, JSON.stringify(s));
      }
      localStorage.setItem('eda-member-line-uid', p.userId);
    } catch (e) {}
  }

  function init() {
    if (!window.liff) return;
    try {
      liff.init({ liffId: LIFF_ID }).then(function () {
        if (!liff.isInClient() || !liff.isLoggedIn()) return;
        liff.getProfile().then(save).catch(function () {});
      }).catch(function () {});
    } catch (e) {}
  }

  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
