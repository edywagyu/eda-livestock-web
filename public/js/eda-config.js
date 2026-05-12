/* ============================================================
   江田畜産 — 共通フロント設定
   ============================================================
   GAS Web App の URL をここに 1 箇所だけ書きます。
   デプロイ後に下記 GAS_URL を本番値に書き換えてください。
*/
(function (global) {
  'use strict';

  // ↓↓↓ 本番デプロイ時に書き換える ↓↓↓
  const GAS_URL = 'https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec';
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
    STRIPE_PUBLISHABLE_KEY: 'pk_test_REPLACE_ME',
    // LINE 公式 ID
    LINE_AT_ID: '@706sgiuq',
    // 連絡先
    PHONE: '08057930708',
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
