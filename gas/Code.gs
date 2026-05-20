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
 *      - STRIPE_PRICE_MINI        : price_... (ミニプラン Stripe Price ID)
 *      - STRIPE_PRICE_PRO         : price_...
 *      - STRIPE_PRICE_VIP         : price_...
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
      /* ===== STAFF ===== */
      case 'staff_login':       return staffLogin(e.parameter);
      case 'staff_dashboard':   return staffDashboard();
      case 'staff_inventory':   return staffInventory();
      case 'staff_orders':      return staffOrders();
      case 'staff_analytics':   return staffAnalytics(e.parameter);
      case 'b2_csv':            return b2CsvExport();
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

  try {
    log(action, body);
    switch (action) {
      case 'create_checkout':              return createCheckout(body);
      case 'create_subscription_checkout': return createSubscriptionCheckout(body);
      case 'submit_order':                 return submitOrder(body);
      /* ===== LINE LIFF Auth ===== */
      case 'line_login':                   return lineLogin(body);
      case 'line_link_account':            return lineLinkAccount(body);
      case 'line_register':                return lineRegister(body);
      /* ===== STAFF (POST) ===== */
      case 'staff_update_stock':           return staffUpdateStock(body);
      case 'staff_product_save':           return staffProductSave(body);
      case 'staff_product_delete':         return staffProductDelete(body);
      case 'staff_gift_save':              return staffGiftSave(body);
      case 'staff_gift_delete':            return staffGiftDelete(body);
      case 'staff_subscription_save':      return staffSubscriptionSave(body);
      case 'staff_subscription_delete':    return staffSubscriptionDelete(body);
      case 'staff_ship':                   return staffShip(body);
      case 'submit_quiz':                  return submitQuiz(body);
      case 'submit_survey':                return submitSurvey(body);
      case 'log_event':                    return logEvent(body);
      case 'log_subscription_application': return logSubscriptionApplication(body);
      case 'request_otp':                  return requestOtp(body);
      case 'verify_otp':                   return verifyOtp(body);
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
    version: '2026.05.13',
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
  const shipping = calcShipping(subtotal, body.customer && body.customer.pref);
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
    customer_email: body.customer && body.customer.email,
    line_items: lineItems,
    metadata: {
      order_number: orderNum,
      mode: body.mode || 'single',
      customer_name: body.customer && body.customer.name,
      customer_phone: body.customer && body.customer.phone,
      line_uid:     (body.customer && body.customer.line_uid) || '',
      line_name:    (body.customer && body.customer.line_name) || '',
      destinations_json: JSON.stringify(body.destinations || []),
      /* ★ 在庫 decrement 用に items を保存 (Stripe metadata は 500 文字制限) */
      items_json: JSON.stringify(items.map(it => ({
        title: it.title || it.name || '',
        variant: it.variant || '',
        qty: it.qty || 1
      }))).slice(0, 480)
    }
  };

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
   POST: create_subscription_checkout (Stripe Subscriptions — 定期便)
   ============================================================ */
function createSubscriptionCheckout(body) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) throw new Error('Stripe not configured');

  const planMap = {
    starter: cfg('STRIPE_PRICE_MINI'),
    regular: cfg('STRIPE_PRICE_PRO'),
    volume:  cfg('STRIPE_PRICE_VIP')
  };
  const priceId = planMap[body.plan];
  if (!priceId) throw new Error('Invalid plan: ' + body.plan);

  const orderNum = generateOrderNumber();
  const successUrl = cfg('SUCCESS_URL') + '?session_id={CHECKOUT_SESSION_ID}&order=' + encodeURIComponent(orderNum);
  const cancelUrl = cfg('CANCEL_URL') + '?plan=' + body.plan;

  // 適用クーポン優先順位:
  //   1. STRIPE_DEMO_COUPON (デモ期間 100%OFF 自動適用) ← デモ時はこれ
  //   2. STRIPE_COUPON_50OFF (本番 初月50%OFF) ← 本番ローンチ時にこれだけ残す
  const demoCoupon = cfg('STRIPE_DEMO_COUPON');
  const halfCoupon = cfg('STRIPE_COUPON_50OFF');
  const applyCoupon = demoCoupon || halfCoupon || '';

  const subParams = {
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'ja',
    payment_method_types: ['card'],
    customer_email: body.customer && body.customer.email,
    line_items: [{
      price: priceId,
      quantity: 1
    }],
    subscription_data: {
      metadata: {
        plan: body.plan,
        order_number: orderNum,
        is_demo: demoCoupon ? 'true' : 'false'
      }
    },
    metadata: {
      order_number: orderNum,
      plan: body.plan,
      mode: 'subscription',
      is_demo: demoCoupon ? 'true' : 'false'
    }
  };
  if (applyCoupon) {
    subParams.discounts = [{ coupon: applyCoupon }];
  }
  const params = flattenForm(subParams);

  const res = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'post',
    payload: params,
    headers: { 'Authorization': 'Bearer ' + STRIPE },
    muteHttpExceptions: true
  });

  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error('Stripe: ' + data.error.message);

  recordPendingOrder(orderNum, data.id, body, null, 0, 'subscription');

  return jsonResponse({ ok: true, url: data.url, session_id: data.id, order_number: orderNum });
}

/* ============================================================
   POST: stripe_webhook
   ============================================================ */
function handleStripeWebhook(e) {
  const sig = e.parameter && e.parameter.signature;
  const raw = e.postData && e.postData.contents;

  // 注意: 本格的な署名検証は GAS の制約上、Crypto API 経由で要実装
  // ここでは payload を信頼するか、Webhook secret 確認の簡易版を実装

  let event;
  try { event = JSON.parse(raw); } catch (err) {
    return jsonResponse({ ok:false, error: 'Invalid JSON' });
  }

  log('stripe_webhook_' + event.type, { id: event.id });

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        return finalizeOrder(event.data.object);
      case 'customer.subscription.created':
        return logSubscriptionCreated(event.data.object);
      case 'customer.subscription.deleted':
        return logSubscriptionCancelled(event.data.object);
      case 'invoice.payment_succeeded':
        return logInvoicePaid(event.data.object);
      default:
        return jsonResponse({ ok:true, ignored: event.type });
    }
  } catch (err) {
    log('stripe_webhook_error', { type: event.type }, { error: err.message });
    return jsonResponse({ ok:false, error: err.message });
  }
}

function finalizeOrder(session) {
  // pending_orders から該当を引いてきて、完了処理
  const sh = sheet('orders', [
    'order_number','placed_at','session_id','customer_name','customer_email','customer_phone',
    'mode','total','shipping','payment_status','payment_method',
    'destinations_json','items_json','metadata_json','line_uid','line_name'
  ]);
  const meta = session.metadata || {};
  const orderNum = meta.order_number || ('SESSION-' + session.id.slice(-8));
  const total = session.amount_total || 0;

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
    meta.line_items_json || '[]',
    JSON.stringify(meta),
    meta.line_uid || '',   // ★ LINE 連携: orders に line_uid を直接記録
    meta.line_name || ''
  ]);

  // メール通知 (顧客 + スタッフ)
  sendCustomerReceiptEmail(session, orderNum);
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
          '江田畜産株式会社\nhttps://eda-livestock-ec.com/'
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

/* GET ?action=customer_lookup&email=xxx (Token認証推奨だが、デモ用に直接ルックアップも可) */
function customerLookup(params) {
  const email = params.email;
  if (!email) return jsonResponse({ success:false, message:'email required' });
  const orders = getOrdersByEmail(email);
  const customer = getCustomerByEmail(email, orders);
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

function dashboardSummary(params) {
  const range = params.range || '30d';
  const days = parseInt(range) || 30;
  const since = new Date(Date.now() - days*24*60*60*1000);

  const ordersData = sheet('orders').getDataRange().getValues();
  let revenue = 0, orderCount = 0, customers = {};
  for (let i = 1; i < ordersData.length; i++) {
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

function lineFriends() {
  // LINE Messaging API 連携時に実装
  return jsonResponse({ ok:true, friends: 0 });
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
      '▼ 配送追跡（LINE で「' + orderNum + '」と送信ください）\n' +
      'https://line.me/R/ti/p/@706sgiuq\n\n' +
      '▼ マイページ\n' +
      'https://edywagyu.github.io/eda-livestock-web/mypage.html\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━\n' +
      '江田畜産株式会社\n' +
      'backoffice@eda-livestock.com\n' +
      'https://eda-livestock-ec.com/\n'
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
    // 新価格 (¥6,980 / ¥12,800 / ¥27,400) — 2026-05-12 サイト表示と整合
    STRIPE_PRICE_MINI: 'price_1TWAN0GSkhU1UEciNGZHORc3',
    STRIPE_PRICE_PRO:  'price_1TWAN0GSkhU1UEciKod4PGpk',
    STRIPE_PRICE_VIP:  'price_1TWAN1GSkhU1UEciXQJyqNet',
    STRIPE_DEMO_COUPON: 'DEMO100',
    STRIPE_COUPON_50OFF: 'FIRST50',
    STAFF_NOTIFICATION_EMAIL: 'backoffice@eda-livestock.com',
    SUCCESS_URL: 'https://edywagyu.github.io/eda-livestock-web/order-complete.html',
    CANCEL_URL: 'https://edywagyu.github.io/eda-livestock-web/checkout.html'
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
    const orders = getOrdersByEmail(body.email);
    if (!orders.length) {
      // 該当 email の注文が無い → 連携不可
      return jsonResponse({ ok:true, customer:null, error:'no orders found for this email' });
    }

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

    const customer_name = (orders[0] && orders[0].customer_name) || body.email.split('@')[0];
    const total_spent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);

    if (foundRow > 0) {
      // 既存 row の line_uid を更新
      sh.getRange(foundRow, lineIdx + 1).setValue(body.line_uid);
      sh.getRange(foundRow, nameIdx + 1).setValue(body.display_name || '');
      sh.getRange(foundRow, linkedAtIdx + 1).setValue(new Date());
    } else {
      // 新規 row 追加
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
      line_name: body.display_name || ''
    };

    // LINE プッシュ通知: 連携完了 + 配送状況リンク
    sendLinePush(body.line_uid, [buildLinkSuccessMessage(customer_name)]);

    return jsonResponse({ ok:true, customer, orders });
  } catch (e) {
    return jsonResponse({ ok:false, error: e.message });
  }
}

/* POST line_register { line_uid, display_name, name, phone, zip, address }
   - LINE 友だち追加からの新規会員登録（注文不要）
   - line_uid で既存チェック → 既存なら返却のみ、新規なら customers に追加
*/
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
    row[headers.indexOf('total_spent')]  = 0;
    row[headers.indexOf('order_count')]  = 0;
    sh.appendRow(row);

    var custName = body.name || body.display_name || '';

    // LINE プッシュ通知: 会員登録完了 + オーガニック商品リンク
    sendLinePush(body.line_uid, [buildRegisterSuccessMessage(custName)]);

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
  if (!token || !lineUid) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ to: lineUid, messages: messages }),
      muteHttpExceptions: true
    });
  } catch (e) {
    log('line_push_error', { line_uid: lineUid, error: e.message });
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
        url: 'https://edywagyu.github.io/eda-livestock-web/public/images/cuts/hero-0.jpeg',
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

/** 新規会員登録後に送る Flex Message */
function buildRegisterSuccessMessage(customerName) {
  var liffShop = 'https://liff.line.me/' + cfg('LIFF_ID', '1657458587-mz1dR9e6') + '/shop.html';
  return {
    type: 'flex',
    altText: '会員登録完了 — オーガニック和牛がご覧いただけます',
    contents: {
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://edywagyu.github.io/eda-livestock-web/public/images/cuts/hero-0.jpeg',
        size: 'full',
        aspectRatio: '20:9',
        aspectMode: 'cover'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: '🎉 会員登録ありがとうございます', weight: 'bold', size: 'lg', color: '#1a1a1a' },
          { type: 'text', text: (customerName || 'お客') + '様、限定のオーガニック和牛商品がご覧いただけるようになりました。', wrap: true, size: 'sm', color: '#666666' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: 'オーガニック製品を見る', uri: liffShop },
            style: 'primary',
            color: '#2d5016'
          }
        ]
      }
    }
  };
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
  for (let i = 1; i < data.length; i++) {
    if (data[i][onIdx] === body.order_number) {
      // tracking_number 列を追加 (なければ)
      let tnIdx = headers.indexOf('tracking_number');
      if (tnIdx === -1) {
        sh.getRange(1, headers.length + 1).setValue('tracking_number');
        tnIdx = headers.length;
      }
      sh.getRange(i + 1, tnIdx + 1).setValue(body.tracking_number || '');
      if (stIdx >= 0) sh.getRange(i + 1, stIdx + 1).setValue('shipped');
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
    const csv = ['お届け先電話番号,お届け先郵便番号,お届け先住所,お届け先名'];
    data.slice(1).forEach(row => {
      const dest = get(row, 'destinations_json');
      const name = get(row, 'customer_name');
      try {
        const d = JSON.parse(dest);
        d.forEach(addr => {
          csv.push([addr.tel || '', addr.zip || '', (addr.pref || '') + (addr.address || ''), addr.name || name].join(','));
        });
      } catch (e) {
        csv.push(['', '', '', name].join(','));
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
