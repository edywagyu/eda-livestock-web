/* ============================================================
   江田畜産 — 共通フロント設定
   ============================================================
   GAS Web App の URL をここに 1 箇所だけ書きます。
   デプロイ後に下記 GAS_URL を本番値に書き換えてください。
*/
(function (global) {
  'use strict';

  // ↓↓↓ 本番 GAS Web App URL ↓↓↓
  // 2026-09-10: サイトが使う窓口を1本に統一（旧 AKfycbxFfdz… は廃止予定・キャッシュ対策で当面は生かす）
  const GAS_URL_PROD = 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';
  // ↓↓↓ テスト用 GAS Web App URL (未設定なら本番と同じ URL に test_mode=1 を付与) ↓↓↓
  const GAS_URL_TEST = ''; // ステージング GAS をデプロイしたらここに記入
  // ↑↑↑ ここまで ↑↑↑

  // 環境判定: localhost / 127.0.0.1 / *.local / ?test=1 はテスト扱い
  const host = location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || /\.local$/.test(host) || host === '';
  const hasTestFlag = /[?&]test=1\b/.test(location.search);
  const IS_TEST_MODE = isLocalHost || hasTestFlag;

  // localStorage で上書き可能 (ステージング/ローカルで別URL試す用)
  const overridden = (function(){ try { return localStorage.getItem('eda-gas-url') || ''; } catch(e) { return ''; } })();
  const FINAL_URL = overridden || (IS_TEST_MODE && GAS_URL_TEST) || GAS_URL_PROD;

  global.EDA_CONFIG = {
    GAS_URL: FINAL_URL,
    // 環境フラグ — checkout.html などで判定に使う
    IS_TEST_MODE: IS_TEST_MODE,
    isProduction: !IS_TEST_MODE && !FINAL_URL.includes('REPLACE_WITH'),
    // Stripe Publishable Key — テストモードでは test キー、本番では live キー
    STRIPE_PUBLISHABLE_KEY: IS_TEST_MODE
      ? 'pk_test_51PNNcrGSkhU1UEciONG62JlidnBESgU9gf4HTzBiyghpzP8n8gXZ5jr43soudYFg44lAL8qyucBjcsoM2j71t4iK001JsVsKqz' // test publishable key (Tom 発行 2026-05-30)
      : 'pk_live_51PNNcrGSkhU1UEciCMf2g2dI6aO2x4uQYqIOqm772au6vGfsS4E2t6sQNsTqK2nqwA6JFznKqMkp2xM06UFvr9rB00l0i8uN3T',
    // テストキー未設定の検知用フラグ
    STRIPE_TEST_KEY_MISSING: IS_TEST_MODE && true, // 後段で警告表示に使う
    // LINE 公式 ID
    LINE_AT_ID: '@706sgiuq',
    // LIFF ID (LINE Front-end Framework) ← Tom が LINE Developers Console で発行後ここに記入
    // 形式: 1234567890-AbcdEfgh (アプリ作成後の "LIFF ID")
    LIFF_ID: '1657458587-mz1dR9e6',
    // 連絡先
    PHONE: '09047241063',
    EMAIL: 'backoffice@eda-livestock.com'
  };

  // テストモード時はコンソールに目立つ警告
  if (IS_TEST_MODE) {
    console.warn('%c⚠️ EDA TEST MODE — Stripe は test キー / 実購入は発生しません', 'background:#ffd166;color:#664d03;padding:4px 8px;font-weight:bold;border-radius:4px');
    // テストキー未差替時の明示エラー
    if (global.EDA_CONFIG.STRIPE_PUBLISHABLE_KEY === 'pk_test_TESTKEY_REPLACE_ME') {
      console.error('%c🔴 Stripe test key 未設定! pk_test_TESTKEY_REPLACE_ME のままです。Stripe Dashboard で test key を発行して public/js/eda-config.js を更新してください。', 'background:#C8102E;color:white;padding:4px 8px;font-weight:bold;border-radius:4px');
      // チェックアウトページでは画面にも警告表示
      if (/checkout|test-checkout/.test(location.pathname)) {
        document.addEventListener('DOMContentLoaded', function() {
          var w = document.createElement('div');
          w.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#C8102E;color:white;text-align:center;padding:10px 16px;font-size:13px;font-weight:700;';
          w.innerHTML = '🔴 開発者向け: Stripe test key 未設定。public/js/eda-config.js を編集してください。';
          document.body.appendChild(w);
        });
      }
    }
  }

  /* 🔴 お客様ごとに中身が変わる問い合わせは、キャッシュを避ける。
     GASのURLは毎回まったく同じなので、そのままだとブラウザとGoogle側の両方が
     前の答えを使い回す。こちらでデータを直しても、お客様の画面は古いままになる。
     2026-09-07 実際に起きた: 定期便を「ご利用中」に直したのに、お客様の画面は
     「ご利用いただいていません」のまま。LINEの中のブラウザは特に長く持ち続ける。
     ⚠️ 商品・在庫（public_catalog / public_products / public_subscriptions）は
        ここに入れない。全員に同じ内容を返すものなので、キャッシュが効いた方が速い。 */
  const NO_CACHE_ACTIONS = ['customer_lookup', 'repeat_shipping', 'coupon_status'];

  /* 🔴 ログインの証拠（合言葉）を毎回そえる — 2026-09-10 追加
     以前は「メールアドレスさえ送れば誰にでも」氏名・電話・住所・注文履歴が返り、
     住所変更も解約も通っていた（ログインを通らなくても叩けた）。
     ログイン時に受け取った合言葉を、すべての問い合わせに自動で付ける。 */
  function edaAuthToken() {
    try {
      var s = JSON.parse(localStorage.getItem('eda-mypage-session') || 'null');
      return (s && s.token) || '';
    } catch (e) { return ''; }
  }
  /* サーバに「ログインが必要」と言われたら、古いログイン情報を捨ててログイン画面へ戻す */
  function edaHandleAuth(res) {
    try {
      if (res && res.code === 'AUTH_REQUIRED') {
        localStorage.removeItem('eda-mypage-session');
        if (/mypage|subscription-/.test(location.pathname)) location.href = 'mypage.html';
      }
    } catch (e) {}
    return res;
  }

  // ヘルパー: GAS への fetch を統一
  global.EDA_API = {
    async get(action, params) {
      const url = new URL(FINAL_URL);
      url.searchParams.set('action', action);
      Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
      const tk = edaAuthToken();
      if (tk) url.searchParams.set('token', tk);
      const noCache = NO_CACHE_ACTIONS.indexOf(action) >= 0;
      if (noCache) url.searchParams.set('_cb', Date.now() + '-' + Math.random().toString(36).slice(2, 8));
      try {
        const res = await fetch(url.toString(), noCache ? { cache: 'no-store' } : undefined);
        return edaHandleAuth(await res.json());
      } catch (e) {
        console.error('[EDA_API.get]', action, e);
        return { ok: false, error: e.message };
      }
    },
    async post(action, body) {
      const url = new URL(FINAL_URL);
      url.searchParams.set('action', action);
      const payload = Object.assign({}, body || {});
      const tk = edaAuthToken();
      if (tk) payload.token = tk;
      try {
        const res = await fetch(url.toString(), {
          method: 'POST',
          // GAS は text/plain で受け取れる (CORS 簡略化のため)
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        });
        return edaHandleAuth(await res.json());
      } catch (e) {
        console.error('[EDA_API.post]', action, e);
        return { ok: false, error: e.message };
      }
    }
  };
})(window);
