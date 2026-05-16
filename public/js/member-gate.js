/* ============================================================
   MEMBER GATE — 会員モード判定 + 解錠
   ------------------------------------------------------------
   ・会員 = LINE 連携済 (line_uid あり) または email OTP 認証済
   ・会員モード時: body.is-member クラス付与 → CSS で限定商品の鍵解除
   ・非会員時: body.is-member クラス無し → 鍵オーバーレイ表示

   localStorage key:
   - eda-member-line-uid : LIFF 認証成功時にセットされる LINE UID
   - eda-member-email    : email OTP 認証成功時にセットされる email
   - eda-member-token    : セッショントークン (将来 GAS 検証用)

   グローバル関数 (他ページから呼び出し可):
   - window.unlockMember(uid, name, email)  : 会員ステートにする
   - window.lockMember()                     : 会員ステートを解除
   - window.isMember()                       : 会員かどうか判定 (bool)
   ============================================================ */
(function () {
  'use strict';

  const KEY_UID = 'eda-member-line-uid';
  const KEY_EMAIL = 'eda-member-email';
  const KEY_NAME = 'eda-member-name';
  const KEY_TOKEN = 'eda-member-token';
  const KEY_LINKED_AT = 'eda-member-linked-at';

  /* 会員かどうか判定 */
  function isMember() {
    try {
      const uid = localStorage.getItem(KEY_UID);
      const email = localStorage.getItem(KEY_EMAIL);
      return !!(uid || email);
    } catch (e) {
      return false;
    }
  }

  /* 会員ステートにする */
  function unlockMember(data) {
    data = data || {};
    try {
      if (data.line_uid) localStorage.setItem(KEY_UID, data.line_uid);
      if (data.email)    localStorage.setItem(KEY_EMAIL, data.email);
      if (data.name)     localStorage.setItem(KEY_NAME, data.name);
      if (data.token)    localStorage.setItem(KEY_TOKEN, data.token);
      localStorage.setItem(KEY_LINKED_AT, new Date().toISOString());
    } catch (e) {}
    applyMemberMode(true);
  }

  /* 会員ステートを解除 */
  function lockMember() {
    try {
      localStorage.removeItem(KEY_UID);
      localStorage.removeItem(KEY_EMAIL);
      localStorage.removeItem(KEY_NAME);
      localStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_LINKED_AT);
    } catch (e) {}
    applyMemberMode(false);
  }

  /* body にクラス付与・除去 */
  function applyMemberMode(on) {
    if (on) {
      document.body.classList.add('is-member');
    } else {
      document.body.classList.remove('is-member');
    }
  }

  /* グローバルに公開 */
  window.unlockMember = unlockMember;
  window.lockMember = lockMember;
  window.isMember = isMember;

  /* ページロード時に判定 */
  function init() {
    applyMemberMode(isMember());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* デバッグ用 URL パラメータ (?member=on / off) */
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('member') === 'on') unlockMember({ line_uid: 'DEMO_UID', name: 'デモ会員' });
    if (p.get('member') === 'off') lockMember();
  } catch (e) {}
})();
