/**
 * ============================================================
 * 江田畜産 オンラインショップ — GAS バックエンド（完全版）
 * ============================================================
 *
 * 全エンドポイント:
 *   GET  ?action=ping                          - ヘルスチェック
 *   GET  ?action=order_status&session_id=XXX    - Stripe Session 照会
 *   POST ?action=create_checkout               - Stripe Checkout 開始 (単品/ギフト)
 *   POST ?action=create_subscription_checkout  - Stripe Subscription 開始 (定期便)
 *   POST ?action=stripe_webhook                - Stripe Webhook 受信
 *   POST ?action=submit_order                  - 注文確定 (Stripe以外のログ用)
 *   POST ?action=submit_quiz                   - クイズ回答
 *   POST ?action=submit_survey                 - アンケート
 *   POST ?action=log_subscription_application  - 定期便申込ログ
 *   POST ?action=request_otp                   - メールOTP送信
 *   POST ?action=verify_otp                    - OTP検証 + 注文履歴取得
 *   POST ?action=skip_subscription             - 月スキップ
 *   POST ?action=cancel_subscription           - 解約申請
 *   GET  ?action=public_products               - 商品一覧
 *   GET  ?action=dashboard                     - 経営ダッシュボード集計
 *   GET  ?action=line_friends                  - LINE 友だち数 (LINE API 連携時)
 *
 * セットアップ手順:
 *   1. Apps Script プロジェクト作成 → このコード貼り付け
 *   2. プロジェクト設定 → スクリプト プロパティで以下を設定:
 *      - STRIPE_SECRET_KEY        : sk_test_... or sk_live_...
 *      - STRIPE_WEBHOOK_SECRET    : whsec_...
 *      - STRIPE_PRICE_MINI        : price_... (ミニ Stripe Price ID, ¥6,980/月 1kg)
 *      - STRIPE_PRICE_PRO         : price_... (スターター, ¥12,800/月 1.6kg, 旧プロプラン)
 *      - STRIPE_PRICE_VIP         : price_... (レギュラー, ¥24,400/月 3.2kg, 旧VIPプラン)
 *      - SPREADSHEET_ID           : Google Sheet の ID
 *      - SUCCESS_URL              : https://edywagyu.github.io/eda-livestock-web/order-complete.html
 *      - CANCEL_URL               : https://edywagyu.github.io/eda-livestock-web/checkout.html
 *      - STAFF_NOTIFICATION_EMAIL : tomoki@eda-livestock.com (新規注文通知の宛先)
 *      - LINE_CHANNEL_TOKEN      : Messaging API チャネルアクセストークン (長期)
 *      - LIFF_ID                 : 1657458587-mz1dR9e6 (LIFF アプリ ID)
 *   3. Sheets を作成、上記 SPREADSHEET_ID をコピー
 *   4. デプロイ → 新規デプロイ → 種類「ウェブアプリ」
 *      - 実行ユーザー: 自分
 *      - アクセス: 全員
 *   5. デプロイ URL をフロント側 `public/js/eda-config.js` に登録
 *   6. Stripe Dashboard → Webhook → エンドポイント追加
 *      - URL: 上記デプロイ URL?action=stripe_webhook
 *      - イベント: checkout.session.completed, customer.subscription.created,
 *                  customer.subscription.deleted, invoice.payment_succeeded
 */

/* ============================================================
   設定 + ユーティリティ
   ============================================================ */

const PROPS = PropertiesService.getScriptProperties();

function cfg(key, fallback) {
  return PROPS.getProperty(key) || fallback || '';
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function corsHeaders() {
  // CORS は doGet/doPost の戻り値で MimeType.JSON にするだけでOK
  // GitHub Pages からの呼び出しはブラウザが許可する
}

function ss() {
  let id = cfg('SPREADSHEET_ID');
  if (!id) {
    // 初回: スプレッドシート自動作成
    const created = SpreadsheetApp.create('江田畜産_EC_オペレーション_' + new Date().toISOString().slice(0,10));
    id = created.getId();
    PROPS.setProperty('SPREADSHEET_ID', id);
    Logger.log('✅ Spreadsheet 自動作成: ' + created.getUrl());
  }
  return SpreadsheetApp.openById(id);
}

function sheet(name, headers) {
  const s = ss();
  let sh = s.getSheetByName(name);
  if (!sh) {
    sh = s.insertSheet(name);
    if (headers && headers.length) {
      sh.appendRow(headers);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function log(action, payload, extra) {
  try {
    const sh = sheet('_logs', ['ts','action','ip','payload','extra']);
    sh.appendRow([
      new Date(),
      action,
      (extra && extra.ip) || '',
      JSON.stringify(payload || {}).slice(0, 2000),
      JSON.stringify(extra || {}).slice(0, 500)
    ]);
  } catch (e) { /* swallow */ }
}

function generateOrderNumber() {
  return 'EDA-' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd') + '-' +
         Utilities.getUuid().slice(0, 6).toUpperCase();
}

/* ============================================================
   ルーター
   ============================================================ */

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'ping';
  try {
    switch (action) {
      case 'ping':              return ping();
      case 'order_status':      return orderStatus(e.parameter.session_id);
      case 'public_products':   return publicProducts();
      case 'public_gifts':      return publicGifts();
      case 'public_subscriptions': return publicSubscriptionPlans();
      case 'public_catalog':    return publicCatalog();
      case 'dashboard':         return dashboardSummary(e.parameter);
      case 'line_friends':      return lineFriends();
      /* ===== Customer Segmentation (LINE 配信用) ===== */
      case 'customers_segment': return customersSegment(e.parameter);
      case 'customers_csv':     return customersCsv(e.parameter);
      case 'segment_stats':     return segmentStats();
      case 'customer_lookup':   return customerLookup(e.parameter);
      case 'check_config':      return jsonResponse(checkConfig());
      case 'setup':             return runSetup(e.parameter);
      case 'update_properties': return jsonResponse(setupAllProperties());
      /* ===== 🔧 診断用 (read-only / 失敗オーダーの遡及修復) ===== */
      case 'diag_webhooks':     return diagWebhooks();
      case 'diag_recover_sub':  return diagRecoverSubscription(e.parameter);
      case 'diag_subscriptions': return diagSubscriptions(e.parameter);
      case 'diag_cancel_subscription': return diagCancelSubscription(e.parameter);
      case 'diag_update_webhook': return diagUpdateWebhook(e.parameter);
      case 'diag_find_session':  return diagFindSession(e.parameter);
      case 'diag_dedupe_orders': return diagDedupeOrders(e.parameter);
      /* ===== STAFF ===== */
      case 'staff_login':       return staffLogin(e.parameter);
      case 'staff_dashboard':   return staffDashboard();
      case 'staff_inventory':   return staffInventory();
      case 'staff_orders':      return staffOrders();
      case 'staff_analytics':   return staffAnalytics(e.parameter);
      case 'b2_csv':            return b2CsvExport();
      /* ===== 経営ダッシュボード追加アクション (Code_v2_Additions.gs に実装) ===== */
      case 'orders':            return ordersOverview(e.parameter);
      case 'subscriptions':     return subscriptionsOverview(e.parameter);
      case 'customers':         return customersOverview(e.parameter);
      case 'survey_responses':  return surveyResponsesOverview(e.parameter);
      case 'quiz_responses':    return quizResponsesOverview(e.parameter);
      case 'shipments':         return shipmentsOverview(e.parameter);
      default:                  return jsonResponse({ ok:false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    log(action + '_error', { error: err.message }, { stack: err.stack });
    return jsonResponse({ ok:false, error: err.message });
  }
}

/* GET ?action=setup&secret={SETUP_SECRET}&stripe_key={sk_live_...}
   ────────────────────────────────────────────────────────────────
   ワンショット セットアップ:
   1. setupAllProperties (Price ID 等)
   2. optionally STRIPE_SECRET_KEY もパラメータから設定 (チャットに貼らないため非推奨)
   3. initSheets (シート初期化 + スプレッドシート自動作成)
   4. spreadsheet URL を返却
*/
function runSetup(params) {
  // ワンタイム保護: 既に設定済みなら拒否（攻撃者が再上書きできないように）
  const lock = PROPS.getProperty('SETUP_LOCKED');
  if (lock === 'true') {
    return jsonResponse({ ok:false, error: 'Setup already locked. Manual access required.' });
  }
  setupAllProperties();
  if (params.stripe_key) PROPS.setProperty('STRIPE_SECRET_KEY', params.stripe_key);
  const initResult = initSheets();
  PROPS.setProperty('SETUP_LOCKED', 'true');
  const cfgResult = checkConfig();
  return jsonResponse({
    ok: true,
    message: 'セットアップ完了',
    spreadsheet_url: initResult.spreadsheet_url,
    spreadsheet_id: initResult.id,
    config: cfgResult
  });
}

function doPost(e) {
  const action = (e.parameter && e.parameter.action) || '';
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}

  // Stripe Webhook は raw body 必要なので別扱い
  if (action === 'stripe_webhook') {
    return handleStripeWebhook(e);
  }

  // ★ LINE Messaging API Webhook（友だち追加/メッセージ/postback）。
  //   LINE は ?action= を付けず、body に { destination, events:[...] } を送る。
  //   switch に入る前に body 形状で振り分ける（?action=line_webhook 明示にも対応）。
  if (action === 'line_webhook' || (!action && body && (body.destination || Array.isArray(body.events)))) {
    return handleLineWebhook(body);
  }

  try {
    log(action, body);
    switch (action) {
      case 'create_checkout':              return createCheckout(body);
      case 'create_bank_order':            return createBankOrder(body);
      case 'create_subscription_checkout': return createSubscriptionCheckout(body);
      case 'submit_order':                 return submitOrder(body);
      /* ===== LINE LIFF Auth ===== */
      case 'line_login':                   return lineLogin(body);
      case 'line_link_account':            return lineLinkAccount(body);
      case 'line_register':                return lineRegister(body);
      case 'update_profile':               return updateProfile(body);
      /* ===== STAFF (POST) ===== */
      case 'staff_update_stock':           return staffUpdateStock(body);
      case 'staff_product_save':           return staffProductSave(body);
      case 'staff_product_delete':         return staffProductDelete(body);
      case 'staff_gift_save':              return staffGiftSave(body);
      case 'staff_gift_delete':            return staffGiftDelete(body);
      case 'staff_subscription_save':      return staffSubscriptionSave(body);
      case 'staff_subscription_delete':    return staffSubscriptionDelete(body);
      case 'staff_ship':                   return staffShip(body);
      case 'staff_confirm_payment':        return staffConfirmPayment(body);
      case 'submit_quiz':                  return submitQuiz(body);
      case 'submit_survey':                return submitSurvey(body);
      case 'log_event':                    return logEvent(body);
      case 'log_subscription_application': return logSubscriptionApplication(body);
      case 'request_otp':                  return requestOtp(body);
      case 'verify_otp':                   return verifyOtp(body);
      case 'start_card_setup':             return startCardSetup(body);
      /* ===== お問い合わせフォーム (Code_v2_Additions.gs に実装) ===== */
      case 'submit_inquiry':               return submitInquiry(body);
      case 'skip_subscription':            return skipSubscription(body);
      case 'cancel_subscription':          return cancelSubscription(body);
      case 'client_error':                 return logClientError(body);
      default:                              return jsonResponse({ ok:false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    log(action + '_error', body, { error: err.message, stack: err.stack });
    return jsonResponse({ ok:false, error: err.message });
  }
}

/* ============================================================
   GET: ping
   ============================================================ */
function ping() {
  return jsonResponse({
    ok: true,
    version: '2026.06.02-bank',
    versionNote: 'v19: 銀行振込=GMOあおぞら手動フロー(create_bank_order/staff_confirm_payment・Stripe非経由・未入金は発送ガード&売上非計上)。v18: LINE follow webhook/Stripe webhook偽造防止/定期便50%OFFフォールバック',
    serverTime: new Date().toISOString(),
    stripeMode: cfg('STRIPE_SECRET_KEY').indexOf('sk_live_') === 0 ? 'live' : 'test'
  });
}

/* ============================================================
   POST: create_checkout (Stripe Checkout — 単品/ギフト)
   ============================================================
   body:
     {
       customer: {email, name, phone, zip, pref, address},
       destinations: [{type, name, tel, zip, pref, address, items:[{...}]}],
       items: [{variantId, title, variant, price, qty}],  // または destinations.items から計算
       subscription: null | {plan: 'starter'|'regular'|'volume'},
       payment_method: 'card' | 'apple' | 'bank',
       coupon_code: optional
     }
*/
function createCheckout(body) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) throw new Error('Stripe not configured');

  // 商品行を集約
  // - stripePriceId があれば Price ID を使用 (Stripe商品マスタと連携)
  // - なければ ad-hoc price_data (互換性維持)
  const lineItems = [];
  const items = collectItems(body);

  // ★ 在庫上限チェック (在庫切れ → 注文受付拒否)
  // products シートから現在在庫を取得して、各 cart item を検証
  try {
    const stockErrors = validateStockBeforeCheckout(items);
    if (stockErrors.length > 0) {
      return jsonResponse({
        ok: false,
        error: 'OUT_OF_STOCK',
        message: '以下の商品は在庫不足のため注文できません:\n' + stockErrors.join('\n'),
        out_of_stock: stockErrors
      });
    }
  } catch (e) {
    // 在庫検証エラーは fail-open (シート未作成時など) → ログだけ
    log('stock_check_warn', { error: e.message });
  }
  items.forEach(it => {
    if (it.stripePriceId) {
      lineItems.push({
        price: it.stripePriceId,
        quantity: it.qty
      });
    } else {
      lineItems.push({
        price_data: {
          currency: 'jpy',
          product_data: { name: it.title + (it.variant ? ' ('+it.variant+')' : '') },
          unit_amount: Math.round(it.price)
        },
        quantity: it.qty
      });
    }
  });

  // 送料・税はチェックアウト側で計算 (Stripe automatic_tax か手動)
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  // ★ ギフトは全部 送料無料: 自宅(非ギフト)アイテムの小計のみで calcShipping を計算する。
  //   gift destination 分は ¥0。全部ギフト → 自宅小計 0 → 送料 0。
  //   destinations に items が無い古いクライアントは従来通り全額で計算 (fail-safe で無料化しない)。
  const _selfKeys = {};
  (body.destinations || []).forEach(function (d) {
    if (d.type !== 'gift') (d.items || []).forEach(function (it) { _selfKeys[(it.title || '') + '|' + (it.variant || '')] = true; });
  });
  const _hasDestItems = (body.destinations || []).some(function (d) { return (d.items || []).length > 0; });
  const _selfSubtotal = _hasDestItems
    ? items.reduce(function (s, it) { return _selfKeys[(it.title || '') + '|' + (it.variant || '')] ? s + it.price * it.qty : s; }, 0)
    : subtotal;
  const shipping = _selfSubtotal > 0 ? calcShipping(_selfSubtotal, body.customer && body.customer.pref) : 0;
  if (shipping > 0) {
    lineItems.push({
      price_data: {
        currency: 'jpy',
        product_data: { name: '送料' },
        unit_amount: shipping
      },
      quantity: 1
    });
  }

  const orderNum = generateOrderNumber();
  const successUrl = cfg('SUCCESS_URL') + '?session_id={CHECKOUT_SESSION_ID}&order=' + encodeURIComponent(orderNum);
  const cancelUrl = cfg('CANCEL_URL');

  // 決済方法 (単発購入のみ・サブスクは create_subscription_checkout でカード固定)
  const methodTypes = ['card'];
  if (body.payment_method === 'bank') methodTypes.push('konbini', 'customer_balance');

  // ★ (B) 保存カード再利用: email から Stripe Customer を紐付け（取得失敗時は従来の customer_email にフォールバック＝無変更）
  let checkoutCustomerId = '';
  try {
    const _ckEmail = (body.customer && body.customer.email) || '';
    if (_ckEmail) checkoutCustomerId = getOrCreateStripeCustomer(_ckEmail, (body.customer && body.customer.name) || '');
  } catch (e) { log('checkout_customer_warn', { error: String(e) }); }

  const checkoutParams = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'ja',
    payment_method_types: methodTypes,
    /* 🔴 Stripe Japan 銀行振込: customer_balance には funding_type と
       bank_transfer.type=jp_bank_transfer の指定が必須 */
    payment_method_options: methodTypes.indexOf('customer_balance') >= 0 ? {
      customer_balance: {
        funding_type: 'bank_transfer',
        bank_transfer: { type: 'jp_bank_transfer' }
      }
    } : undefined,
    customer_email: (body.customer && body.customer.email) || undefined,
    line_items: lineItems,
    metadata: {
      order_number: orderNum,
      mode: body.mode || 'single',
      customer_name: body.customer && body.customer.name,
      customer_phone: body.customer && body.customer.phone,
      line_uid:     (body.customer && body.customer.line_uid) || '',
      line_name:    (body.customer && body.customer.line_name) || '',
      contact_method: (body.customer && body.customer.contact_method) || '',
      destinations_json: JSON.stringify(body.destinations || []),
      delivery_date: (body.delivery && body.delivery.date) || '',   // 顧客の配送希望日 (ISO YYYY-MM-DD・未指定は空)
      delivery_time: (body.delivery && body.delivery.time) || '',   // 配送希望時間帯 (表示用ラベル文字列)
      /* ★ 在庫 decrement 用に items を保存 (Stripe metadata は 500 文字制限) */
      items_json: JSON.stringify(items.map(it => ({
        title: it.title || it.name || '',
        variant: it.variant || '',
        qty: it.qty || 1
      }))).slice(0, 480)
    }
  };

  // ★ (B) Customer 紐付け時: 保存カードの再利用UI + 新規カード保存。失敗時(空)は customer_email のまま(無変更)。
  if (checkoutCustomerId) {
    delete checkoutParams.customer_email;            // customer と customer_email は同時指定不可
    checkoutParams.customer = checkoutCustomerId;
    checkoutParams.payment_method_options = checkoutParams.payment_method_options || {};
    checkoutParams.payment_method_options.card = { setup_future_usage: 'off_session' };  // card のみ保存（konbini/bank は対象外）
  }

  // 🎁 デモ期間 100%OFF クーポン自動適用
  // STRIPE_DEMO_COUPON が設定されていれば全注文に適用 (デモ後は空に戻す)
  const demoCoupon = cfg('STRIPE_DEMO_COUPON');
  if (demoCoupon) {
    checkoutParams.discounts = [{ coupon: demoCoupon }];
  } else if (body.coupon_code) {
    // 手動クーポンも対応
    checkoutParams.discounts = [{ coupon: body.coupon_code }];
  }

  const params = flattenForm(checkoutParams);

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    payload: params,
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error('Stripe: ' + data.error.message);

  // pending 注文として記録
  recordPendingOrder(orderNum, data.id, body, subtotal, shipping);

  return jsonResponse({ ok: true, url: data.url, session_id: data.id, order_number: orderNum });
}

/* ============================================================
   銀行振込（GMOあおぞらネット銀行）— 手動振込フロー
   ------------------------------------------------------------
   口座情報は顧客に提示する公開情報（秘密鍵ではない）。
   Script Property（BANK_*）で上書き可、未設定なら既定値。
   ============================================================ */
function bankAccountInfo() {
  return {
    bank:   cfg('BANK_NAME',   'GMOあおぞらネット銀行'),
    branch: cfg('BANK_BRANCH', '法人第二営業部'),
    type:   cfg('BANK_TYPE',   '普通'),
    number: cfg('BANK_NUMBER', '2449808'),
    holder: cfg('BANK_HOLDER', '江田畜産株式会社')
  };
}
function bankAccountText() {
  var b = bankAccountInfo();
  return '銀行名　: ' + b.bank + '\n' +
         '支店名　: ' + b.branch + '\n' +
         '口座種別: ' + b.type + '\n' +
         '口座番号: ' + b.number + '\n' +
         '口座名義: ' + b.holder;
}

/* ============================================================
   POST: create_bank_order (銀行振込 — Stripe を経由しない手動フロー)
   ------------------------------------------------------------
   ・注文を orders に payment_status='awaiting_payment' で直接記録
   ・GMOあおぞら口座 + 振込金額を顧客へ通知（LINE連携時はLINE push / 無ければメール）
   ・在庫は decrement しない（入金確認時 staffConfirmPayment で減算）
   ・スタッフへ「振込待ち」通知メール
   ・売上は payment_status='paid' のみ計上のため未入金は売上に乗らない
   body: createCheckout と同形 + display_total（クーポン適用後の最終合計）
   ============================================================ */
function createBankOrder(body) {
  const items = collectItems(body);

  // 在庫上限チェック（createCheckout と同一）
  try {
    const stockErrors = validateStockBeforeCheckout(items);
    if (stockErrors.length > 0) {
      return jsonResponse({
        ok: false, error: 'OUT_OF_STOCK',
        message: '以下の商品は在庫不足のため注文できません:\n' + stockErrors.join('\n'),
        out_of_stock: stockErrors
      });
    }
  } catch (e) { log('stock_check_warn', { error: e.message }); }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  // 送料（createCheckout と同一ロジック: ギフトは無料・自宅小計で判定）
  const _selfKeys = {};
  (body.destinations || []).forEach(function (d) {
    if (d.type !== 'gift') (d.items || []).forEach(function (it) { _selfKeys[(it.title || '') + '|' + (it.variant || '')] = true; });
  });
  const _hasDestItems = (body.destinations || []).some(function (d) { return (d.items || []).length > 0; });
  const _selfSubtotal = _hasDestItems
    ? items.reduce(function (s, it) { return _selfKeys[(it.title || '') + '|' + (it.variant || '')] ? s + it.price * it.qty : s; }, 0)
    : subtotal;
  const shipping = _selfSubtotal > 0 ? calcShipping(_selfSubtotal, body.customer && body.customer.pref) : 0;

  // 振込金額: クライアント計算済みの最終合計（クーポン適用後）を信頼。
  //   入金は Tom が実額照合（アナログ）するため、画面表示との一致を優先。無ければ subtotal+shipping。
  let total = Number(body.display_total);
  if (!total || total <= 0) total = subtotal + shipping;

  const orderNum = generateOrderNumber();
  const cust = body.customer || {};
  const itemsJson = JSON.stringify(items.map(it => ({ title: it.title || it.name || '', variant: it.variant || '', qty: it.qty || 1 })));
  const meta = {
    order_number: orderNum,
    mode: body.mode || 'single',
    customer_name: cust.name || '',
    customer_phone: cust.phone || '',
    line_uid: cust.line_uid || '',
    line_name: cust.line_name || '',
    contact_method: cust.contact_method || '',
    destinations_json: JSON.stringify(body.destinations || []),
    delivery_date: (body.delivery && body.delivery.date) || '',
    delivery_time: (body.delivery && body.delivery.time) || '',
    items_json: itemsJson,
    coupon_code: body.couponCode || '',
    payment_method: 'bank'
  };

  // orders に直接記録（awaiting_payment）。session_id は擬似値で重複ガード兼用。
  const sh = sheet('orders', [
    'order_number','placed_at','session_id','customer_name','customer_email','customer_phone',
    'mode','total','shipping','payment_status','payment_method',
    'destinations_json','items_json','metadata_json','line_uid','line_name','contact_method'
  ]);
  const pseudoSession = 'bank-' + orderNum;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) {}
  try {
    sh.appendRow([
      orderNum, new Date(), pseudoSession,
      cust.name || '', cust.email || '', cust.phone || '',
      body.mode || 'single', total, shipping,
      'awaiting_payment', 'bank',
      meta.destinations_json, itemsJson, JSON.stringify(meta),
      cust.line_uid || '', cust.line_name || '', cust.contact_method || ''
    ]);
    // 配送希望日/時間帯（finalizeOrder と同じ名前解決＋テキスト固定で日付ズレ防止）
    try {
      if (meta.delivery_date || meta.delivery_time) {
        var _hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        var _appended = sh.getLastRow();
        var _ensureCol = function (name) {
          var idx = _hdr.indexOf(name);
          if (idx === -1) { sh.getRange(1, _hdr.length + 1).setValue(name); _hdr.push(name); idx = _hdr.length - 1; }
          return idx + 1;
        };
        if (meta.delivery_date) { var _cd = sh.getRange(_appended, _ensureCol('delivery_date')); _cd.setNumberFormat('@'); _cd.setValue(meta.delivery_date); }
        if (meta.delivery_time) { var _ct = sh.getRange(_appended, _ensureCol('delivery_time')); _ct.setNumberFormat('@'); _ct.setValue(meta.delivery_time); }
      }
    } catch (e) { log('delivery_write_error', { order: orderNum, error: e.message }); }
  } finally {
    lock.releaseLock();
  }

  // 顧客へ振込案内（LINE連携時は LINE、無ければメール）
  let bankPushed = false;
  const lineUid = (cust.line_uid && String(cust.line_uid).trim()) || lineUidForEmail(cust.email || '');
  if (lineUid) {
    try { bankPushed = sendLinePush(lineUid, [buildBankTransferMessage(cust.name || '', orderNum, total)]); } catch (e) {}
  }
  if (!bankPushed && cust.email) {
    try { sendBankTransferEmail(cust.email, cust.name || '', orderNum, total); } catch (e) { log('bank_email_error', { order: orderNum, error: e.message }); }
  }
  // スタッフへ振込待ち通知
  try { sendStaffBankPendingEmail(orderNum, total, cust); } catch (e) {}

  log('bank_order_created', { order: orderNum, total: total });
  return jsonResponse({ ok: true, order_number: orderNum, total: total, bank: bankAccountInfo() });
}

/* 振込案内 LINE Flex（口座 + 金額 + 入金確認後に発送のフロー説明）。 */
function buildBankTransferMessage(customerName, orderNum, totalYen) {
  var b = bankAccountInfo();
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  return {
    type: 'flex',
    altText: '【江田畜産】ご注文ありがとうございます。お振込先のご案内（' + orderNum + '）',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '🏦 お振込先のご案内', weight: 'bold', size: 'md', color: '#2d5016' },
          { type: 'text', text: greeting + '、ご注文ありがとうございます。下記口座へお振込ください。', size: 'sm', color: '#555555', wrap: true },
          { type: 'separator' },
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '振込金額', size: 'sm', color: '#888888', flex: 4 },
            { type: 'text', text: '¥' + (totalYen || 0).toLocaleString(), size: 'lg', color: '#C8102E', weight: 'bold', flex: 6, align: 'end' }
          ]},
          { type: 'separator' },
          { type: 'box', layout: 'vertical', spacing: 'xs', contents: [
            { type: 'text', text: b.bank, size: 'sm', color: '#333333', weight: 'bold', wrap: true },
            { type: 'text', text: b.branch + ' / ' + b.type + ' ' + b.number, size: 'sm', color: '#333333', wrap: true },
            { type: 'text', text: '名義: ' + b.holder, size: 'sm', color: '#333333', wrap: true }
          ]},
          { type: 'separator' },
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '注文番号', size: 'xs', color: '#888888', flex: 4 },
            { type: 'text', text: orderNum, size: 'xs', color: '#333333', flex: 6, align: 'end', wrap: true }
          ]},
          { type: 'text', text: 'ご入金を確認後、商品を発送いたします（発送時にあらためてご連絡します）。振込手数料はお客様負担にてお願いいたします。', size: 'xxs', color: '#999999', wrap: true, margin: 'md' }
        ]
      }
    }
  };
}

/* 振込案内メール（LINE未連携の顧客向けフォールバック）。 */
function sendBankTransferEmail(email, customerName, orderNum, totalYen) {
  if (!email) return;
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  var body =
    greeting + '\n\n' +
    'この度はご注文いただきありがとうございます。\n' +
    '下記の口座へお振込をお願いいたします。ご入金を確認後、商品を発送いたします。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    ' ご注文番号: ' + orderNum + '\n' +
    ' お振込金額: ¥' + Number(totalYen || 0).toLocaleString() + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n\n' +
    '【お振込先】\n' +
    bankAccountText() + '\n\n' +
    '※ 振込手数料はお客様のご負担にてお願いいたします。\n' +
    '※ ご入金の確認後、発送のご連絡（追跡番号）をお送りいたします。\n' +
    '※ お振込の際は、お名前（ご注文者様）でお願いいたします。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    '江田畜産株式会社\n' +
    'backoffice@eda-livestock.com\n' +
    'https://eda-livestock.com/\n';
  MailApp.sendEmail({
    to: email,
    subject: '【江田畜産】お振込先のご案内（' + orderNum + '）',
    body: body
  });
}

/* スタッフ向け「振込待ち」通知（入金を実額で照合するアナログ確認の起点）。 */
function sendStaffBankPendingEmail(orderNum, totalYen, cust) {
  var to = cfg('STAFF_NOTIFICATION_EMAIL') || 'backoffice@eda-livestock.com';
  try {
    MailApp.sendEmail({
      to: to,
      subject: '【振込待ち】 ' + orderNum + ' ¥' + Number(totalYen || 0).toLocaleString(),
      body:
        '【銀行振込のご注文 — 入金待ち】\n\n' +
        '注文番号: ' + orderNum + '\n' +
        '振込予定額: ¥' + Number(totalYen || 0).toLocaleString() + '\n' +
        'お客様: ' + ((cust && cust.name) || '') + '\n' +
        'メール: ' + ((cust && cust.email) || '') + '\n' +
        '電話: ' + ((cust && cust.phone) || '') + '\n\n' +
        'GMOあおぞらの入金を確認したら、STAFF ポータルで「入金確認」→「伝票発行（発送）」へ進んでください。\n' +
        '※ 入金確認するまで発送（伝票発行）はできません。'
    });
  } catch (e) { log('staff_bank_email_error', { order: orderNum, error: e.message }); }
}

/* ============================================================
   POST: create_subscription_checkout (Stripe Subscriptions — 定期便)
   ============================================================
   ⚠ 2026-05-26 リファクタ: 旧仕様（mode=subscription 単発）→ 新仕様（2段構成）
   ・初回決済: Checkout `mode=payment` で初月分を即時課金（決済日は顧客の任意日）
   ・2回目以降: 決済成功 Webhook で Subscription を生成し、billing_cycle_anchor=翌月20日
                  proration_behavior='none' で「毎月20日に強制課金」
   ・配送: 月初(1日)に運用側で発送（Stripe 関与なし）
   ・Tom 指示「翌月の決済は二十日になる。当月は日を問わない。あなたが決済した日」を実装
   ============================================================ */
function createSubscriptionCheckout(body) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) throw new Error('Stripe not configured');

  // 2026-05-26: GAS Properties が古い inactive Price ID を保持しているケースに備え、
  //              既知の正しい active Price ID を fallback として明示
  const planMap = {
    starter: cfg('STRIPE_PRICE_MINI', 'price_1TWAN0GSkhU1UEciNGZHORc3'),  // ミニ ¥6,980
    regular: cfg('STRIPE_PRICE_PRO',  'price_1TWAN0GSkhU1UEciKod4PGpk'),  // スターター ¥12,800
    volume:  cfg('STRIPE_PRICE_VIP',  'price_1TbK7DGSkhU1UEciPsf2dA53')   // レギュラー ¥24,400 (旧 ¥27,400/¥39,800 は archive 済み)
  };
  const priceId = planMap[body.plan];
  if (!priceId) throw new Error('Invalid plan: ' + body.plan);

  // 防御層: 古い inactive ID を含む Properties 設定でも事故らないよう、
  //          known-bad ID なら active な fallback に強制差し替え
  const KNOWN_BAD_PRICE_IDS = {
    'price_1TWAN1GSkhU1UEciXQJyqNet': 'price_1TbK7DGSkhU1UEciPsf2dA53', // 旧 ¥27,400 → 新 ¥24,400
    'price_1TW750GSkhU1UEciLLw2gqss': 'price_1TbK7DGSkhU1UEciPsf2dA53', // 旧 ¥39,800 → 新 ¥24,400
    'price_1TW74zGSkhU1UEciUiGw5tlq': 'price_1TWAN0GSkhU1UEciNGZHORc3', // 旧ミニ ¥9,800  → 現ミニ ¥6,980
    'price_1TW74zGSkhU1UEci5RQzoKIP': 'price_1TWAN0GSkhU1UEciKod4PGpk'  // 旧スターター ¥19,800 → 現スターター ¥12,800
  };
  const correctedPriceId = KNOWN_BAD_PRICE_IDS[priceId] || priceId;

  // Stripe Price から金額・プラン名を取得（line_items.price_data 用）
  const priceRes = UrlFetchApp.fetch('https://api.stripe.com/v1/prices/' + correctedPriceId, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  const priceObj = JSON.parse(priceRes.getContentText());
  if (priceObj.error) throw new Error('Stripe price retrieval: ' + priceObj.error.message);
  const unitAmount = priceObj.unit_amount;
  const planNames = { starter: 'ミニ', regular: 'スターター', volume: 'レギュラー' };
  const planName = planNames[body.plan] || body.plan;

  // 翌月20日 9:00 JST の Unix timestamp（2回目以降の billing_cycle_anchor）
  // GAS 実行タイムゾーンが Asia/Tokyo 想定。Date() はローカル時刻で計算される
  const now = new Date();
  const next20th = new Date(now.getFullYear(), now.getMonth() + 1, 20, 9, 0, 0);
  const anchorUnix = Math.floor(next20th.getTime() / 1000);

  const orderNum = generateOrderNumber();
  const successUrl = cfg('SUCCESS_URL') + '?session_id={CHECKOUT_SESSION_ID}&order=' + encodeURIComponent(orderNum);
  const cancelUrl = cfg('CANCEL_URL') + '?plan=' + body.plan;

  // 適用クーポン優先順位:
  //   1. body.coupon_code === 'test' / 'テスト' → DEMO100 (100%OFF · ¥0決済) ← 実機テスト用
  //   2. STRIPE_DEMO_COUPON (デモ期間 100%OFF) — 通常は空文字 (本番ローンチ済)
  //   3. STRIPE_COUPON_50OFF (本番 初月50%OFF) ← 通常はこれが適用される
  // ★ どれも duration='once' なので、初回 Checkout 一度きりに適用される
  //    (2回目以降の Subscription billing には適用されない)
  const userCouponInput = String(body.coupon_code || '').trim().toLowerCase();
  // ★ test クーポン(100%OFF=¥0)は本番で無効。Script Property ALLOW_TEST_COUPON='true' の時のみ有効化。
  //   (誰でも coupon欄に 'test' と入れて定期便を¥0にできる穴を塞ぐ。検証時のみ Tom が一時的に ON にする)
  const isTestCoupon = (cfg('ALLOW_TEST_COUPON') === 'true') &&
                       (userCouponInput === 'test' || userCouponInput === 'テスト' || body.coupon_code === 'テスト');
  const demoCoupon = cfg('STRIPE_DEMO_COUPON');
  // ★ 初月50%OFF: Property 未設定でも 'FIRST50' にフォールバック（黙って割引が消える事故を防止）。
  const halfCoupon = cfg('STRIPE_COUPON_50OFF', 'FIRST50');
  const applyCoupon = isTestCoupon ? 'DEMO100' : (demoCoupon || halfCoupon || '');

  // Checkout in PAYMENT mode (初月分の一回限り課金)
  // setup_future_usage='off_session' で決済カードを保存 → Webhook で Subscription にアタッチ
  const sessionParams = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'ja',
    payment_method_types: ['card'],
    customer_email: body.customer && body.customer.email,
    customer_creation: 'always',  // Customer オブジェクトを必須作成 (Subscription 紐付け用)
    line_items: [{
      price_data: {
        currency: 'jpy',
        product_data: { name: planName + '定期便（初月分）' },
        unit_amount: unitAmount
      },
      quantity: 1
    }],
    payment_intent_data: {
      setup_future_usage: 'off_session',
      metadata: {
        plan: body.plan,
        order_number: orderNum,
        recurring_price_id: correctedPriceId,
        billing_anchor: String(anchorUnix),
        sub_mode: 'create_after_payment'
      }
    },
    metadata: {
      order_number: orderNum,
      plan: body.plan,
      mode: 'subscription_first_month',
      recurring_price_id: correctedPriceId,
      billing_anchor: String(anchorUnix),
      is_demo: demoCoupon ? 'true' : 'false',
      // 顧客情報をメタに含める (スタッフ通知メール / orders シート用)
      customer_name: (body.customer && body.customer.name) || '',
      customer_phone: (body.customer && body.customer.phone) || '',
      customer_zip: (body.customer && body.customer.zip) || '',
      customer_pref: (body.customer && body.customer.pref) || '',
      customer_address: (body.customer && body.customer.address) || '',
      destinations_json: JSON.stringify([{
        name: (body.customer && body.customer.name) || '',
        phone: (body.customer && body.customer.phone) || '',
        zip: (body.customer && body.customer.zip) || '',
        pref: (body.customer && body.customer.pref) || '',
        address: (body.customer && body.customer.address) || ''
      }])
    }
  };
  if (applyCoupon) {
    sessionParams.discounts = [{ coupon: applyCoupon }];
  }
  const params = flattenForm(sessionParams);

  let res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    payload: params,
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  let data = JSON.parse(res.getContentText());

  // ★ クーポンが原因で失敗した場合は「割引なし」で1回だけ再試行する。
  //   (例: Stripe live に FIRST50 が存在しない/期限切れ) → 決済自体が不能になるのを防ぐ。
  //   満額のまま黙って通さず、Tom に通知して原因(クーポン未整備)を可視化する。
  if (data.error && applyCoupon && /coupon|promotion|discount|no such/i.test(data.error.message || '')) {
    log('subscription_coupon_failed', { coupon: applyCoupon, error: data.error.message, order: orderNum });
    try {
      MailApp.sendEmail({
        to: cfg('STAFF_NOTIFICATION_EMAIL') || 'tomoki@eda-livestock.com',
        subject: '⚠ 定期便クーポン未適用（割引なしで継続）',
        body: '初月50%OFFクーポン "' + applyCoupon + '" が Stripe で適用できませんでした。\n'
            + 'Error: ' + data.error.message + '\n注文: ' + orderNum + '\n\n'
            + '→ Stripe(本番/liveモード) に Coupon "' + applyCoupon + '" (50%OFF・duration=once) が\n'
            + '  存在・有効かを確認してください。今回は割引なし(満額)で Checkout を継続しました。'
      });
    } catch (e2) {}
    delete sessionParams.discounts;
    res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'post',
      payload: flattenForm(sessionParams),
      headers: { 'Authorization': 'Bearer ' + STRIPE },
      muteHttpExceptions: true
    });
    data = JSON.parse(res.getContentText());
  }

  if (data.error) throw new Error('Stripe: ' + data.error.message);

  recordPendingOrder(orderNum, data.id, body, null, 0, 'subscription_first_month');

  return jsonResponse({ ok: true, url: data.url, session_id: data.id, order_number: orderNum });
}

/* ============================================================
   Webhook 後処理: 初月決済成功 → Subscription を生成（毎月20日 anchor）
   ============================================================
   ・Checkout (mode=payment) で初月課金が完了したら finalizeOrder から呼ばれる
   ・customer / payment_method は決済時に保存済み（setup_future_usage='off_session'）
   ・billing_cycle_anchor を翌月20日に設定し、proration_behavior='none' で
     「anchor まで請求書なし、anchor から毎月20日に自動課金」を実現
   ============================================================ */
/* ============================================================
   🔧 診断: Stripe Webhook 登録 URL を確認 (read-only)
   ============================================================ */
function diagWebhooks() {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return jsonResponse({ ok:false, error:'STRIPE_SECRET_KEY not set' });
  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/webhook_endpoints?limit=20', {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  if (data.error) return jsonResponse({ ok:false, error: data.error.message });
  return jsonResponse({
    ok: true,
    endpoints: (data.data || []).map(function(w){
      return {
        id: w.id,
        url: w.url,
        status: w.status,
        enabled_events: w.enabled_events,
        created: w.created
      };
    })
  });
}

/* ============================================================
   🔧 失敗オーダー遡及修復: Subscription を手動生成
   ============================================================
   ?action=diag_recover_sub&session_id=cs_live_xxxx
   ・既存 Checkout Session から PaymentIntent を取得
   ・PaymentMethod を保存済 Customer に attach
   ・Subscription を billing_cycle_anchor=翌月20日 で作成
   ============================================================ */
/* ============================================================
   GET ?action=diag_subscriptions — Stripe の全サブスクを live 一覧（読み取り専用・課金しない）
   各 sub: status / email / current_period_end(次回課金日) / amount / interval / 既定PM有無。
   テスト顧客 cus_Uake は is_test=true で除外集計。
   🔴 active なのに has_default_pm=false = 次回課金が失敗する＝要対応。
   ============================================================ */
function diagSubscriptions(params) {
  var STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return jsonResponse({ ok:false, error:'STRIPE_SECRET_KEY not set' });
  var TEST_CUS = 'cus_UakeKnQRLIzK9x';
  var out = [], startingAfter = '', guard = 0;
  do {
    var url = 'https://api.stripe.com/v1/subscriptions?status=all&limit=100'
            + '&expand[]=data.default_payment_method&expand[]=data.customer';
    if (startingAfter) url += '&starting_after=' + startingAfter;
    var res = UrlFetchApp.fetch(url, { method:'get', headers:{ 'Authorization':'Bearer '+STRIPE }, muteHttpExceptions:true });
    var data = JSON.parse(res.getContentText());
    if (data.error) return jsonResponse({ ok:false, error: data.error.message });
    (data.data || []).forEach(function (s) {
      var cust = (s.customer && typeof s.customer === 'object') ? s.customer : null;
      var pm = (s.default_payment_method && typeof s.default_payment_method === 'object') ? s.default_payment_method : s.default_payment_method;
      var custDefaultPm = cust && cust.invoice_settings && cust.invoice_settings.default_payment_method;
      var item = (s.items && s.items.data && s.items.data[0]) || {};
      var price = item.price || {};
      out.push({
        id: s.id,
        status: s.status,
        created: s.created ? new Date(s.created * 1000).toISOString().slice(0, 10) : '',
        first_payment_session: (s.metadata && s.metadata.first_payment_session) || '',
        is_test: (s.customer === TEST_CUS) || (cust && cust.id === TEST_CUS),
        customer_id: cust ? cust.id : s.customer,
        email: cust ? (cust.email || '') : '',
        current_period_end: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString().slice(0, 10) : '',
        cancel_at_period_end: !!s.cancel_at_period_end,
        amount: (price.unit_amount != null) ? price.unit_amount : '',
        interval: price.recurring ? price.recurring.interval : '',
        has_default_pm: !!(pm || custDefaultPm)
      });
    });
    startingAfter = (data.has_more && data.data.length) ? data.data[data.data.length - 1].id : '';
    guard++;
  } while (startingAfter && guard < 10);
  var real = out.filter(function (x) { return !x.is_test; });
  var realActive = real.filter(function (x) { return x.status === 'active' || x.status === 'trialing' || x.status === 'past_due'; });
  var summary = {
    total: out.length,
    test: out.length - real.length,
    real: real.length,
    real_active: realActive.length,
    real_active_no_pm: realActive.filter(function (x) { return !x.has_default_pm; }).length,
    real_past_due: real.filter(function (x) { return x.status === 'past_due' || x.status === 'unpaid'; }).length
  };
  return jsonResponse({ ok:true, summary: summary, real_subs: real });
}

/* GET ?action=diag_cancel_subscription&id=sub_xxx — 指定サブスクを即時キャンセル（Stripe 実解約・書込）。
   二重サブスクの片方を消す等の運用用。id(sub_) 明示必須。 */
function diagCancelSubscription(params) {
  var STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return jsonResponse({ ok:false, error:'STRIPE_SECRET_KEY not set' });
  var id = params.id || '';
  if (!/^sub_/.test(id)) return jsonResponse({ ok:false, error:'valid subscription id (sub_...) required' });
  var res = UrlFetchApp.fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(id), {
    method: 'delete', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (data.error) return jsonResponse({ ok:false, error: data.error.message });
  log('subscription_cancelled_manual', { id: id, status: data.status });
  return jsonResponse({ ok:true, id: data.id, status: data.status });
}

function diagRecoverSubscription(params) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return jsonResponse({ ok:false, error:'STRIPE_SECRET_KEY not set' });
  const sessionId = params.session_id;
  if (!sessionId) return jsonResponse({ ok:false, error:'session_id required' });

  // 1. Checkout Session 取得
  const ses_res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions/' + sessionId, {
    method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  const session = JSON.parse(ses_res.getContentText());
  if (session.error) return jsonResponse({ ok:false, step:'get_session', error: session.error.message });

  const meta = session.metadata || {};
  const recurringPriceId = meta.recurring_price_id;
  const billingAnchor = meta.billing_anchor;
  if (!recurringPriceId) return jsonResponse({ ok:false, step:'metadata', error:'recurring_price_id missing from session metadata', meta: meta });
  if (!session.customer) return jsonResponse({ ok:false, step:'session', error:'session.customer is null', session_keys: Object.keys(session) });
  if (!session.payment_intent) return jsonResponse({ ok:false, step:'session', error:'session.payment_intent is null' });

  // 2. 既存 Subscription があるか確認 (重複生成防止)
  const existing_res = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/subscriptions?customer=' + session.customer + '&limit=5',
    { method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true }
  );
  const existing = JSON.parse(existing_res.getContentText());
  if (existing.data && existing.data.length > 0) {
    return jsonResponse({ ok:false, step:'already_exists', subscriptions: existing.data.map(function(s){ return s.id; }) });
  }

  // 3. PaymentIntent から PaymentMethod 取得
  const pi_res = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_intents/' + session.payment_intent, {
    method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  const pi = JSON.parse(pi_res.getContentText());
  if (pi.error) return jsonResponse({ ok:false, step:'get_pi', error: pi.error.message });
  const paymentMethodId = pi.payment_method;
  if (!paymentMethodId) return jsonResponse({ ok:false, step:'pi', error:'payment_method missing on PI' });

  // 4. Subscription 作成
  // 2026-05-27: Stripe API は billing_cycle_anchor の unix timestamp を直接受け取らなくなった。
  // billing_cycle_anchor_config[day_of_month]=20 で「毎月20日に anchor」を指定。
  const subParams = {
    customer: session.customer,
    'items[0][price]': recurringPriceId,
    proration_behavior: 'none',
    default_payment_method: paymentMethodId,
    'billing_cycle_anchor_config[day_of_month]': '20',
    'metadata[plan]': meta.plan || '',
    'metadata[order_number]': meta.order_number || '',
    'metadata[first_payment_session]': session.id,
    'metadata[mode]': 'subscription_recurring',
    'metadata[recovered_from]': 'diag_recover_sub'
  };

  const sub_res = UrlFetchApp.fetch('https://api.stripe.com/v1/subscriptions', {
    method: 'post', payload: subParams,
    headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  const sub = JSON.parse(sub_res.getContentText());
  if (sub.error) return jsonResponse({
    ok: false, step: 'create_sub', error: sub.error.message,
    sent_params: subParams
  });

  return jsonResponse({
    ok: true,
    subscription_id: sub.id,
    status: sub.status,
    customer: sub.customer,
    billing_cycle_anchor: sub.billing_cycle_anchor,
    next_invoice_at: sub.current_period_end
  });
}

/* ============================================================
   🔧 orders 重複行クリーンアップ（①3倍課金の後始末）
   ?action=diag_dedupe_orders            … dry-run（集計のみ・削除しない）
   ?action=diag_dedupe_orders&apply=1    … 実削除（同一 session_id の2行目以降を削除）
   ============================================================
   ・Stripe webhook リトライで finalizeOrder が複数回走り、同じ session_id の
     行が orders シートに2行以上できた分を掃除する。
   ・各 session_id の「最初の1行」を残し、それ以降を削除（下から上へ削除＝行ズレ防止）。
   ・session_id が空の行は対象外（手動投入/旧データを誤削除しない）。
   ・apply 前に必ず dry-run で件数を確認すること。
   ============================================================ */
function diagDedupeOrders(params) {
  var apply = params && (params.apply === '1' || params.apply === 'true');
  var sh = ss().getSheetByName('orders');
  if (!sh) return jsonResponse({ ok:false, error:'orders sheet not found' });
  var data = sh.getDataRange().getValues();
  if (data.length < 3) return jsonResponse({ ok:true, dryRun: !apply, duplicates: 0, note: 'no rows to dedupe' });

  var headers = data[0];
  var sidIdx = headers.indexOf('session_id');
  var onIdx  = headers.indexOf('order_number');
  if (sidIdx === -1) return jsonResponse({ ok:false, error:'session_id column not found' });

  var seen = {};
  var dupRows = []; // 1-based シート行番号
  var dupDetail = [];
  for (var i = 1; i < data.length; i++) {
    var sid = data[i][sidIdx];
    if (!sid) continue; // 空 session_id は触らない
    if (seen[sid]) {
      dupRows.push(i + 1);
      dupDetail.push({ row: i + 1, session_id: sid, order: onIdx >= 0 ? data[i][onIdx] : '' });
    } else {
      seen[sid] = true;
    }
  }

  if (!apply) {
    return jsonResponse({
      ok: true, dryRun: true,
      totalRows: data.length - 1,
      uniqueSessions: Object.keys(seen).length,
      duplicates: dupRows.length,
      sample: dupDetail.slice(0, 20),
      note: 'これは集計のみ。実削除は &apply=1 を付けて再実行。'
    });
  }

  // 実削除: 行ズレ防止のため必ず下から上へ
  dupRows.sort(function(a, b){ return b - a; });
  for (var r = 0; r < dupRows.length; r++) {
    sh.deleteRow(dupRows[r]);
  }
  log('diag_dedupe_orders_applied', { removed: dupRows.length });
  return jsonResponse({ ok:true, dryRun:false, removed: dupRows.length, detail: dupDetail.slice(0, 50) });
}

/* ============================================================
   🔧 Webhook URL を更新 (1-shot 操作)
   ?action=diag_update_webhook&webhook_id=we_xxx&new_url=https://...
   ============================================================ */
function diagUpdateWebhook(params) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return jsonResponse({ ok:false, error:'STRIPE_SECRET_KEY not set' });
  if (!params.webhook_id || !params.new_url) {
    return jsonResponse({ ok:false, error:'webhook_id and new_url required' });
  }
  var res = UrlFetchApp.fetch('https://api.stripe.com/v1/webhook_endpoints/' + params.webhook_id, {
    method: 'post',
    payload: { url: params.new_url },
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (data.error) return jsonResponse({ ok:false, error: data.error.message });
  return jsonResponse({ ok:true, id: data.id, url: data.url, status: data.status });
}

/* ============================================================
   🔧 Checkout Session を PaymentIntent ID で逆引き
   ?action=diag_find_session&payment_intent=pi_xxx
   ============================================================ */
function diagFindSession(params) {
  var STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!params.payment_intent) return jsonResponse({ ok:false, error:'payment_intent required' });
  var res = UrlFetchApp.fetch(
    'https://api.stripe.com/v1/checkout/sessions?payment_intent=' + params.payment_intent + '&limit=5',
    { method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true }
  );
  var data = JSON.parse(res.getContentText());
  if (data.error) return jsonResponse({ ok:false, error: data.error.message });
  return jsonResponse({
    ok: true,
    sessions: (data.data || []).map(function(s){
      return {
        id: s.id, status: s.status, payment_status: s.payment_status,
        customer: s.customer, metadata: s.metadata, amount_total: s.amount_total
      };
    })
  });
}

function createDelayedSubscription(session, meta) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) throw new Error('Stripe not configured');
  if (!session.customer) throw new Error('No customer on session');
  if (!session.payment_intent) throw new Error('No payment_intent on session');

  // PaymentIntent から saved PaymentMethod を取得
  const piRes = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_intents/' + session.payment_intent, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  const pi = JSON.parse(piRes.getContentText());
  if (pi.error) throw new Error('PI retrieval: ' + pi.error.message);
  const paymentMethodId = pi.payment_method;
  if (!paymentMethodId) throw new Error('No payment_method on PaymentIntent');

  // (b) 冪等性ガード: 同一顧客に同じ price の active サブスクが既にあれば二重作成しない。
  //     webhook 二重発火で同一定期便サブスクが2本でき二重課金になる事故(ry ¥6,980×2)の再発防止。fail-open。
  try {
    const existRes = UrlFetchApp.fetch(
      'https://api.stripe.com/v1/subscriptions?customer=' + session.customer + '&status=active&limit=20',
      { method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true }
    );
    const exist = JSON.parse(existRes.getContentText());
    if (exist && exist.data && exist.data.length) {
      const dup = exist.data.filter(function (s) {
        return s.items && s.items.data && s.items.data.some(function (it) { return it.price && it.price.id === meta.recurring_price_id; });
      });
      if (dup.length) {
        log('subscription_create_skipped_dup', { customer: session.customer, existing: dup[0].id, order: meta.order_number });
        return dup[0];
      }
    }
  } catch (e) { /* ガード照会失敗時は従来どおり作成 (fail-open) */ }

  // Subscription 作成 (anchor=毎月20日, proration=none, 初回課金なし)
  // 2026-05-27: Stripe 新API仕様により billing_cycle_anchor_config[day_of_month] を使用
  const subParams = {
    customer: session.customer,
    'items[0][price]': meta.recurring_price_id,
    'billing_cycle_anchor_config[day_of_month]': '20',
    proration_behavior: 'none',
    default_payment_method: paymentMethodId,
    'metadata[plan]': meta.plan,
    'metadata[order_number]': meta.order_number,
    'metadata[first_payment_session]': session.id,
    'metadata[mode]': 'subscription_recurring'
  };

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/subscriptions', {
    method: 'post',
    payload: subParams,
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  const sub = JSON.parse(res.getContentText());
  if (sub.error) throw new Error('Subscription create: ' + sub.error.message);

  log('subscription_created_delayed', {
    subscription_id: sub.id,
    customer: session.customer,
    anchor: meta.billing_anchor,
    plan: meta.plan,
    order: meta.order_number
  });

  return sub;
}

/* ============================================================
   POST: LINE Messaging API Webhook（友だち追加 / メッセージ / postback）
   ============================================================
   ・LINE は ?action= を付けず body={ destination, events:[...] } を送る。
   ・friend追加(follow) → 歓迎メッセージ push ＋ customers に会員行を自動作成。
     これが無いと「新規が友だち追加しても会員化されない/連携導線が出ない」状態になる。
   ・前提: LINE Developers Console (Messaging APIチャネル) の Webhook URL を
     この GAS の /exec に向け、Webhookの利用を ON にする（Tom 側設定）。
   ・制約: GAS は x-line-signature ヘッダを読めないため署名検証は不可。
     follow は金銭フローではない(顧客行作成+自分宛pushのみ)ため許容。
   ============================================================ */
function handleLineWebhook(body) {
  try {
    var events = (body && body.events) || [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var type = ev && ev.type;
      if (type === 'follow') {
        handleLineFollow_(ev);
      } else if (type === 'unfollow') {
        handleLineUnfollow_(ev);
      } else if (type === 'message') {
        // 友だち追加後にメッセージが来ても無言にならないよう簡易応答（連携導線を案内）
        try {
          var liffId = cfg('LIFF_ID', '1657458587-mz1dR9e6');
          replyLineMessage_(ev.replyToken,
            'お問い合わせありがとうございます。\n' +
            'マイページ（ご注文・配送状況の確認）はこちら:\n' +
            'https://liff.line.me/' + liffId + '/mypage.html');
        } catch (e1) {}
      }
    }
  } catch (e) {
    log('line_webhook_error', { error: e.message });
  }
  // LINE には常に 200 を返す（Verify ボタンの空イベントもここを通る）
  return jsonResponse({ ok: true });
}

/* friend追加: line_uid で customers を引き、無ければ会員行を作成して歓迎 push */
function handleLineFollow_(ev) {
  var uid = ev.source && ev.source.userId;
  if (!uid) return;

  var profile = getLineProfile_(uid) || {};
  var displayName = profile.displayName || '';

  var sh = sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  function ensureCol(name) {
    var idx = headers.indexOf(name);
    if (idx === -1) { idx = headers.length; sh.getRange(1, idx + 1).setValue(name); headers.push(name); }
    return idx;
  }
  var lineIdx     = ensureCol('line_uid');
  var nameIdx     = ensureCol('name');
  var lineNameIdx = ensureCol('line_name');
  var linkedAtIdx = ensureCol('linked_at');
  var sourceIdx   = ensureCol('source');

  // 既存 line_uid → 表示名だけ更新して終了（重複作成しない）
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][lineIdx]) === String(uid)) {
      if (displayName) sh.getRange(i + 1, lineNameIdx + 1).setValue(displayName);
      log('line_follow_existing', { uid: uid });
      sendLinePush(uid, [buildFollowWelcomeMessage(displayName)]);
      return;
    }
  }

  // 新規 → 会員行作成（購入0・LINEのみ会員）
  var row = new Array(headers.length).fill('');
  row[headers.indexOf('customer_id')] = Utilities.getUuid();
  row[nameIdx]     = displayName;
  row[lineIdx]     = uid;
  row[lineNameIdx] = displayName;
  row[linkedAtIdx] = new Date();
  row[sourceIdx]   = 'LINE友だち追加';
  row[headers.indexOf('total_spent')] = 0;
  row[headers.indexOf('order_count')] = 0;
  sh.appendRow(row);
  log('line_follow_new', { uid: uid, name: displayName });

  sendLinePush(uid, [buildFollowWelcomeMessage(displayName)]);
}

/* unfollow（ブロック）: source 列にタグを残す（行は消さない） */
function handleLineUnfollow_(ev) {
  var uid = ev.source && ev.source.userId;
  if (!uid) return;
  try {
    var sh = ss().getSheetByName('customers');
    if (!sh) return;
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var lineIdx = headers.indexOf('line_uid');
    var srcIdx = headers.indexOf('source');
    if (lineIdx === -1) return;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][lineIdx]) === String(uid)) {
        if (srcIdx >= 0) sh.getRange(i + 1, srcIdx + 1).setValue('ブロック');
        break;
      }
    }
  } catch (e) { log('line_unfollow_error', { error: e.message }); }
}

/* LINE プロフィール取得（Messaging API・LINE_CHANNEL_TOKEN 必須） */
function getLineProfile_(uid) {
  var token = cfg('LINE_CHANNEL_TOKEN');
  if (!token) return null;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + uid, {
      method: 'get', headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
  } catch (e) { log('get_line_profile_error', { error: e.message }); }
  return null;
}

/* reply（応答トークン使用・LINE_CHANNEL_TOKEN 必須） */
function replyLineMessage_(replyToken, text) {
  var token = cfg('LINE_CHANNEL_TOKEN');
  if (!token || !replyToken) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
  } catch (e) { log('line_reply_error', { error: e.message }); }
}

/* 友だち追加の歓迎メッセージ（マイページ＝LIFF・購入連携＝LIFF の2導線） */
function buildFollowWelcomeMessage(customerName) {
  var liffId = cfg('LIFF_ID', '1657458587-mz1dR9e6');
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  return {
    type: 'flex',
    altText: '友だち追加ありがとうございます — 江田畜産',
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: [
          { type: 'text', text: '友だち追加ありがとうございます🐂', weight: 'bold', size: 'md', color: '#0F3D2E', wrap: true },
          { type: 'text', text: greeting + '、江田畜産の公式LINEへようこそ。ご注文状況の確認・発送のお知らせ・会員限定のご案内をお届けします。', size: 'sm', color: '#666666', wrap: true }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', color: '#0F3D2E', height: 'sm',
            action: { type: 'uri', label: 'マイページを開く', uri: 'https://liff.line.me/' + liffId + '/mypage.html' } },
          { type: 'button', style: 'link', height: 'sm',
            action: { type: 'uri', label: 'ご購入歴を連携する', uri: 'https://liff.line.me/' + liffId + '/line-link.html' } }
        ]
      }
    }
  };
}

/* ============================================================
   POST: stripe_webhook
   ============================================================ */
function handleStripeWebhook(e) {
  const raw = e.postData && e.postData.contents;

  let event;
  try { event = JSON.parse(raw); } catch (err) {
    return jsonResponse({ ok:false, error: 'Invalid JSON' });
  }

  // ★ 偽造防止（重要）:
  //   GAS の Web アプリは HTTP ヘッダ(Stripe-Signature)を読めないため、本来の HMAC 署名検証ができない。
  //   そこで (1) 任意の共有キー gate と (2) event.id を Stripe API に再照会して実在を確認する、
  //   の2段で「誰でも ?action=stripe_webhook に偽注文 JSON を POST できる」穴を塞ぐ。
  //   検証を通った Stripe 取得データ(verified)を「正」として処理する（payload は信用しない）。
  const STRIPE = cfg('STRIPE_SECRET_KEY');

  // (1) 共有キー gate（任意・後方互換）: WEBHOOK_SHARED_KEY を設定し、Stripe 側 Webhook URL を
  //     ...?action=stripe_webhook&key=XXXX にすると有効化。未設定なら従来どおりスキップ（デプロイで即停止しない）。
  const sharedKey = cfg('WEBHOOK_SHARED_KEY');
  if (sharedKey && (!e.parameter || e.parameter.key !== sharedKey)) {
    log('stripe_webhook_bad_key', { id: event && event.id });
    return jsonResponse({ ok:false, error: 'unauthorized' });
  }

  // (2) event.id を Stripe に再照会して実在検証 → 取得データを正とする
  let verified = event;
  if (STRIPE && event && typeof event.id === 'string' && event.id.indexOf('evt_') === 0) {
    try {
      const vr = UrlFetchApp.fetch('https://api.stripe.com/v1/events/' + event.id, {
        method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
      });
      if (vr.getResponseCode() === 200) {
        verified = JSON.parse(vr.getContentText());
      } else {
        // Stripe に存在しない event = 偽造の疑い → 拒否（Stripe は本物なら最大3日リトライするので取りこぼさない）
        log('stripe_webhook_forgery_rejected', { id: event.id, code: vr.getResponseCode() });
        return jsonResponse({ ok:false, error: 'event not found on Stripe' });
      }
    } catch (verr) {
      log('stripe_webhook_verify_error', { id: event.id, error: verr.message });
      return jsonResponse({ ok:false, error: 'verify failed' });
    }
  }

  log('stripe_webhook_' + verified.type, { id: verified.id });

  try {
    switch (verified.type) {
      case 'checkout.session.completed':
        return finalizeOrder(verified.data.object);
      case 'customer.subscription.created':
        return logSubscriptionCreated(verified.data.object);
      case 'customer.subscription.deleted':
        return logSubscriptionCancelled(verified.data.object);
      case 'invoice.payment_succeeded':
        return logInvoicePaid(verified.data.object);
      default:
        return jsonResponse({ ok:true, ignored: verified.type });
    }
  } catch (err) {
    log('stripe_webhook_error', { type: verified.type }, { error: err.message });
    return jsonResponse({ ok:false, error: err.message });
  }
}

function finalizeOrder(session) {
  // pending_orders から該当を引いてきて、完了処理
  const sh = sheet('orders', [
    'order_number','placed_at','session_id','customer_name','customer_email','customer_phone',
    'mode','total','shipping','payment_status','payment_method',
    'destinations_json','items_json','metadata_json','line_uid','line_name','contact_method'
  ]);
  const meta = session.metadata || {};
  const orderNum = meta.order_number || ('SESSION-' + session.id.slice(-8));
  const total = session.amount_total || 0;

  // ★ 冪等性ガード: Stripe は webhook を複数回配信する(リトライ仕様)。ガードが無いと
  //   配信回数ぶん「確認メール・スタッフ通知・orders行追加・在庫減算」が多重実行される。
  //   (2026-05-30 EDA-20260530-DC5B5E で確認メール4通/在庫4重減算/orders重複行が発生)
  //   ScriptLock で check→append を直列化し、同一 session_id が既に処理済みなら即 200 で返す。
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    log('finalize_lock_timeout', { session: session.id });
    return jsonResponse({ ok: false, error: 'lock timeout' });
  }
  try {
    const existingRows = sh.getDataRange().getValues();
    for (var r = 1; r < existingRows.length; r++) {
      if (existingRows[r][2] === session.id) {   // col index 2 = session_id
        log('finalize_duplicate_skipped', { session: session.id, order: existingRows[r][0] });
        return jsonResponse({ ok: true, duplicate: true, order: existingRows[r][0] });
      }
    }

    // items_json を確実に保存: metadata.items_json が空(ギフト等で商品が destinations 側)なら
    //   destinations[].items から導出して記録する（旧コードは存在しないキー line_items_json を読み空保存だった）
    var itemsJsonOut = meta.items_json || meta.line_items_json || '[]';
    try {
      var _pj = JSON.parse(itemsJsonOut);
      if (!Array.isArray(_pj) || _pj.length === 0) {
        var _dd = JSON.parse(meta.destinations_json || '[]'); var _arr = [];
        (_dd || []).forEach(function (d) { (d.items || []).forEach(function (it) { _arr.push({ title: it.title || it.name || '', variant: it.variant || '', qty: it.qty || it.quantity || 1 }); }); });
        if (_arr.length) itemsJsonOut = JSON.stringify(_arr);
      }
    } catch (e) { /* itemsJsonOut はそのまま */ }

    sh.appendRow([
      orderNum,
      new Date(),
      session.id,
      meta.customer_name || '',
      session.customer_details && session.customer_details.email,
      meta.customer_phone || '',
      meta.mode || 'single',
      total,
      0, // shipping calculated separately
      session.payment_status,
      (session.payment_method_types && session.payment_method_types[0]) || 'card',
      meta.destinations_json || '[]',
      itemsJsonOut,
      JSON.stringify(meta),
      meta.line_uid || '',   // ★ LINE 連携: orders に line_uid を直接記録
      meta.line_name || '',
      meta.contact_method || ''
    ]);

    // 配送希望日/時間帯を orders に記録。列が無ければ row1 に追加 (staffShip の tracking_number と同じ防御)。
    //   appendRow は固定列のため、後付け列(tracking_number等)とのズレを避けて名前解決で書く。
    //   日付は setNumberFormat('@') で強制テキスト → Sheets の日付自動変換による前日ズレ(JST→UTC)を防止。
    try {
      if (meta.delivery_date || meta.delivery_time) {
        var _hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        var _appended = sh.getLastRow();
        var _ensureCol = function (name) {
          var idx = _hdr.indexOf(name);
          if (idx === -1) { sh.getRange(1, _hdr.length + 1).setValue(name); _hdr.push(name); idx = _hdr.length - 1; }
          return idx + 1;
        };
        if (meta.delivery_date) { var _cd = sh.getRange(_appended, _ensureCol('delivery_date')); _cd.setNumberFormat('@'); _cd.setValue(meta.delivery_date); }
        if (meta.delivery_time) { var _ct = sh.getRange(_appended, _ensureCol('delivery_time')); _ct.setNumberFormat('@'); _ct.setValue(meta.delivery_time); }
      }
    } catch (e) { log('delivery_write_error', { order: orderNum, error: e.message }); }
  } finally {
    lock.releaseLock();
  }

  // 顧客への受注通知 (①注文確定):
  //   LINE 連携済み → LINE で簡潔に送り、メールは送らない (Tom 指示: LINE繋がってる方はメールNG)。
  //   未連携、または LINE 送信失敗時 → メールで送る (顧客が無通知になるのを防ぐフォールバック)。
  //   line_uid は決済metadata優先。無ければ email で customers を逆引き
  //   (LINE友だちだがWeb経由でemail決済した既存客もメールにしないため)。
  var custEmailForLine = (session.customer_details && session.customer_details.email) || '';
  var lineUid = (meta.line_uid && String(meta.line_uid).trim()) || lineUidForEmail(custEmailForLine);
  var linePushed = false;
  if (lineUid) {
    linePushed = sendLinePush(lineUid, [buildOrderConfirmMessage(
      meta.customer_name || '', orderNum, total
    )]);
  }
  if (!linePushed) {
    sendCustomerReceiptEmail(session, orderNum);
  }
  // スタッフ通知は常にメール (社内オペ用)
  sendStaffNotificationEmail(session, orderNum);

  // 顧客マスタ upsert (LINE 連携情報も保存)
  upsertCustomer({
    email: session.customer_details && session.customer_details.email,
    name: meta.customer_name,
    phone: meta.customer_phone,
    line_uid: meta.line_uid || '',
    line_name: meta.line_name || '',
    last_order: orderNum,
    last_order_total: total,
    last_order_at: new Date()
  });

  // ★ 在庫を decrement (payment_status='paid' のみ)
  if (session.payment_status === 'paid') {
    try {
      decrementStockAfterOrder(session, meta);
    } catch (e) {
      log('stock_decrement_error', { error: e.message, order: orderNum });
    }
  }

  // ★ 定期便初月決済完了の場合: Subscription を生成（毎月20日 anchor）
  //    Tom 指示「翌月の決済は二十日になる。当月は日を問わない」を実装
  if (meta.mode === 'subscription_first_month' && session.payment_status === 'paid') {
    try {
      createDelayedSubscription(session, meta);
    } catch (e) {
      log('subscription_create_error', {
        error: e.message,
        session: session.id,
        order: orderNum
      });
      // 失敗してもオーダー記録は完了させる。Tom に email でアラート推奨
      try {
        MailApp.sendEmail({
          to: cfg('STAFF_NOTIFICATION_EMAIL') || 'tomoki@eda-livestock.com',
          subject: '⚠ 定期便Subscription生成失敗',
          body: 'Order: ' + orderNum + '\nSession: ' + session.id + '\nError: ' + e.message +
                '\n\n手動で Stripe Dashboard から Subscription 作成が必要です。'
        });
      } catch (e2) {}
    }
  }

  /* 📊 Analytics: purchase イベント記録 */
  try { logPurchaseEvent(session); } catch (e) {}

  return jsonResponse({ ok:true, order: orderNum });
}

/* ============================================================
   注文確定後に products シートの stock を減算
   ・metadata に items_json があれば使う (未保存の場合は line_items から取得)
   ・1つ=1, 2つセット=2, 3つセット=3 のユニット換算
   ============================================================ */
function decrementStockAfterOrder(session, meta) {
  const sh = ss().getSheetByName('products');
  if (!sh) return;
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0];
  const titleIdx = headers.indexOf('name');
  const stockIdx = headers.indexOf('stock');
  if (titleIdx === -1 || stockIdx === -1) return;

  function variantUnits(variant) {
    if (!variant) return 1;
    if (String(variant).indexOf('3つ') >= 0) return 3;
    if (String(variant).indexOf('2つ') >= 0) return 2;
    return 1;
  }

  let items = [];
  try {
    items = JSON.parse(meta.items_json || '[]');
  } catch (e) {}
  if (!items.length) return;

  // title ごとに必要ユニットを集計
  const unitsByTitle = {};
  items.forEach(it => {
    const t = it.title || it.name || '';
    const u = variantUnits(it.variant) * (it.qty || 1);
    unitsByTitle[t] = (unitsByTitle[t] || 0) + u;
  });

  // products シートの該当行を減算
  for (let i = 1; i < data.length; i++) {
    const title = data[i][titleIdx];
    const consumed = unitsByTitle[title];
    if (consumed > 0) {
      const cur = Number(data[i][stockIdx]) || 0;
      const next = Math.max(0, cur - consumed);
      sh.getRange(i + 1, stockIdx + 1).setValue(next);
    }
  }
}

function logSubscriptionCreated(sub) {
  const sh = sheet('subscriptions', [
    'subscription_id','customer_id','plan','status','started_at','current_period_end','metadata_json'
  ]);
  sh.appendRow([
    sub.id,
    sub.customer,
    (sub.metadata && sub.metadata.plan) || '',
    sub.status,
    new Date(sub.created * 1000),
    new Date(sub.current_period_end * 1000),
    JSON.stringify(sub.metadata || {})
  ]);
  return jsonResponse({ ok:true });
}

function logSubscriptionCancelled(sub) {
  const sh = sheet('subscriptions');
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === sub.id) {
      sh.getRange(i+1, 4).setValue('cancelled');
      sh.getRange(i+1, 7).setValue(JSON.stringify({ cancelled_at: new Date() }));
      break;
    }
  }
  return jsonResponse({ ok:true });
}

function logInvoicePaid(inv) {
  const sh = sheet('invoices', ['invoice_id','subscription_id','customer','amount_paid','paid_at']);
  sh.appendRow([inv.id, inv.subscription || '', inv.customer || '', inv.amount_paid, new Date(inv.created * 1000)]);
  return jsonResponse({ ok:true });
}

/* ============================================================
   GET: order_status
   ============================================================ */
function orderStatus(sessionId) {
  if (!sessionId) return jsonResponse({ ok:false, error: 'session_id required' });

  // まず orders から探す
  const sh = sheet('orders');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === sessionId) {
      const order = {};
      headers.forEach((h, idx) => { order[h] = data[i][idx]; });
      return jsonResponse({ ok:true, order: order });
    }
  }

  // 見つからなければ Stripe から取得
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return jsonResponse({ ok:false, error: 'Not found and Stripe not configured' });

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions/' + sessionId, {
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });
  const session = JSON.parse(res.getContentText());
  if (session.error) return jsonResponse({ ok:false, error: session.error.message });

  return jsonResponse({
    ok: true,
    order: {
      session_id: session.id,
      order_number: (session.metadata && session.metadata.order_number) || sessionId,
      payment_status: session.payment_status,
      total: session.amount_total,
      customer_email: session.customer_details && session.customer_details.email,
      mode: (session.metadata && session.metadata.mode) || 'single'
    }
  });
}

/* ============================================================
   POST: submit_order / submit_quiz / submit_survey / log_subscription_application
   ============================================================ */
function submitOrder(body) {
  const sh = sheet('pre_orders', ['ts','order_number','mode','customer_json','destinations_json','total','quiz_json']);
  sh.appendRow([
    new Date(),
    body.order_number || '',
    body.mode || 'single',
    JSON.stringify(body.customer || {}),
    JSON.stringify(body.destinations || []),
    body.total || 0,
    JSON.stringify(body.quiz || null)
  ]);
  return jsonResponse({ ok:true });
}

function submitQuiz(body) {
  const sh = sheet('quiz_responses', ['ts','session_id','fam','freq','meat','use','budget','answers_json']);
  sh.appendRow([
    new Date(),
    body.sessionId || '',
    body.fam || '',
    body.freq || '',
    body.meat || '',
    body.use || '',
    body.budget || '',
    JSON.stringify(body.answers || [])
  ]);
  return jsonResponse({ ok:true });
}

function submitSurvey(body) {
  const sh = sheet('survey_responses', ['ts','session_id','order_number','organic','source','meats_json']);
  sh.appendRow([
    new Date(),
    body.session_id || '',
    body.order_number || '',
    body.organic || '',
    body.source || '',
    JSON.stringify(body.meats || [])
  ]);
  return jsonResponse({ ok:true });
}

function logClientError(body) {
  const sh = sheet('client_errors', ['ts','type','message','url','source','line','col','stack','ua']);
  sh.appendRow([
    new Date(),
    body.type || '',
    (body.message || '').slice(0, 500),
    body.url || '',
    body.source || '',
    body.line || '',
    body.col || '',
    (body.stack || '').slice(0, 2000),
    (body.ua || '').slice(0, 300)
  ]);
  return jsonResponse({ ok:true });
}

function logSubscriptionApplication(body) {
  const sh = sheet('subscription_applications', ['ts','plan','customer_json','addons_json']);
  sh.appendRow([
    new Date(),
    body.plan || '',
    JSON.stringify(body.customer || {}),
    JSON.stringify(body.addons || [])
  ]);
  return jsonResponse({ ok:true });
}

/* ============================================================
   POST: request_otp / verify_otp (マイページ認証)
   ============================================================ */
function requestOtp(body) {
  if (!body.email) throw new Error('email required');
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const sh = sheet('otps', ['email','otp','expires_at','used']);
  sh.appendRow([body.email, otp, new Date(Date.now() + 10*60*1000), false]); // 10分有効

  MailApp.sendEmail({
    to: body.email,
    subject: '【江田畜産】ログイン用 6桁コード',
    body: '江田畜産マイページ ログイン用コード:\n\n' + otp + '\n\n' +
          'このコードは 10 分間有効です。\n心当たりがない場合はこのメールを破棄してください。\n\n' +
          '江田畜産株式会社\nhttps://eda-livestock.com/'
  });
  return jsonResponse({ ok:true, expires_in: 600 });
}

function verifyOtp(body) {
  // フロントは "code" を送るが旧仕様 "otp" もサポート
  const code = body.code || body.otp;
  if (!body.email || !code) throw new Error('email and code required');
  const sh = sheet('otps');
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === body.email && String(data[i][1]) === String(code) && !data[i][3] && new Date(data[i][2]) > new Date()) {
      sh.getRange(i+1, 4).setValue(true); // used
      const orders = getOrdersByEmail(body.email);
      const customer = getCustomerByEmail(body.email, orders);
      const token = Utilities.base64Encode(body.email + ':' + Utilities.getUuid());
      attachCardToCustomer(customer, orders);
      return jsonResponse({ ok:true, success: true, token: token, customer: customer, orders: orders });
    }
  }
  return jsonResponse({ ok:false, success: false, error: 'Invalid or expired OTP' });
}

function getOrdersByEmail(email) {
  try {
    const sh = sheet('orders');
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0];
    const emailIdx = headers.indexOf('customer_email');
    if (emailIdx === -1) return [];
    const orders = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailIdx] === email) {
        const o = {};
        headers.forEach((h, idx) => { o[h] = data[i][idx]; });
        // items が JSON 文字列の場合はパース
        if (typeof o.items === 'string') {
          try { o.items = JSON.parse(o.items); } catch (_) { o.items = []; }
        }
        // mypage は o.status を見るが orders シートは payment_status 列のみ → 正規化して補完。
        //   発送済(伝票番号あり or payment_status=shipped/delivered)→ shipped/delivered、それ以外は pending(発送準備中)。
        //   これが無いと「発送前なのに発送済」誤表示・履歴バッジが常に準備中、になる(配送希望日機能で顕在化)。
        var _ps = String(o.payment_status || '').toLowerCase();
        o.status = (_ps === 'shipped' || _ps === 'delivered') ? _ps : (o.tracking_number ? 'shipped' : 'pending');
        orders.push(o);
      }
    }
    return orders.reverse().slice(0, 50);
  } catch (e) {
    return [];
  }
}

function getCustomerByEmail(email, ordersHint) {
  // customers マスタから取得 (なければ orders から集計)
  try {
    const sh = ss().getSheetByName('customers');
    if (sh) {
      const data = sh.getDataRange().getValues();
      if (data.length >= 2) {
        const headers = data[0];
        const emailIdx = headers.indexOf('email');
        for (let i = 1; i < data.length; i++) {
          if (data[i][emailIdx] === email) {
            const c = {};
            headers.forEach((h, idx) => { c[h] = data[i][idx]; });
            // 集計情報を ordersHint から補完
            if (ordersHint && ordersHint.length) {
              c.total_orders = ordersHint.length;
              c.total_spent = ordersHint.reduce((s, o) => s + (Number(o.total) || 0), 0);
            }
            return c;
          }
        }
      }
    }
  } catch (e) { /* fallthrough */ }
  // orders だけから生成
  const orders = ordersHint || getOrdersByEmail(email);
  const c = { email: email, name: email.split('@')[0] };
  c.total_orders = orders.length;
  c.total_spent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  // 直近注文の名前を使う
  if (orders.length && orders[0].customer_name) c.name = orders[0].customer_name;
  return c;
}

/* ============================================================
   カード情報を Stripe から取得（マイページ表示用）
   - 注文の session_id（cs_...）から Checkout Session → PaymentIntent →
     PaymentMethod / Charge の card を取得し brand/last4/exp を返す。
   - CacheService で session 単位にキャッシュ（カード情報は不変・6h）。
   - 取得不可なら null（マイページは「カード未登録」へフォールバック）。失敗しても決して throw しない。
   ============================================================ */
function getCardInfoFromOrders(orders) {
  try {
    if (!orders || !orders.length) return null;
    var STRIPE = cfg('STRIPE_SECRET_KEY');
    if (!STRIPE) return null;
    // 最新の注文（getOrdersByEmail は reverse 済 = 先頭が最新）から cs_ セッションを探す
    var sessionId = '';
    for (var i = 0; i < orders.length; i++) {
      var sid = String((orders[i] || {}).session_id || '');
      if (sid.indexOf('cs_') === 0) { sessionId = sid; break; }
    }
    if (!sessionId) return null;
    var cache = CacheService.getScriptCache();
    var ckey = 'cardinfo_' + sessionId;
    var hit = cache.get(ckey);
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
    var url = 'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId) +
              '?expand[]=payment_intent.payment_method&expand[]=payment_intent.latest_charge';
    var res = UrlFetchApp.fetch(url, { method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true });
    var session = JSON.parse(res.getContentText());
    if (!session || session.error) return null;
    var pi = session.payment_intent || {};
    var card = (pi.payment_method && pi.payment_method.card) ||
               (pi.latest_charge && pi.latest_charge.payment_method_details && pi.latest_charge.payment_method_details.card) || null;
    if (!card || !card.last4) return null;
    var mm = card.exp_month ? ('0' + card.exp_month).slice(-2) : '';
    var yy = card.exp_year ? String(card.exp_year).slice(-2) : '';
    var info = { brand: card.brand || '', last4: String(card.last4), exp: (mm && yy) ? (mm + '/' + yy) : '' };
    try { cache.put(ckey, JSON.stringify(info), 21600); } catch (e) {}
    return info;
  } catch (e) {
    return null;
  }
}

/* customer に card_brand/card_last4/card_exp を付与（既にあれば何もしない・失敗しても customer をそのまま返す） */
function attachCardToCustomer(customer, orders) {
  try {
    if (!customer || customer.card_last4) return customer;
    // 保存カード(Stripe Customer の payment method)優先 → 無ければ直近注文の charge から
    var ci = (customer.email ? getSavedCardForEmail(customer.email) : null) || getCardInfoFromOrders(orders);
    if (ci && ci.last4) {
      customer.card_brand = ci.brand;
      customer.card_last4 = ci.last4;
      customer.card_exp = ci.exp;
    }
  } catch (e) {}
  return customer;
}

/* email から Stripe Customer を検索（無ければ作成）。cus_ id を返す。失敗時は ''。 */
function getOrCreateStripeCustomer(email, name) {
  var STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE || !email) return '';
  var listRes = UrlFetchApp.fetch('https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=1', {
    method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  var list = JSON.parse(listRes.getContentText());
  if (list && list.data && list.data.length) return list.data[0].id;
  var createRes = UrlFetchApp.fetch('https://api.stripe.com/v1/customers', {
    method: 'post', payload: flattenForm({ email: email, name: name || '' }),
    headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  var created = JSON.parse(createRes.getContentText());
  return (created && created.id) ? created.id : '';
}

/* (A) Stripe Customer に保存されたカード(既定 payment method / card)を返す。
   - マイページ表示の最優先ソース（顧客が start_card_setup や決済で保存したカード）。
   - 取得不可なら null。CacheService 300s（カード変更後の鮮度を確保）。失敗しても throw しない。 */
function getSavedCardForEmail(email) {
  try {
    var STRIPE = cfg('STRIPE_SECRET_KEY');
    if (!STRIPE || !email) return null;
    var cache = CacheService.getScriptCache();
    var ckey = 'savedcard_' + email;
    var hit = cache.get(ckey);
    if (hit) { try { var p = JSON.parse(hit); return p && p.__none ? null : p; } catch (e) {} }
    var listRes = UrlFetchApp.fetch('https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=1', {
      method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
    });
    var list = JSON.parse(listRes.getContentText());
    if (!list || !list.data || !list.data.length) { cache.put(ckey, JSON.stringify({ __none: true }), 300); return null; }
    var cus = list.data[0];
    var card = null;
    var pmId = cus.invoice_settings && cus.invoice_settings.default_payment_method;
    if (pmId) {
      var pmRes = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_methods/' + pmId, {
        method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
      });
      var pm = JSON.parse(pmRes.getContentText());
      if (pm && pm.card) card = pm.card;
    }
    if (!card) {
      var pmsRes = UrlFetchApp.fetch('https://api.stripe.com/v1/payment_methods?customer=' + cus.id + '&type=card&limit=1', {
        method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
      });
      var pms = JSON.parse(pmsRes.getContentText());
      if (pms && pms.data && pms.data.length) card = pms.data[0].card;
    }
    if (!card || !card.last4) { cache.put(ckey, JSON.stringify({ __none: true }), 300); return null; }
    var mm = card.exp_month ? ('0' + card.exp_month).slice(-2) : '';
    var yy = card.exp_year ? String(card.exp_year).slice(-2) : '';
    var info = { brand: card.brand || '', last4: String(card.last4), exp: (mm && yy) ? (mm + '/' + yy) : '' };
    cache.put(ckey, JSON.stringify(info), 300);
    return info;
  } catch (e) {
    return null;
  }
}

/* ============================================================
   POST start_card_setup { email, line_uid, return_url }
   - 顧客が自分でカードを登録/差し替えできるよう、Stripe Checkout(mode=setup)の
     ホスト画面 URL を発行する。カード番号は Stripe 側でのみ入力＝当社は非保持(PCI安全)。
   - email から Stripe Customer を検索/作成し、そこへ紐付ける(将来の決済で再利用可)。
   - 返り値: { ok:true, url }。失敗は { ok:false, error }。
   ============================================================ */
function startCardSetup(body) {
  try {
    var email = (body && body.email) ? String(body.email).trim() : '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return jsonResponse({ ok:false, error:'メールアドレスが不正です' });
    }
    var STRIPE = cfg('STRIPE_SECRET_KEY');
    if (!STRIPE) return jsonResponse({ ok:false, error:'STRIPE_SECRET_KEY 未設定' });

    // 1) email で Stripe Customer を検索（無ければ作成）
    var cusId = '';
    var listRes = UrlFetchApp.fetch('https://api.stripe.com/v1/customers?email=' + encodeURIComponent(email) + '&limit=1', {
      method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
    });
    var list = JSON.parse(listRes.getContentText());
    if (list && list.data && list.data.length) {
      cusId = list.data[0].id;
    } else {
      var nm = '';
      try { var c = getCustomerByEmail(email, null); nm = (c && c.name) || ''; } catch (e) {}
      var createRes = UrlFetchApp.fetch('https://api.stripe.com/v1/customers', {
        method: 'post', payload: flattenForm({ email: email, name: nm }),
        headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
      });
      var created = JSON.parse(createRes.getContentText());
      if (created.error) return jsonResponse({ ok:false, error:'Stripe(customer): ' + created.error.message });
      cusId = created.id;
    }

    // 2) 戻り先(mypage)。クライアント指定を優先・http(s) のみ許可。
    var ret = (body && body.return_url) ? String(body.return_url) : '';
    if (!/^https?:\/\//i.test(ret)) ret = cfg('CANCEL_URL') || 'https://www.eda-livestock.com/mypage.html';
    var sep = (ret.indexOf('?') >= 0) ? '&' : '?';

    // 3) mode=setup の Checkout Session を生成 → ホスト画面 URL を返す
    var params = flattenForm({
      mode: 'setup',
      customer: cusId,
      payment_method_types: ['card'],
      locale: 'ja',
      success_url: ret + sep + 'card=saved',
      cancel_url: ret + sep + 'card=cancel'
    });
    var res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'post', payload: params,
      headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.error) return jsonResponse({ ok:false, error:'Stripe(session): ' + data.error.message });
    log('start_card_setup', { email: email, customer: cusId });
    return jsonResponse({ ok:true, url: data.url });
  } catch (e) {
    return jsonResponse({ ok:false, error: String(e) });
  }
}

/* GET ?action=customer_lookup&email=xxx (Token認証推奨だが、デモ用に直接ルックアップも可) */
function customerLookup(params) {
  const email = params.email;
  if (!email) return jsonResponse({ success:false, message:'email required' });
  // S3: email形式の検証（不正値・ワイルドカード的入力を弾く）
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
    return jsonResponse({ success:false, message:'invalid email' });
  }
  const requestUid = params.line_uid ? String(params.line_uid).trim() : '';
  const orders = getOrdersByEmail(email);
  const customer = getCustomerByEmail(email, orders);
  // S3 IDOR対策（任意・既定OFF）: ENFORCE_LOOKUP_UID=true のとき、
  //   line_uid 登録済みの顧客は一致する line_uid が無いと照会できない。
  //   既定OFF=従来どおりemailのみで照会可（決済直後の非LINEフォールバックを壊さない）。
  //   LINE導線が安定したら true にして本人確認を強制する。
  if (customer && (cfg('ENFORCE_LOOKUP_UID') === 'true')) {
    const storedUid = customer.line_uid ? String(customer.line_uid).trim() : '';
    if (storedUid && storedUid !== requestUid) {
      log('customer_lookup_denied', { email: email, reason: 'uid_mismatch' });
      return jsonResponse({ success:false, message:'verification required', code:'UID_REQUIRED' });
    }
  }
  log('customer_lookup', { email: email, withUid: !!requestUid });
  attachCardToCustomer(customer, orders);
  return jsonResponse({ success:true, customer: customer, orders: orders });
}

/* ============================================================
   POST: skip_subscription / cancel_subscription
   ============================================================ */
function skipSubscription(body) {
  // 実 Stripe で skip するなら 次回 invoice の period_end 操作が必要だが
  // シンプル運用: スタッフへメール通知 + シート記録
  const sh = sheet('subscription_actions', ['ts','email','action','subscription_id','note']);
  sh.appendRow([new Date(), body.email || '', 'skip', body.subscription_id || '', body.note || '']);

  MailApp.sendEmail({
    to: cfg('STAFF_NOTIFICATION_EMAIL') || 'tomoki@eda-livestock.com',
    subject: '【江田畜産】定期便スキップ申請',
    body: '顧客: ' + body.email + '\n対象: 次回お届け分\n備考: ' + (body.note || '(なし)') + '\n\n手動でStripe側の next invoice をスキップしてください。'
  });
  return jsonResponse({ ok:true });
}

function cancelSubscription(body) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  const sh = sheet('subscription_actions', ['ts','email','action','subscription_id','note']);
  sh.appendRow([new Date(), body.email || '', 'cancel_request', body.subscription_id || '', body.reason || '']);

  // 3ヶ月経過チェック (運用上、手動承認推奨)
  MailApp.sendEmail({
    to: cfg('STAFF_NOTIFICATION_EMAIL') || 'tomoki@eda-livestock.com',
    subject: '【江田畜産】定期便 解約申請',
    body: '顧客: ' + body.email + '\n理由: ' + (body.reason || '(未記入)') + '\n対象: ' + (body.subscription_id || '') +
          '\n\n3ヶ月継続条件を確認の上、Stripe Dashboard から解約してください。'
  });
  return jsonResponse({ ok:true, message: '解約申請を受け付けました。スタッフより 1 営業日以内にご連絡します。' });
}

/* ============================================================
   GET: public_products / dashboard / line_friends
   ============================================================ */
function publicProducts() {
  // products シートがあれば返す、なければ空配列
  try {
    const sh = ss().getSheetByName('products');
    if (sh) {
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      const products = data.slice(1).map(row => {
        const p = {}; headers.forEach((h, idx) => p[h] = row[idx]);
        return p;
      });
      return jsonResponse({ ok:true, products });
    }
  } catch (e) {}
  return jsonResponse({ ok:true, products: [] });
}

/* 全カタログを1回で返す (shop.html の起動時取得を効率化) */
function publicCatalog() {
  const out = { ok: true, products: [], gifts: [], plans: [] };
  try {
    const sh = ss().getSheetByName('products');
    if (sh) {
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      out.products = data.slice(1).map(row => {
        const p = {}; headers.forEach((h, i) => p[h] = row[i]);
        return p;
      });
    }
  } catch (e) {}
  try {
    const sh = ss().getSheetByName('gifts');
    if (sh) {
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      out.gifts = data.slice(1).map(row => {
        const g = {}; headers.forEach((h, i) => g[h] = row[i]);
        return g;
      }).filter(g => g.published === true || g.published === 'TRUE' || g.published === 'true');
    }
  } catch (e) {}
  try {
    const sh = ss().getSheetByName('subscription_plans');
    if (sh) {
      const data = sh.getDataRange().getValues();
      const headers = data[0];
      out.plans = data.slice(1).map(row => {
        const p = {}; headers.forEach((h, i) => p[h] = row[i]);
        return p;
      }).filter(p => p.published === true || p.published === 'TRUE' || p.published === 'true');
    }
  } catch (e) {}
  return jsonResponse(out);
}

/* 経営サマリー（今月売上・注文件数）。
   🔴 売上ルール（2026-05-31 「売上ズレ事件」の恒久対策。詳細 memory/project_eda_dashboard_accuracy.md）:
     1) 同一 order_number の重複行（Stripe webhook 多重発火の名残）は二重計上しない。
     2) 届け先（destinations_json）の無い注文＝テスト/未完了（実際に発送できない）は売上に計上しない。
     3) フロント(dashboard.html)は更にこの集計に頼らず、画面表示中の実注文から売上を再集計する
        （GAS の /exec→googleusercontent リダイレクト応答がキャッシュされ古い値を返すため）。
     4) 金額は必ず Stripe を一次ソースとして照合してから「正しい」と判断する。
   ※ ¥9,440 表示の真因＝実注文¥3,040 ＋ テスト決済¥6,400(顧客cus_Uake) の合算だった。 */
function dashboardSummary(params) {
  const range = params.range || '30d';
  const days = parseInt(range) || 30;
  const since = new Date(Date.now() - days*24*60*60*1000);

  const ordersData = sheet('orders').getDataRange().getValues();
  let revenue = 0, orderCount = 0, customers = {};
  const seenOrders = {}; // 同一 order_number の重複行(webhook多重発火の名残)を二重計上しない
  for (let i = 1; i < ordersData.length; i++) {
    const onum = ordersData[i][0];
    if (onum && seenOrders[onum]) continue;
    if (onum) seenOrders[onum] = true;
    // 届け先の無い注文(=テスト/未完了。実際に発送できない)は売上に計上しない
    var _hasDest = false;
    try { var _dj = JSON.parse(ordersData[i][11] || '[]'); _hasDest = Array.isArray(_dj) && _dj.length > 0; } catch (e) {}
    if (!_hasDest) continue;
    const placedAt = new Date(ordersData[i][1]);
    if (placedAt >= since && ordersData[i][9] === 'paid') {
      revenue += Number(ordersData[i][7]) || 0;
      orderCount++;
      customers[ordersData[i][4]] = true;
    }
  }

  return jsonResponse({
    ok: true,
    overview: {
      revenue: revenue,
      revenueDelta: 0,
      orders: orderCount,
      avg: orderCount ? Math.round(revenue / orderCount) : 0,
      activeSub: 0, // TODO: count from subscriptions sheet
      subDelta: 0,
      mrr: 0,
      line: 0,
      lineDelta: 0,
      lineConvRate: 0,
      quiz: sheet('quiz_responses').getLastRow() - 1,
      quizDelta: 0,
      quizRate: 0
    }
  });
}

/* ============================================================
   LINE 友だち数 — Messaging API Insight 連携
   ============================================================
   Endpoint:
     GET https://api.line.me/v2/bot/insight/followers?date=YYYYMMDD
   Returns:
     { status: 'ready'|'unready', followers, targetedReaches, blocks }
   注:
     - 当日データは提供されない (前日までの集計値)
     - data.status === 'ready' の時のみ有効
     - 1時間 CacheService で API レート対策
   ============================================================ */
function lineFriends() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('line_friends_count');
  if (cached) {
    var c = JSON.parse(cached);
    return jsonResponse({ ok: true, count: c.count, friends: c.count, date: c.date, cached: true });
  }
  var token = cfg('LINE_CHANNEL_TOKEN');
  if (!token) {
    return jsonResponse({ ok: false, count: 0, friends: 0, error: 'LINE_CHANNEL_TOKEN not set' });
  }
  try {
    // 当日データは提供されないので 1〜2 日前まで遡って 'ready' なものを使う
    var dateStr = null;
    var data = null;
    for (var back = 1; back <= 3; back++) {
      var d = new Date();
      d.setDate(d.getDate() - back);
      var yyyy = d.getFullYear();
      var mm = ('0' + (d.getMonth() + 1)).slice(-2);
      var dd = ('0' + d.getDate()).slice(-2);
      var ds = yyyy + mm + dd;
      var res = UrlFetchApp.fetch(
        'https://api.line.me/v2/bot/insight/followers?date=' + ds,
        {
          method: 'get',
          headers: { 'Authorization': 'Bearer ' + token },
          muteHttpExceptions: true
        }
      );
      if (res.getResponseCode() !== 200) continue;
      var body = JSON.parse(res.getContentText() || '{}');
      if (body && body.status === 'ready') {
        data = body;
        dateStr = ds;
        break;
      }
    }
    if (!data) {
      return jsonResponse({ ok: false, count: 0, friends: 0, error: 'LINE insight data not ready' });
    }
    // targetedReaches = ブロック除外の有効フォロワー (公式に「友だち」と呼ばれる数)
    // followers = 累計 (ブロック含む)
    var count = (typeof data.targetedReaches === 'number') ? data.targetedReaches : (data.followers || 0);
    // 1 時間キャッシュ
    cache.put('line_friends_count', JSON.stringify({ count: count, date: dateStr }), 3600);
    return jsonResponse({ ok: true, count: count, friends: count, date: dateStr });
  } catch (e) {
    return jsonResponse({ ok: false, count: 0, friends: 0, error: e.message });
  }
}

/* ============================================================
   Helpers
   ============================================================ */

function collectItems(body) {
  if (body.items && body.items.length) return body.items;
  const items = [];
  (body.destinations || []).forEach(d => {
    (d.items || []).forEach(i => items.push(i));
  });
  return items;
}

/* ============================================================
   在庫検証: products シートから現在在庫を取得して
   カート内の各 item が在庫を超えないかチェック
   返り値: error メッセージ配列 (空 = OK, 非空 = 在庫不足)
   ============================================================ */
function validateStockBeforeCheckout(items) {
  const errors = [];
  try {
    const sh = ss().getSheetByName('products');
    if (!sh) return errors; // sheet 未作成時は fail-open
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return errors;
    const headers = data[0];
    const titleIdx = headers.indexOf('name');
    const variantIdIdx = headers.indexOf('variantId');
    const stockIdx = headers.indexOf('stock');
    if (titleIdx === -1 || stockIdx === -1) return errors;

    // 商品ごとの「ユニット消費」を集計 (1つ=1, 2つセット=2, 3つセット=3)
    function variantUnits(variant) {
      if (!variant) return 1;
      if (String(variant).indexOf('3つ') >= 0) return 3;
      if (String(variant).indexOf('2つ') >= 0) return 2;
      return 1;
    }
    const cartUnitsByTitle = {};
    items.forEach(it => {
      const t = it.title || it.name || '';
      const units = variantUnits(it.variant) * (it.qty || 1);
      cartUnitsByTitle[t] = (cartUnitsByTitle[t] || 0) + units;
    });

    // products シートの stock と比較
    for (let i = 1; i < data.length; i++) {
      const title = data[i][titleIdx];
      const stock = Number(data[i][stockIdx]) || 0;
      const needed = cartUnitsByTitle[title] || 0;
      if (needed > 0 && needed > stock) {
        errors.push(`「${title}」: 在庫 ${stock} 点 / 注文 ${needed} 点 (${needed - stock} 点 不足)`);
      }
    }
  } catch (e) {
    log('stock_validate_error', { error: e.message });
  }
  return errors;
}

function calcShipping(subtotal, pref) {
  if (subtotal >= 11000) return 0; // ¥11,000以上 送料無料
  // 北海道/沖縄は追加料金
  if (pref === '北海道' || pref === '沖縄県') return 2200;
  return 1100;
}

function flattenForm(obj, prefix) {
  const result = {};
  function walk(o, parent) {
    Object.keys(o).forEach(k => {
      const val = o[k];
      const key = parent ? parent + '[' + k + ']' : k;
      if (val === null || val === undefined) return;
      if (Array.isArray(val)) {
        val.forEach((v, i) => {
          if (typeof v === 'object') walk(v, key + '[' + i + ']');
          else result[key + '[' + i + ']'] = String(v);
        });
      } else if (typeof val === 'object') {
        walk(val, key);
      } else {
        result[key] = String(val);
      }
    });
  }
  walk(obj, prefix);
  return result;
}

function recordPendingOrder(orderNum, sessionId, body, subtotal, shipping, mode) {
  const sh = sheet('pending_orders', [
    'created_at','order_number','session_id','mode','customer_json','destinations_json','subtotal','shipping','total'
  ]);
  sh.appendRow([
    new Date(),
    orderNum,
    sessionId,
    mode || 'single',
    JSON.stringify(body.customer || {}),
    JSON.stringify(body.destinations || []),
    subtotal || 0,
    shipping || 0,
    (subtotal || 0) + (shipping || 0)
  ]);
}

function upsertCustomer(c) {
  if (!c.email) return;
  const sh = sheet('customers', [
    'customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at'
  ]);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const emailIdx = headers.indexOf('email');
  const lineIdx  = headers.indexOf('line_uid');
  const lineNameIdx = headers.indexOf('line_name');
  const linkedAtIdx = headers.indexOf('linked_at');

  for (let i = 1; i < data.length; i++) {
    if (data[i][emailIdx] === c.email) {
      sh.getRange(i+1, headers.indexOf('last_order')+1).setValue(c.last_order);
      sh.getRange(i+1, headers.indexOf('total_spent')+1).setValue((Number(data[i][headers.indexOf('total_spent')]) || 0) + (c.last_order_total || 0));
      sh.getRange(i+1, headers.indexOf('order_count')+1).setValue((Number(data[i][headers.indexOf('order_count')]) || 0) + 1);
      // line_uid を併せて保存 (チェックアウト時にLINEセッションから取得)
      if (c.line_uid && lineIdx >= 0) {
        sh.getRange(i+1, lineIdx+1).setValue(c.line_uid);
        if (lineNameIdx >= 0) sh.getRange(i+1, lineNameIdx+1).setValue(c.line_name || '');
        if (linkedAtIdx >= 0) sh.getRange(i+1, linkedAtIdx+1).setValue(new Date());
      }
      return;
    }
  }
  // 新規 row
  const row = new Array(headers.length).fill('');
  row[headers.indexOf('customer_id')] = 'C-' + Utilities.getUuid().slice(0, 8);
  row[emailIdx] = c.email;
  row[headers.indexOf('name')] = c.name || '';
  row[headers.indexOf('phone')] = c.phone || '';
  row[headers.indexOf('first_order')] = c.last_order;
  row[headers.indexOf('last_order')] = c.last_order;
  row[headers.indexOf('total_spent')] = c.last_order_total || 0;
  row[headers.indexOf('order_count')] = 1;
  if (lineIdx >= 0)     row[lineIdx] = c.line_uid || '';
  if (lineNameIdx >= 0) row[lineNameIdx] = c.line_name || '';
  if (linkedAtIdx >= 0 && c.line_uid) row[linkedAtIdx] = new Date();
  sh.appendRow(row);
}

function sendCustomerReceiptEmail(session, orderNum) {
  const email = session.customer_details && session.customer_details.email;
  if (!email) return;
  const total = session.amount_total ? '¥' + Number(session.amount_total).toLocaleString() : '—';

  // ワンタップ LINE 連携リンク: LIFF (line-link.html) にメールを base64 で埋め込む。
  // タップ → LINE 認証 → line_link_account が自動実行され、メール一致で全注文が即連携される。
  // 注文番号も order param で渡す（line-link.html 側で連携完了直後の追跡導線に利用可能）。
  const liffId = cfg('LIFF_ID', '1657458587-mz1dR9e6');
  const lineLinkUrl = 'https://liff.line.me/' + liffId + '/line-link.html'
    + '?e=' + encodeURIComponent(Utilities.base64Encode(email, Utilities.Charset.UTF_8))
    + '&order=' + encodeURIComponent(orderNum);

  MailApp.sendEmail({
    to: email,
    subject: '【江田畜産】ご注文ありがとうございます (' + orderNum + ')',
    body:
      'この度はご注文いただきありがとうございます。\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      ' ご注文番号: ' + orderNum + '\n' +
      ' お支払い額: ' + total + '\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '配送状況は LINE 公式アカウントまたはマイページから随時お知らせいたします。\n\n' +
      '▼ LINE で配送状況を受け取る（タップするだけで連携完了）\n' +
      lineLinkUrl + '\n\n' +
      '▼ マイページ\n' +
      'https://eda-livestock.com/mypage.html\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      '江田畜産株式会社\n' +
      'backoffice@eda-livestock.com\n' +
      'https://eda-livestock.com/\n'
  });
}

function sendStaffNotificationEmail(session, orderNum) {
  const to = cfg('STAFF_NOTIFICATION_EMAIL') || 'backoffice@eda-livestock.com';
  const meta = session.metadata || {};
  const total = '¥' + Number(session.amount_total || 0).toLocaleString();

  MailApp.sendEmail({
    to: to,
    subject: '【新規注文】 ' + orderNum + ' ' + total,
    body:
      '【新規ご注文】\n\n' +
      '注文番号: ' + orderNum + '\n' +
      'モード: ' + (meta.mode || 'single') + '\n' +
      '合計: ' + total + '\n' +
      'お客様: ' + (meta.customer_name || '') + '\n' +
      'メール: ' + (session.customer_details && session.customer_details.email) + '\n' +
      '電話: ' + (meta.customer_phone || '') + '\n\n' +
      '送付先:\n' + (meta.destinations_json || '[]') + '\n\n' +
      'Stripe Session: ' + session.id
  });
}

/* ============================================================
   セットアップユーティリティ (1回だけ実行)
   ============================================================ */
function initSheets() {
  const s = ss(); // SPREADSHEET_ID 未設定なら自動作成 + Script Property 保存
  sheet('orders', ['order_number','placed_at','session_id','customer_name','customer_email','customer_phone','mode','total','shipping','payment_status','payment_method','destinations_json','items_json','metadata_json','line_uid','line_name']);
  sheet('pending_orders', ['created_at','order_number','session_id','mode','customer_json','destinations_json','subtotal','shipping','total']);
  sheet('subscriptions', ['subscription_id','customer_id','plan','status','started_at','current_period_end','metadata_json']);
  sheet('subscription_applications', ['ts','plan','customer_json','addons_json']);
  sheet('subscription_actions', ['ts','email','action','subscription_id','note']);
  sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid']);
  sheet('quiz_responses', ['ts','session_id','fam','freq','meat','use','budget','answers_json']);
  sheet('survey_responses', ['ts','session_id','order_number','organic','source','meats_json']);
  sheet('invoices', ['invoice_id','subscription_id','customer','amount_paid','paid_at']);
  sheet('otps', ['email','otp','expires_at','used']);
  sheet('_logs', ['ts','action','ip','payload','extra']);
  Logger.log('✅ All sheets initialized');
  Logger.log('📊 Spreadsheet URL: ' + s.getUrl());
  Logger.log('📋 ID: ' + s.getId());
  return { ok:true, spreadsheet_url: s.getUrl(), id: s.getId() };
}

/* ============================================================
   ⚡ 一括スクリプトプロパティ設定 (自動デプロイ用)
   ============================================================
   このファンクションを clasp run で 1 回呼ぶだけで全プロパティ設定完了
   STRIPE_SECRET_KEY は別途 Tom が手動入力 (セキュリティ上の理由)
*/
function setupAllProperties() {
  const props = {
    // 新価格 (¥6,980 / ¥12,800 / ¥24,400) — 2026-05-26 レギュラー ¥27,400→¥24,400 整合修正
    // 旧 ¥27,400 (price_1TWAN1GSkhU1UEciXQJyqNet) と ¥39,800 (price_1TW750GSkhU1UEciLLw2gqss) は archive 済み
    STRIPE_PRICE_MINI: 'price_1TWAN0GSkhU1UEciNGZHORc3',
    STRIPE_PRICE_PRO:  'price_1TWAN0GSkhU1UEciKod4PGpk',
    STRIPE_PRICE_VIP:  'price_1TbK7DGSkhU1UEciPsf2dA53',
    // 🔴 2026-05-27: 本番ローンチ完了。DEMO100 (100%OFF) は無効化。
    //                 FIRST50 (50%OFF 初月限定) のみ適用される。
    STRIPE_DEMO_COUPON: '',
    STRIPE_COUPON_50OFF: 'FIRST50',
    STAFF_NOTIFICATION_EMAIL: 'backoffice@eda-livestock.com',
    SUCCESS_URL: 'https://www.eda-livestock.com/order-complete.html',
    CANCEL_URL: 'https://www.eda-livestock.com/checkout.html'
  };
  Object.keys(props).forEach(k => {
    PROPS.setProperty(k, props[k]);
  });
  Logger.log('✅ 一括設定完了: ' + Object.keys(props).join(', '));
  Logger.log('⚠️ 残: STRIPE_SECRET_KEY (Tom 手動入力)');
  return { ok:true, set: Object.keys(props), missing: ['STRIPE_SECRET_KEY'] };
}

/* ============================================================
   LINE LIFF 認証 endpoints
   ============================================================ */

/* POST line_login { line_uid, display_name, picture_url }
   - customers シートで line_uid が一致するレコードを検索
   - 見つかれば customer + orders を返却 (matched: true)
   - なければ { matched: false } を返却 (フロントが連携フォーム表示)
*/
function lineLogin(body) {
  if (!body.line_uid) throw new Error('line_uid required');

  try {
    const sh = ss().getSheetByName('customers');
    if (!sh) {
      sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
      return jsonResponse({ ok:true, matched:false });
    }
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, matched:false });
    const headers = data[0];
    const lineIdx = headers.indexOf('line_uid');
    if (lineIdx === -1) {
      // line_uid 列がなければ追加
      sh.getRange(1, headers.length + 1).setValue('line_uid');
      return jsonResponse({ ok:true, matched:false });
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][lineIdx] === body.line_uid) {
        const customer = {};
        headers.forEach((h, idx) => { customer[h] = data[i][idx]; });
        // 表示名・写真を更新 (LINE側で変更されている可能性)
        if (body.display_name) customer.line_name = body.display_name;
        if (body.picture_url) customer.line_picture = body.picture_url;
        // 注文履歴
        const orders = customer.email ? getOrdersByEmail(customer.email) : [];
        attachCardToCustomer(customer, orders);
        return jsonResponse({ ok:true, matched:true, customer, orders });
      }
    }
    return jsonResponse({ ok:true, matched:false });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* POST line_link_account { line_uid, display_name, email }
   - email で customers/orders を検索
   - 見つかれば line_uid を紐付けて、ダッシュボードに使えるデータ返却
*/
function lineLinkAccount(body) {
  if (!body.line_uid) throw new Error('line_uid required');
  if (!body.email)    throw new Error('email required');

  try {
    // 注文履歴を検索（なくても連携は成功させる）
    const orders = getOrdersByEmail(body.email);

    // customers シートに upsert
    const sh = sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const emailIdx = headers.indexOf('email');
    let lineIdx = headers.indexOf('line_uid');
    if (lineIdx === -1) {
      sh.getRange(1, headers.length + 1).setValue('line_uid');
      lineIdx = headers.length;
    }
    let nameIdx = headers.indexOf('line_name');
    if (nameIdx === -1) {
      sh.getRange(1, headers.length + 2).setValue('line_name');
      nameIdx = headers.length + 1;
    }
    let linkedAtIdx = headers.indexOf('linked_at');
    if (linkedAtIdx === -1) {
      sh.getRange(1, headers.length + 3).setValue('linked_at');
      linkedAtIdx = headers.length + 2;
    }

    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailIdx] === body.email) { foundRow = i + 1; break; }
    }

    // 名前: 注文履歴から取得 → LINE 表示名 → メール先頭
    const customer_name = (orders[0] && orders[0].customer_name) || body.display_name || body.email.split('@')[0];
    const total_spent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

    if (foundRow > 0) {
      // 既存 row の line_uid を更新
      sh.getRange(foundRow, lineIdx + 1).setValue(body.line_uid);
      sh.getRange(foundRow, nameIdx + 1).setValue(body.display_name || '');
      sh.getRange(foundRow, linkedAtIdx + 1).setValue(new Date());
    } else {
      // 新規 row 追加（注文がなくても会員登録する）
      const row = new Array(headers.length).fill('');
      row[headers.indexOf('customer_id')] = Utilities.getUuid();
      row[emailIdx] = body.email;
      row[headers.indexOf('name')] = customer_name;
      row[headers.indexOf('total_spent')] = total_spent;
      row[headers.indexOf('order_count')] = orders.length;
      row[lineIdx] = body.line_uid;
      row[nameIdx] = body.display_name || '';
      row[linkedAtIdx] = new Date();
      sh.appendRow(row);
    }

    const customer = {
      email: body.email,
      name: customer_name,
      total_orders: orders.length,
      total_spent: total_spent,
      line_uid: body.line_uid,
      line_name: body.display_name || '',
      is_new: orders.length === 0
    };

    // LINE プッシュ通知: 連携完了 + 配送状況リンク
    sendLinePush(body.line_uid, [buildLinkSuccessMessage(customer_name)]);

    attachCardToCustomer(customer, orders);
    return jsonResponse({ ok:true, customer, orders });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* POST line_register { line_uid, display_name, name, phone, zip, address }
   - LINE 友だち追加からの新規会員登録（注文不要）
   - line_uid で既存チェック → 既存なら返却のみ、新規なら customers に追加
*/
/* POST update_profile { line_uid?, email?, name, phone, zip, address }
   会員情報を customers に保存（行が無ければ作成）。name+zip+address が揃えば profile_complete=TRUE。
   有機JAS商品の購入解放はこのフラグで判定する。 */
function updateProfile(body) {
  var uid = body.line_uid || '';
  var email = (body.email || '').toString().trim();
  if (!uid && !email) return jsonResponse({ ok:false, error:'line_uid or email required' });
  var sh = sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
  var headers = sh.getDataRange().getValues()[0];
  function col(n){ var i=headers.indexOf(n); if(i===-1){ i=headers.length; sh.getRange(1,i+1).setValue(n); headers.push(n);} return i; }
  var lineIdx=col('line_uid'), emailIdx=col('email'), nameIdx=col('name'), phoneIdx=col('phone'),
      zipIdx=col('zip'), addrIdx=col('address'), pcIdx=col('profile_complete'), idIdx=col('customer_id');
  var data = sh.getDataRange().getValues();
  var foundRow=-1;
  for (var i=1;i<data.length;i++){
    if ((uid && String(data[i][lineIdx])===String(uid)) ||
        (email && String(data[i][emailIdx]).toLowerCase()===email.toLowerCase())) { foundRow=i+1; break; }
  }
  if (foundRow===-1) {
    var row=new Array(headers.length).fill('');
    row[idIdx]=Utilities.getUuid();
    if(uid) row[lineIdx]=uid;
    if(email) row[emailIdx]=email;
    sh.appendRow(row); foundRow=sh.getLastRow();
  }
  if (body.name)    sh.getRange(foundRow, nameIdx+1).setValue(body.name);
  if (body.phone)   sh.getRange(foundRow, phoneIdx+1).setValue(body.phone);
  if (body.zip)     sh.getRange(foundRow, zipIdx+1).setValue(body.zip);
  if (body.address) sh.getRange(foundRow, addrIdx+1).setValue(body.address);
  if (email && !String(sh.getRange(foundRow, emailIdx+1).getValue())) sh.getRange(foundRow, emailIdx+1).setValue(email);
  var complete = !!(body.name && body.zip && body.address);
  sh.getRange(foundRow, pcIdx+1).setValue(complete ? 'TRUE' : '');
  log('update_profile', { uid: uid, email: email, complete: complete });
  var rowVals = sh.getRange(foundRow,1,1,headers.length).getValues()[0];
  var customer={}; headers.forEach(function(h,idx){ customer[h]=rowVals[idx]; });
  return jsonResponse({ ok:true, complete: complete, customer: customer });
}

function lineRegister(body) {
  if (!body.line_uid) throw new Error('line_uid required');

  try {
    var sh = sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
    var data = sh.getDataRange().getValues();
    var headers = data[0];

    /* ---- 列を確保 (なければ追加) ---- */
    function ensureCol(name) {
      var idx = headers.indexOf(name);
      if (idx === -1) {
        idx = headers.length;
        sh.getRange(1, idx + 1).setValue(name);
        headers.push(name);
      }
      return idx;
    }
    var lineIdx     = ensureCol('line_uid');
    var nameIdx     = ensureCol('name');
    var phoneIdx    = ensureCol('phone');
    var lineNameIdx = ensureCol('line_name');
    var linkedAtIdx = ensureCol('linked_at');
    var zipIdx      = ensureCol('zip');
    var addressIdx  = ensureCol('address');
    var surveyIdx   = ensureCol('survey_json');

    /* ---- 既存チェック (line_uid) ---- */
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][lineIdx]) === String(body.line_uid)) {
        var customer = {};
        headers.forEach(function(h, idx) { customer[h] = data[i][idx]; });
        return jsonResponse({ ok: true, customer: customer, is_new: false });
      }
    }

    /* ---- 新規登録 ---- */
    var row = new Array(headers.length).fill('');
    row[headers.indexOf('customer_id')] = Utilities.getUuid();
    row[nameIdx]     = body.name || body.display_name || '';
    row[phoneIdx]    = body.phone || '';
    row[lineIdx]     = body.line_uid;
    row[lineNameIdx] = body.display_name || '';
    row[linkedAtIdx] = new Date();
    row[zipIdx]      = body.zip || '';
    row[addressIdx]  = body.address || '';
    row[surveyIdx]   = JSON.stringify(body.survey || {});
    row[headers.indexOf('total_spent')]  = 0;
    row[headers.indexOf('order_count')]  = 0;
    sh.appendRow(row);

    // アンケート回答を別シートにも記録 (分析用)
    try {
      var surveySheet = sheet('member_surveys', ['ts','line_uid','name','age','family','meat_beef','meat_chicken','frequency','budget','values','source']);
      var sv = body.survey || {};
      surveySheet.appendRow([
        new Date(), body.line_uid, body.name || body.display_name || '',
        sv.age || '', sv.family || '',
        (sv.meat_beef || []).join(','), (sv.meat_chicken || []).join(','),
        sv.frequency || '', sv.budget || '',
        (sv.values || []).join(','), sv.source || ''
      ]);
    } catch(e) { log('survey_save_error', { error: e.message }); }

    var custName = body.name || body.display_name || '';

    // LINE プッシュ通知: 会員登録完了 + 無投薬ムネ肉特典
    sendLinePush(body.line_uid, [buildRegisterRewardMessage(custName)]);

    return jsonResponse({
      ok: true,
      is_new: true,
      customer: {
        name:     custName,
        phone:    body.phone || '',
        line_uid: body.line_uid,
        line_name: body.display_name || '',
        zip:      body.zip || '',
        address:  body.address || ''
      }
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message });
  }
}

/* ============================================================
   LINE Messaging API — Push Message ヘルパー
   ============================================================
   GAS Script Properties に LINE_CHANNEL_TOKEN を設定必須。
   LINE Developers Console → エダチク公式LINE → Messaging API設定
   → チャネルアクセストークン（長期）を発行して貼り付ける。
*/
function sendLinePush(lineUid, messages) {
  var token = cfg('LINE_CHANNEL_TOKEN');
  if (!token || !lineUid) return false;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ to: lineUid, messages: messages }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;
    log('line_push_failed', { line_uid: lineUid, code: code, body: res.getContentText() });
    return false;
  } catch (e) {
    log('line_push_error', { line_uid: lineUid, error: e.message });
    return false;
  }
}

/** 購入済顧客の連携完了後に送る Flex Message */
function buildLinkSuccessMessage(customerName) {
  var liffMypage = 'https://liff.line.me/' + cfg('LIFF_ID', '1657458587-mz1dR9e6') + '/mypage.html';
  return {
    type: 'flex',
    altText: 'アカウント連携完了 — 配送状況はこちらから確認できます',
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://www.eda-livestock.com/public/images/cuts/hero-0.jpeg',
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '✅ アカウント連携完了', weight: 'bold', size: 'lg', color: '#1a1a1a' },
          { type: 'text', text: (customerName || 'お客') + '様、連携ありがとうございます。\n注文履歴・配送状況をいつでもLINEから確認できます。', wrap: true, size: 'sm', color: '#666666' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '📦 配送状況を確認する', uri: liffMypage },
            style: 'primary',
            color: '#2d5016'
          }
        ]
      }
    }
  };
}

/** 新規会員登録後に送る Flex Message (無投薬ムネ肉特典) */
function buildRegisterRewardMessage(customerName) {
  var liffShop = 'https://liff.line.me/' + cfg('LIFF_ID', '1657458587-mz1dR9e6') + '/shop.html?item=mune250';
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  return {
    type: 'flex',
    altText: '🍗 無投薬ムネ肉 200g プレゼント！ — 会員登録ありがとうございます',
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://www.eda-livestock.com/public/images/cuts/hero-0.jpeg',
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '🍗 無投薬ムネ肉 250g GET!', weight: 'bold', size: 'lg', color: '#2d5016' },
          { type: 'text', text: greeting + '、会員登録ありがとうございます！特典の無投薬ムネ肉200gをお受け取りください。', wrap: true, size: 'sm', color: '#666666' },
          { type: 'separator' },
          { type: 'text', text: '受け取り方法', weight: 'bold', size: 'xs', color: '#888888', margin: 'md' },
          { type: 'text', text: '下のボタンからムネ肉をカートに追加 → お会計時に自動で0円に！', wrap: true, size: 'xs', color: '#999999' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '🍗 無投薬ムネ肉を見る', uri: liffShop },
            style: 'primary',
            color: '#2d5016',
            height: 'sm'
          },
          {
            type: 'button',
            action: { type: 'uri', label: 'オーガニック製品を見る', uri: liffShop.replace('?item=mune250', '') },
            style: 'link',
            color: '#2d5016',
            height: 'sm'
          }
        ]
      }
    }
  };
}

function buildOrderConfirmMessage(customerName, orderNum, totalYen) {
  var liffId = cfg('LIFF_ID', '1657458587-mz1dR9e6');
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  return {
    type: 'flex',
    altText: '【江田畜産】ご注文を受け付けました（' + orderNum + '）',
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://www.eda-livestock.com/public/images/cuts/hero-0.jpeg',
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '✅ ご注文ありがとうございます', weight: 'bold', size: 'md', color: '#2d5016' },
          { type: 'text', text: greeting + '、ご注文を受け付けました。', size: 'sm', color: '#555555', wrap: true },
          { type: 'separator' },
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '注文番号', size: 'xs', color: '#888888', flex: 3 },
            { type: 'text', text: orderNum, size: 'xs', color: '#333333', flex: 5, align: 'end' }
          ]},
          { type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: '合計金額', size: 'xs', color: '#888888', flex: 3 },
            { type: 'text', text: '¥' + (totalYen || 0).toLocaleString(), size: 'xs', color: '#333333', weight: 'bold', flex: 5, align: 'end' }
          ]},
          { type: 'text', text: '配送状況はマイページでご確認いただけます。発送時にもLINEでお知らせします。', size: 'xxs', color: '#999999', wrap: true, margin: 'md' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'uri',
              label: '📦 配送状況を確認する',
              uri: 'https://liff.line.me/' + liffId + '/mypage.html'
            },
            style: 'primary',
            color: '#2d5016',
            height: 'sm'
          }
        ]
      }
    }
  };
}

/* email → customers シートの line_uid を逆引き (見つからなければ '')。
   注文metadataにline_uidが無い既存LINE友だち(Web決済)もLINE通知へ寄せるため。 */
function lineUidForEmail(email) {
  if (!email) return '';
  try {
    var sh = ss().getSheetByName('customers');
    if (!sh) return '';
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return '';
    var headers = data[0];
    var eIdx = headers.indexOf('email');
    var uIdx = headers.indexOf('line_uid');
    if (eIdx === -1 || uIdx === -1) return '';
    var target = String(email).trim().toLowerCase();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][eIdx]).trim().toLowerCase() === target) {
        return String(data[i][uIdx] || '').trim();
      }
    }
  } catch (e) { /* fallthrough */ }
  return '';
}

/* 発送通知 (②) の LINE Flex。配送番号・お届け予定・追跡ボタン(クロネコヤマト)。 */
function buildShipNotifyMessage(customerName, orderNum, tracking, deliveryDate) {
  var liffId = cfg('LIFF_ID', '1657458587-mz1dR9e6');
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  var mypage = 'https://liff.line.me/' + liffId + '/mypage.html';
  var trackUrl = tracking
    ? ('https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number01=' + encodeURIComponent(tracking))
    : mypage;
  var rows = [
    { type: 'text', text: '📦 商品を発送しました', weight: 'bold', size: 'md', color: '#2d5016' },
    { type: 'text', text: greeting + '、ご注文の商品を発送しました。', size: 'sm', color: '#555555', wrap: true },
    { type: 'separator' },
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: '注文番号', size: 'xs', color: '#888888', flex: 4 },
      { type: 'text', text: orderNum, size: 'xs', color: '#333333', flex: 6, align: 'end', wrap: true }
    ]},
    { type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: '配送番号', size: 'xs', color: '#888888', flex: 4 },
      { type: 'text', text: tracking || '—', size: 'xs', color: '#333333', weight: 'bold', flex: 6, align: 'end', wrap: true }
    ]}
  ];
  if (deliveryDate) {
    rows.push({ type: 'box', layout: 'horizontal', contents: [
      { type: 'text', text: 'お届け予定', size: 'xs', color: '#888888', flex: 4 },
      { type: 'text', text: deliveryDate, size: 'xs', color: '#2d5016', weight: 'bold', flex: 6, align: 'end', wrap: true }
    ]});
  }
  rows.push({ type: 'text', text: 'クロネコヤマトでお届けします。下のボタンから配送状況をご確認いただけます。', size: 'xxs', color: '#999999', wrap: true, margin: 'md' });
  return {
    type: 'flex',
    altText: '【江田畜産】商品を発送しました（' + orderNum + '）配送番号 ' + (tracking || ''),
    contents: {
      type: 'bubble',
      hero: { type: 'image', url: 'https://www.eda-livestock.com/public/images/cuts/hero-0.jpeg', size: 'full', aspectRatio: '20:9', aspectMode: 'cover' },
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: rows },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'button', action: { type: 'uri', label: '📦 配送状況を確認する', uri: trackUrl }, style: 'primary', color: '#2d5016', height: 'sm' },
        { type: 'button', action: { type: 'uri', label: 'マイページ', uri: mypage }, style: 'link', color: '#2d5016', height: 'sm' }
      ]}
    }
  };
}

/* 発送通知 (②) のメール (LINE未連携の顧客向けフォールバック)。 */
function sendShippingEmail(email, customerName, orderNum, tracking, deliveryDate) {
  if (!email) return;
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  var lines = [
    greeting,
    '',
    'ご注文の商品を発送いたしました。',
    '',
    '注文番号: ' + orderNum,
    '配送番号: ' + (tracking || '—')
  ];
  if (deliveryDate) lines.push('お届け予定: ' + deliveryDate);
  if (tracking) {
    lines.push('');
    lines.push('▼ 配送状況の確認（クロネコヤマト）');
    lines.push('https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number01=' + encodeURIComponent(tracking));
  }
  lines.push('');
  lines.push('このたびは江田畜産をご利用いただき、誠にありがとうございます。');
  lines.push('— 江田畜産');
  try {
    MailApp.sendEmail({
      to: email,
      subject: '【江田畜産】商品を発送しました（' + orderNum + '）',
      body: lines.join('\n')
    });
  } catch (e) {
    log('shipping_email_error', { order: orderNum, error: e.message });
  }
}

/* ============================================================
   CUSTOMER SEGMENTATION — LINE 公式メッセージ送信用セグメント抽出
   ------------------------------------------------------------
   GET ?action=customers_segment&type=<segment_type>
   返却: { ok, count, customers: [{customer_id,email,name,line_uid,line_name,total_spent,order_count,last_order,...}] }

   segment_type:
   - line_purchased  : LINE 友だち + 購入済 (リピート訴求・VIP案内)
   - line_only       : LINE 友だち のみ・購入なし (初回 50%OFF クーポン)
   - purchased_only  : 購入済 / LINE 未連携 (LINE 連携 5%OFF クーポン)
   - churn_risk      : 最終注文から 30 日以上経過 (カムバッククーポン)
   - vip             : 累計 ¥30,000 以上 (VIP 限定案内)
   ============================================================ */
function customersSegment(params) {
  try {
    const type = (params && params.type) || 'all';
    const sh = sheet('customers');
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, count:0, customers:[] });

    const headers = data[0];
    const idx = (col) => headers.indexOf(col);

    const now = new Date();
    const DAY_30_MS = 30 * 24 * 60 * 60 * 1000;

    const customers = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const customer = {};
      headers.forEach((h, k) => { customer[h] = row[k]; });

      const has_line = !!customer.line_uid;
      const has_orders = (Number(customer.order_count) || 0) > 0;
      const total_spent = Number(customer.total_spent) || 0;

      let last_order_at = customer.last_order_at || customer.last_order;
      if (last_order_at && typeof last_order_at === 'string') {
        try { last_order_at = new Date(last_order_at); } catch(e) { last_order_at = null; }
      }
      const days_since_last = last_order_at ? Math.floor((now - last_order_at) / (24*60*60*1000)) : 9999;

      let match = false;
      switch (type) {
        case 'line_purchased':  match = has_line && has_orders; break;
        case 'line_only':       match = has_line && !has_orders; break;
        case 'purchased_only':  match = !has_line && has_orders; break;
        case 'churn_risk':      match = has_orders && days_since_last > 30; break;
        case 'vip':             match = total_spent >= 30000; break;
        case 'all':             match = true; break;
        default:                match = false;
      }

      if (match) {
        customers.push({
          customer_id: customer.customer_id,
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
          line_uid: customer.line_uid,
          line_name: customer.line_name,
          total_spent: total_spent,
          order_count: Number(customer.order_count) || 0,
          first_order: customer.first_order,
          last_order: customer.last_order,
          days_since_last_order: has_orders ? days_since_last : null,
          has_line: has_line,
          has_orders: has_orders
        });
      }
    }

    return jsonResponse({
      ok: true,
      type: type,
      count: customers.length,
      generated_at: new Date().toISOString(),
      customers: customers
    });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* ============================================================
   CUSTOMER CSV EXPORT — LINE Official Account Manager オーディエンス import 用
   ------------------------------------------------------------
   GET ?action=customers_csv&type=<segment_type>[&format=line_audience|standard]

   format:
   - line_audience  : line_uid のみ 1 列 (LINE Manager オーディエンス import 形式)
   - standard       : 全項目 CSV (Excel 互換)
   - default        : standard
   ============================================================ */
function customersCsv(params) {
  try {
    const type = (params && params.type) || 'all';
    const format = (params && params.format) || 'standard';

    // 内部で customersSegment を呼ぶ (重複ロジック排除)
    const segmentRes = customersSegment({ type: type });
    const data = JSON.parse(segmentRes.getContent());
    if (!data.ok) throw new Error(data.error || 'segment failed');

    let csv = '';

    if (format === 'line_audience') {
      // LINE Official Manager オーディエンス: line_uid のみ・ヘッダーなし
      csv = data.customers
        .filter(c => c.line_uid)
        .map(c => c.line_uid)
        .join('\n');
    } else {
      // 標準 CSV (BOM 付き Excel 互換)
      csv = '﻿'; // UTF-8 BOM
      csv += 'customer_id,email,name,phone,line_uid,line_name,total_spent,order_count,first_order,last_order,days_since_last_order,has_line,has_orders\n';
      data.customers.forEach(c => {
        const fields = [
          c.customer_id || '',
          c.email || '',
          (c.name || '').replace(/,/g, ' '),
          c.phone || '',
          c.line_uid || '',
          (c.line_name || '').replace(/,/g, ' '),
          c.total_spent,
          c.order_count,
          c.first_order || '',
          c.last_order || '',
          c.days_since_last_order != null ? c.days_since_last_order : '',
          c.has_line ? 'TRUE' : 'FALSE',
          c.has_orders ? 'TRUE' : 'FALSE'
        ];
        // フィールドにカンマや改行を含む場合は "..." で包む
        csv += fields.map(f => {
          const s = String(f);
          if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        }).join(',') + '\n';
      });
    }

    const filename = 'eda_customers_' + type + '_' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd_HHmm') + '.csv';

    return ContentService.createTextOutput(csv)
      .setMimeType(ContentService.MimeType.CSV)
      .downloadAsFile(filename);
  } catch (e) {
    return ContentService.createTextOutput('Error: ' + e.message).setMimeType(ContentService.MimeType.TEXT);
  }
}

/* ============================================================
   SEGMENT STATS — ダッシュボード用のセグメント別人数集計
   GET ?action=segment_stats
   ============================================================ */
function segmentStats() {
  try {
    const types = ['line_purchased', 'line_only', 'purchased_only', 'churn_risk', 'vip', 'all'];
    const stats = {};
    types.forEach(t => {
      const res = customersSegment({ type: t });
      const data = JSON.parse(res.getContent());
      stats[t] = data.count || 0;
    });

    return jsonResponse({
      ok: true,
      generated_at: new Date().toISOString(),
      segments: stats,
      summary: {
        total_customers: stats.all,
        line_linked: stats.line_purchased + stats.line_only,
        line_linked_rate: stats.all > 0 ? Math.round((stats.line_purchased + stats.line_only) / stats.all * 100) : 0,
        purchased: stats.line_purchased + stats.purchased_only,
        churn_risk_count: stats.churn_risk,
        vip_count: stats.vip
      }
    });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* ============================================================
   STAFF endpoints (商品管理・注文管理用)
   ============================================================ */
function staffLogin(params) {
  const pin = params.pin || '';
  const validPin = cfg('STAFF_PIN', '1234');
  if (String(pin) !== String(validPin)) {
    return jsonResponse({ ok:false, error: 'Invalid PIN' });
  }
  return jsonResponse({ ok:true, name: '江田畜産スタッフ', role: 'admin' });
}

function staffDashboard() {
  // 既存の dashboardSummary を再利用
  return dashboardSummary({ range: '30d' });
}

/* GET ?action=staff_inventory
   在庫上書きシート (stock_overrides) があれば、その値を返却。
   なければ products-master.js のデフォルト stock を返す (フロント側で同期)。
*/
/* ============================================================
   PRODUCTS シート操作 — products タブが SOT (Single Source of Truth)
   ・public_products / staff_inventory: 同じデータを返す
   ・staff_update_stock / staff_product_save: products シートを直接更新
   ・staff_product_delete: products シートから行削除
   ・旧 product_overrides / stock_overrides は廃止 (使わない)
   ============================================================ */
const PRODUCTS_HEADERS = [
  'productId','variantId','sku','stripePriceId',
  'name','variant','price','weight','stock','temp',
  'category','categoryLabel','tagEn','description',
  'image','isOrganic','comingSoon','published'
];

function productsSheet() {
  return sheet('products', PRODUCTS_HEADERS);
}

function staffInventory() {
  try {
    const sh = productsSheet();
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, products: [], source: 'empty' });
    const headers = data[0];
    const products = data.slice(1).map(row => {
      const p = {}; headers.forEach((h, i) => p[h] = row[i]);
      return p;
    });
    return jsonResponse({ ok:true, products, source: 'sheet:products' });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* POST staff_update_stock { variantId, stock } — 在庫数のみ高速更新 */
function staffUpdateStock(body) {
  if (!body.variantId) throw new Error('variantId required');
  const sh = productsSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const vidIdx = headers.indexOf('variantId');
  const stockIdx = headers.indexOf('stock');
  for (let i = 1; i < data.length; i++) {
    if (data[i][vidIdx] === body.variantId) {
      sh.getRange(i + 1, stockIdx + 1).setValue(Number(body.stock) || 0);
      return jsonResponse({ ok:true, row: i + 1 });
    }
  }
  return jsonResponse({ ok:false, error: 'variantId not found in products sheet' });
}

/* POST staff_product_save { 全フィールド } — 新規追加 or 全フィールド更新 */
function staffProductSave(body) {
  if (!body.variantId) throw new Error('variantId required');
  const sh = productsSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const vidIdx = headers.indexOf('variantId');

  /* 既存行を探す */
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][vidIdx] === body.variantId) { foundRow = i + 1; break; }
  }

  /* 全フィールドを配列化 (PRODUCTS_HEADERS の順序) */
  const row = headers.map(h => {
    const v = body[h];
    if (v === undefined || v === null) return '';
    /* 数値カラムは Number 化 */
    if (h === 'price' || h === 'weight' || h === 'stock') return Number(v) || 0;
    /* boolean カラムは TRUE/FALSE 文字列 */
    if (h === 'isOrganic' || h === 'comingSoon' || h === 'published') {
      return (v === true || v === 'TRUE' || v === 'true') ? 'TRUE' : 'FALSE';
    }
    return String(v);
  });

  if (foundRow > 0) {
    sh.getRange(foundRow, 1, 1, row.length).setValues([row]);
    return jsonResponse({ ok:true, action: 'updated', row: foundRow });
  } else {
    sh.appendRow(row);
    return jsonResponse({ ok:true, action: 'created' });
  }
}

/* POST staff_product_delete { variantId } */
function staffProductDelete(body) {
  if (!body.variantId) throw new Error('variantId required');
  const sh = productsSheet();
  const data = sh.getDataRange().getValues();
  const vidIdx = data[0].indexOf('variantId');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][vidIdx] === body.variantId) {
      sh.deleteRow(i + 1);
      return jsonResponse({ ok:true, deleted_row: i + 1 });
    }
  }
  return jsonResponse({ ok:false, error: 'variantId not found' });
}

/* ============================================================
   GIFTS シート操作 (Phase 3)
   ============================================================ */
const GIFTS_HEADERS = [
  'giftId','name','badgeText','price','weight','description',
  'stripePriceId','image','servings','noteHtml','published'
];

function giftsSheet() {
  return sheet('gifts', GIFTS_HEADERS);
}

function publicGifts() {
  try {
    const sh = giftsSheet();
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, gifts: [] });
    const headers = data[0];
    const gifts = data.slice(1).map(row => {
      const g = {}; headers.forEach((h, i) => g[h] = row[i]);
      return g;
    }).filter(g => g.published === true || g.published === 'TRUE' || g.published === 'true');
    return jsonResponse({ ok:true, gifts });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

function staffGiftSave(body) {
  if (!body.giftId) throw new Error('giftId required');
  const sh = giftsSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('giftId');
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === body.giftId) { foundRow = i + 1; break; }
  }
  const row = headers.map(h => {
    const v = body[h];
    if (v === undefined || v === null) return '';
    if (h === 'price' || h === 'weight') return Number(v) || 0;
    if (h === 'published') return (v === true || v === 'TRUE' || v === 'true') ? 'TRUE' : 'FALSE';
    return String(v);
  });
  if (foundRow > 0) {
    sh.getRange(foundRow, 1, 1, row.length).setValues([row]);
    return jsonResponse({ ok:true, action: 'updated' });
  } else {
    sh.appendRow(row);
    return jsonResponse({ ok:true, action: 'created' });
  }
}

function staffGiftDelete(body) {
  if (!body.giftId) throw new Error('giftId required');
  const sh = giftsSheet();
  const data = sh.getDataRange().getValues();
  const idIdx = data[0].indexOf('giftId');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idIdx] === body.giftId) {
      sh.deleteRow(i + 1);
      return jsonResponse({ ok:true });
    }
  }
  return jsonResponse({ ok:false, error: 'giftId not found' });
}

/* ============================================================
   SUBSCRIPTIONS シート操作 (Phase 4)
   ============================================================ */
const SUBS_HEADERS = [
  'planId','name','target','spec','oldPrice','firstMonthPrice','savings',
  'stripePriceId','items','featured','badgeLabel','vipPerk','image','published'
];

function subscriptionPlansSheet() {
  return sheet('subscription_plans', SUBS_HEADERS);
}

function publicSubscriptionPlans() {
  try {
    const sh = subscriptionPlansSheet();
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, plans: [] });
    const headers = data[0];
    const plans = data.slice(1).map(row => {
      const p = {}; headers.forEach((h, i) => p[h] = row[i]);
      return p;
    }).filter(p => p.published === true || p.published === 'TRUE' || p.published === 'true');
    return jsonResponse({ ok:true, plans });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

function staffSubscriptionSave(body) {
  if (!body.planId) throw new Error('planId required');
  const sh = subscriptionPlansSheet();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('planId');
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === body.planId) { foundRow = i + 1; break; }
  }
  const row = headers.map(h => {
    const v = body[h];
    if (v === undefined || v === null) return '';
    if (h === 'oldPrice' || h === 'firstMonthPrice' || h === 'savings') return Number(v) || 0;
    if (h === 'featured' || h === 'published') return (v === true || v === 'TRUE' || v === 'true') ? 'TRUE' : 'FALSE';
    return String(v);
  });
  if (foundRow > 0) {
    sh.getRange(foundRow, 1, 1, row.length).setValues([row]);
    return jsonResponse({ ok:true, action: 'updated' });
  } else {
    sh.appendRow(row);
    return jsonResponse({ ok:true, action: 'created' });
  }
}

function staffSubscriptionDelete(body) {
  if (!body.planId) throw new Error('planId required');
  const sh = subscriptionPlansSheet();
  const data = sh.getDataRange().getValues();
  const idIdx = data[0].indexOf('planId');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idIdx] === body.planId) {
      sh.deleteRow(i + 1);
      return jsonResponse({ ok:true });
    }
  }
  return jsonResponse({ ok:false, error: 'planId not found' });
}

/* GET staff_orders */
function staffOrders() {
  try {
    const sh = sheet('orders');
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, orders: [] });
    const headers = data[0];
    const orders = data.slice(1).map(row => {
      const o = {}; headers.forEach((h, i) => o[h] = row[i]);
      return o;
    }).reverse().slice(0, 200);
    return jsonResponse({ ok:true, orders });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* POST staff_ship { order_number, tracking_number } */
function staffShip(body) {
  if (!body.order_number) throw new Error('order_number required');
  const sh = sheet('orders');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const onIdx = headers.indexOf('order_number');
  const stIdx = headers.indexOf('payment_status');
  const pmIdx = headers.indexOf('payment_method');
  for (let i = 1; i < data.length; i++) {
    if (data[i][onIdx] === body.order_number) {
      // ★ 銀行振込ガード: 入金確認前（awaiting_payment）の振込注文は発送（伝票発行）不可。
      const _curStatus = stIdx >= 0 ? String(data[i][stIdx] || '').toLowerCase() : '';
      const _payMethod = pmIdx >= 0 ? String(data[i][pmIdx] || '').toLowerCase() : '';
      if (_payMethod === 'bank' && _curStatus === 'awaiting_payment') {
        return jsonResponse({ ok:false, error: '未入金のため発送できません。先に「入金確認」を行ってください。' });
      }
      // tracking_number 列を追加 (なければ)
      let tnIdx = headers.indexOf('tracking_number');
      if (tnIdx === -1) {
        sh.getRange(1, headers.length + 1).setValue('tracking_number');
        tnIdx = headers.length;
      }
      const tracking = String(body.tracking_number || '').trim();
      sh.getRange(i + 1, tnIdx + 1).setValue(tracking);
      if (stIdx >= 0) sh.getRange(i + 1, stIdx + 1).setValue('shipped');

      // ★ 発送通知 (②配送確定): 発送伝票確定が起点。
      //   LINE 連携済み (line_uid あり。無ければ email 逆引き) → LINE で配送番号/お届け予定。
      //   未連携、または LINE 失敗 → メール。通知失敗で発送記録自体は失敗させない。
      try {
        const row = data[i];
        const get = (n) => { const k = headers.indexOf(n); return k >= 0 ? row[k] : ''; };
        const custName  = String(get('customer_name') || '');
        const custEmail = String(get('customer_email') || '');
        const deliveryDate = String(body.delivery_date || body.eta || '').trim();
        let shipLineUid = String(get('line_uid') || '').trim();
        if (!shipLineUid) shipLineUid = lineUidForEmail(custEmail);
        let notified = false;
        if (shipLineUid) {
          notified = sendLinePush(shipLineUid, [buildShipNotifyMessage(custName, body.order_number, tracking, deliveryDate)]);
        }
        if (!notified && custEmail) {
          sendShippingEmail(custEmail, custName, body.order_number, tracking, deliveryDate);
        }
        log('ship_notified', { order: body.order_number, via: shipLineUid ? (notified ? 'line' : 'email_fallback') : 'email', tracking: tracking });
      } catch (e) {
        log('ship_notify_error', { order: body.order_number, error: e.message });
      }

      return jsonResponse({ ok:true });
    }
  }
  return jsonResponse({ ok:false, error: 'order not found' });
}

/* POST staff_confirm_payment { order_number }
   ------------------------------------------------------------
   銀行振込の「入金確認（アナログ）」。awaiting_payment → paid に更新し、
   在庫を減算（card 決済の finalizeOrder と同じく入金確定時に減算）、顧客マスタを upsert。
   顧客への通知はここでは行わない（Tom 指示: 通知は伝票発行＝発送時の1回のみ）。
   これにより staffShip の銀行ガードが外れ、伝票発行（発送）へ進めるようになる。 */
function staffConfirmPayment(body) {
  if (!body.order_number) throw new Error('order_number required');
  const sh = sheet('orders');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const onIdx = headers.indexOf('order_number');
  const stIdx = headers.indexOf('payment_status');
  const pmIdx = headers.indexOf('payment_method');
  const itemsIdx = headers.indexOf('items_json');
  const mailIdx = headers.indexOf('customer_email');
  const nameIdx = headers.indexOf('customer_name');
  const phoneIdx = headers.indexOf('customer_phone');
  const totalIdx = headers.indexOf('total');
  const uidIdx = headers.indexOf('line_uid');
  const lnameIdx = headers.indexOf('line_name');
  for (let i = 1; i < data.length; i++) {
    if (data[i][onIdx] === body.order_number) {
      const curStatus = stIdx >= 0 ? String(data[i][stIdx] || '').toLowerCase() : '';
      if (curStatus === 'shipped' || curStatus === 'delivered') {
        return jsonResponse({ ok:false, error: 'すでに発送済みです。' });
      }
      if (curStatus === 'paid') {
        return jsonResponse({ ok:true, already: true }); // 冪等
      }
      if (stIdx >= 0) sh.getRange(i + 1, stIdx + 1).setValue('paid');

      // 在庫減算（card と同様、入金確定時に減算）。失敗してもステータス更新は維持。
      try {
        decrementStockAfterOrder({}, { items_json: itemsIdx >= 0 ? String(data[i][itemsIdx] || '[]') : '[]' });
      } catch (e) { log('bank_stock_decrement_error', { order: body.order_number, error: e.message }); }

      // 顧客マスタ upsert（入金確定したので売上・回数を計上）
      try {
        upsertCustomer({
          email: mailIdx >= 0 ? data[i][mailIdx] : '',
          name: nameIdx >= 0 ? data[i][nameIdx] : '',
          phone: phoneIdx >= 0 ? data[i][phoneIdx] : '',
          line_uid: uidIdx >= 0 ? (data[i][uidIdx] || '') : '',
          line_name: lnameIdx >= 0 ? (data[i][lnameIdx] || '') : '',
          last_order: body.order_number,
          last_order_total: totalIdx >= 0 ? (Number(data[i][totalIdx]) || 0) : 0
        });
      } catch (e) { log('bank_upsert_error', { order: body.order_number, error: e.message }); }

      log('bank_payment_confirmed', { order: body.order_number });
      return jsonResponse({ ok:true });
    }
  }
  return jsonResponse({ ok:false, error: 'order not found' });
}

/* GET b2_csv (ヤマト B2 形式の CSV ダウンロード) */
function b2CsvExport() {
  try {
    const sh = sheet('orders');
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.CSV);
    const headers = data[0];
    const get = (row, name) => row[headers.indexOf(name)] || '';
    // 末尾に「お届け希望日/時間帯」を追加 (顧客が決済時に指定した配送希望)。
    //   既存4列の後ろに足すので従来の取り込み位置は不変。日付は YYYY/MM/DD (ヤマト形式)。
    const csv = ['お届け先電話番号,お届け先郵便番号,お届け先住所,お届け先名,お届け希望日,お届け希望時間帯'];
    data.slice(1).forEach(row => {
      // 🏦 未入金（銀行振込・入金前）の注文は発送伝票の対象外（入金確認まで除外）。
      if (String(get(row, 'payment_status') || '').toLowerCase() === 'awaiting_payment') return;
      const dest = get(row, 'destinations_json');
      const name = get(row, 'customer_name');
      const dDate = String(get(row, 'delivery_date') || '').slice(0, 10).replace(/-/g, '/');  // ISO→YYYY/MM/DD
      const dTime = String(get(row, 'delivery_time') || '').replace(/,/g, ' ');                 // 念のためカンマ除去
      try {
        const d = JSON.parse(dest);
        d.forEach(addr => {
          // 商品が割り当てられていない宛先(ギフトのご依頼主=差出人など)は配送ラベルを作らない
          if (Array.isArray(addr.items) && addr.items.length === 0) return;
          csv.push([addr.tel || '', addr.zip || '', (addr.pref || '') + (addr.address || ''), addr.name || name, dDate, dTime].join(','));
        });
      } catch (e) {
        csv.push(['', '', '', name, dDate, dTime].join(','));
      }
    });
    return ContentService.createTextOutput(csv.join('\n'))
      .setMimeType(ContentService.MimeType.CSV)
      .downloadAsFile('b2-' + new Date().toISOString().slice(0,10) + '.csv');
  } catch (e) {
    return ContentService.createTextOutput('error: ' + e.message);
  }
}

/* ============================================================
   設定健全性チェック (デプロイ前確認用)
   ============================================================ */
function checkConfig() {
  const required = ['STRIPE_SECRET_KEY','STRIPE_PRICE_MINI','STRIPE_PRICE_PRO','STRIPE_PRICE_VIP'];
  const optional = ['STRIPE_DEMO_COUPON','STAFF_NOTIFICATION_EMAIL','SUCCESS_URL','CANCEL_URL','SPREADSHEET_ID'];
  const result = { required:{}, optional:{}, ok:true };
  required.forEach(k => {
    const v = cfg(k);
    result.required[k] = v ? '✅ 設定済み (' + v.substring(0,10) + '...)' : '❌ 未設定';
    if (!v) result.ok = false;
  });
  optional.forEach(k => {
    const v = cfg(k);
    result.optional[k] = v ? '✅ ' + v.substring(0, 50) : '⚠️ 未設定';
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/* ============================================================
   📊 ANALYTICS — 自前の軽量計測 (GA4 不要)
   ・log_event: フロントから POST されるイベントを events シートに記録
   ・staff_analytics: STAFF ダッシュボード用に集計を返す

   events シートのスキーマ:
   ts | event_type | session_id | page | product_id | value | referrer | ua | meta_json

   サポートイベント:
   - page_view       (ページ閲覧)
   - view_item       (商品詳細閲覧)
   - add_to_cart     (カート追加)
   - remove_from_cart(カート削除)
   - view_cart       (カート画面表示)
   - begin_checkout  (決済開始)
   - purchase        (購入完了・Stripe webhook から発火)
   - line_click      (LINE 友だち追加クリック)
   - quiz_start      (診断開始)
   - quiz_complete   (診断完了)
   ============================================================ */
const EVENTS_HEADERS = ['ts','event_type','session_id','page','product_id','value','referrer','ua','meta_json'];

function eventsSheet() {
  return sheet('events', EVENTS_HEADERS);
}

function logEvent(body) {
  if (!body || !body.event_type) return jsonResponse({ ok:false, error: 'event_type required' });
  const sh = eventsSheet();
  sh.appendRow([
    new Date(),
    body.event_type,
    body.session_id || '',
    body.page || '',
    body.product_id || '',
    Number(body.value) || 0,
    body.referrer || '',
    (body.ua || '').slice(0, 200),
    JSON.stringify(body.meta || {}).slice(0, 500)
  ]);
  return jsonResponse({ ok:true });
}

/* GAS から呼び出して purchase イベントを記録 (Stripe webhook から) */
function logPurchaseEvent(session) {
  try {
    const sh = eventsSheet();
    const meta = session.metadata || {};
    sh.appendRow([
      new Date(),
      'purchase',
      meta.session_id || session.id || '',
      '/order',
      '',  // product_id (商品複数の場合は meta_json 参照)
      Number(session.amount_total) || 0,
      '',  // referrer
      '',  // ua (webhook から推定不可)
      JSON.stringify({
        order_number: meta.order_number,
        customer_email: session.customer_details && session.customer_details.email,
        items: meta.items_json,
        payment_method: (session.payment_method_types || [])[0]
      }).slice(0, 500)
    ]);
  } catch (e) {
    log('logPurchaseEvent_error', { error: e.message });
  }
}

function staffAnalytics(params) {
  const range = params && params.range ? params.range : '7d';
  const days = Math.max(1, parseInt(range) || 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const today0 = new Date(); today0.setHours(0,0,0,0);
  const yesterday0 = new Date(today0.getTime() - 24*60*60*1000);

  try {
    const sh = ss().getSheetByName('events');
    if (!sh) return jsonResponse({ ok:true, summary: emptyAnalytics(), source: 'no_events_sheet' });
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return jsonResponse({ ok:true, summary: emptyAnalytics(), source: 'empty' });

    const headers = data[0];
    const tsIdx = headers.indexOf('ts');
    const typeIdx = headers.indexOf('event_type');
    const sidIdx = headers.indexOf('session_id');
    const pidIdx = headers.indexOf('product_id');
    const valIdx = headers.indexOf('value');
    const refIdx = headers.indexOf('referrer');

    /* 集計 */
    const today = { pv:0, sessions:new Set(), addCart:0, beginCheckout:0, purchase:0, revenue:0 };
    const yesterday = { pv:0, sessions:new Set(), addCart:0, beginCheckout:0, purchase:0, revenue:0 };
    const period = { pv:0, sessions:new Set(), addCart:0, beginCheckout:0, purchase:0, revenue:0 };

    /* 日別トレンド (期間中) */
    const dayMap = {}; /* { 'YYYY-MM-DD': { pv, purchase, revenue } } */
    /* 商品別 add_to_cart カウント */
    const productCart = {};
    /* 流入元 (referrer) カウント */
    const refMap = {};

    for (let i = 1; i < data.length; i++) {
      const ts = new Date(data[i][tsIdx]);
      if (isNaN(ts.getTime())) continue;
      if (ts < since) continue;

      const type = data[i][typeIdx];
      const sid = data[i][sidIdx];
      const pid = data[i][pidIdx];
      const val = Number(data[i][valIdx]) || 0;
      const ref = data[i][refIdx];

      /* 集計バケット決定 */
      const isToday = ts >= today0;
      const isYesterday = ts >= yesterday0 && ts < today0;

      function add(bucket) {
        if (type === 'page_view') bucket.pv++;
        if (sid) bucket.sessions.add(sid);
        if (type === 'add_to_cart') bucket.addCart++;
        if (type === 'begin_checkout') bucket.beginCheckout++;
        if (type === 'purchase') { bucket.purchase++; bucket.revenue += val; }
      }
      add(period);
      if (isToday) add(today);
      if (isYesterday) add(yesterday);

      /* 日別トレンド */
      const dayKey = ts.toISOString().slice(0,10);
      if (!dayMap[dayKey]) dayMap[dayKey] = { pv:0, purchase:0, revenue:0, sessions:new Set() };
      if (type === 'page_view') dayMap[dayKey].pv++;
      if (type === 'purchase') { dayMap[dayKey].purchase++; dayMap[dayKey].revenue += val; }
      if (sid) dayMap[dayKey].sessions.add(sid);

      /* 商品別 */
      if (type === 'add_to_cart' && pid) {
        productCart[pid] = (productCart[pid] || 0) + 1;
      }
      /* 流入元 */
      if (type === 'page_view' && ref) {
        const host = ref.replace(/^https?:\/\//, '').split('/')[0] || '(direct)';
        refMap[host] = (refMap[host] || 0) + 1;
      }
    }

    /* CVR 計算 */
    const todayCVR = today.sessions.size > 0 ? (today.purchase / today.sessions.size * 100) : 0;
    const yCVR = yesterday.sessions.size > 0 ? (yesterday.purchase / yesterday.sessions.size * 100) : 0;
    const periodCVR = period.sessions.size > 0 ? (period.purchase / period.sessions.size * 100) : 0;

    /* 日別配列 (古い順) */
    const trend = Object.keys(dayMap).sort().map(d => ({
      date: d,
      pv: dayMap[d].pv,
      sessions: dayMap[d].sessions.size,
      purchase: dayMap[d].purchase,
      revenue: dayMap[d].revenue
    }));

    /* TOP5 商品 */
    const topProducts = Object.keys(productCart)
      .map(pid => ({ product: pid, count: productCart[pid] }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 5);

    /* TOP5 流入元 */
    const topReferrers = Object.keys(refMap)
      .map(host => ({ host, count: refMap[host] }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 5);

    return jsonResponse({
      ok: true,
      range_days: days,
      today: {
        pv: today.pv, sessions: today.sessions.size,
        addCart: today.addCart, beginCheckout: today.beginCheckout,
        purchase: today.purchase, revenue: today.revenue,
        cvr: Math.round(todayCVR * 100) / 100
      },
      yesterday: {
        pv: yesterday.pv, sessions: yesterday.sessions.size,
        purchase: yesterday.purchase, revenue: yesterday.revenue,
        cvr: Math.round(yCVR * 100) / 100
      },
      period: {
        pv: period.pv, sessions: period.sessions.size,
        addCart: period.addCart, beginCheckout: period.beginCheckout,
        purchase: period.purchase, revenue: period.revenue,
        cvr: Math.round(periodCVR * 100) / 100
      },
      trend: trend,
      top_products: topProducts,
      top_referrers: topReferrers
    });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

function emptyAnalytics() {
  return {
    today: { pv:0, sessions:0, addCart:0, beginCheckout:0, purchase:0, revenue:0, cvr:0 },
    yesterday: { pv:0, sessions:0, purchase:0, revenue:0, cvr:0 },
    period: { pv:0, sessions:0, addCart:0, beginCheckout:0, purchase:0, revenue:0, cvr:0 },
    trend: [],
    top_products: [],
    top_referrers: []
  };
}
