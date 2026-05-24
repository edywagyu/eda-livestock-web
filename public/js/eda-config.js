/* ============================================================
   江田畜産 — 共通フロント設定
   ============================================================
   GAS Web App の URL をここに 1 箇所だけ書きます。
   デプロイ後に下記 GAS_URL を本番値に書き換えてください。
*/
(function (global) {
  'use strict';

  // ↓↓↓ 本番 GAS Web App URL (2026-05-24 v7 デプロイ — LINE friends API integration) ↓↓↓
  const GAS_URL_PROD = 'https://script.google.com/macros/s/AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ/exec';
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
      ? 'pk_test_TESTKEY_REPLACE_ME' // Tom が Stripe ダッシュボードで test キーを発行して置換
      : 'pk_live_51PNNcrGSkhU1UEciCMf2g2dI6aO2x4uQYqIOqm772au6vGfsS4E2t6sQNsTqK2nqwA6JFznKqMkp2xM06UFvr9rB00l0i8uN3T',
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
  }

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
