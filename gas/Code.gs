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
  const id = cfg('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID not configured');
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
      case 'dashboard':         return dashboardSummary(e.parameter);
      case 'line_friends':      return lineFriends();
      case 'customer_lookup':   return customerLookup(e.parameter);
      default:                  return jsonResponse({ ok:false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    log(action + '_error', { error: err.message }, { stack: err.stack });
    return jsonResponse({ ok:false, error: err.message });
  }
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
      case 'submit_quiz':                  return submitQuiz(body);
      case 'submit_survey':                return submitSurvey(body);
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
  const lineItems = [];
  const items = collectItems(body);
  items.forEach(it => {
    lineItems.push({
      'price_data[currency]': 'jpy',
      'price_data[product_data][name]': it.title + (it.variant ? ' ('+it.variant+')' : ''),
      'price_data[unit_amount]': Math.round(it.price),
      'quantity': it.qty
    });
  });

  // 送料・税はチェックアウト側で計算 (Stripe automatic_tax か手動)
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const shipping = calcShipping(subtotal, body.customer && body.customer.pref);
  if (shipping > 0) {
    lineItems.push({
      'price_data[currency]': 'jpy',
      'price_data[product_data][name]': '送料',
      'price_data[unit_amount]': shipping,
      'quantity': 1
    });
  }

  const orderNum = generateOrderNumber();
  const successUrl = cfg('SUCCESS_URL') + '?session_id={CHECKOUT_SESSION_ID}&order=' + encodeURIComponent(orderNum);
  const cancelUrl = cfg('CANCEL_URL');

  // 決済方法
  const methodTypes = ['card'];
  if (body.payment_method === 'bank') methodTypes.push('konbini', 'customer_balance');

  const checkoutParams = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    locale: 'ja',
    payment_method_types: methodTypes,
    customer_email: body.customer && body.customer.email,
    line_items: lineItems,
    metadata: {
      order_number: orderNum,
      mode: body.mode || 'single',
      customer_name: body.customer && body.customer.name,
      customer_phone: body.customer && body.customer.phone,
      destinations_json: JSON.stringify(body.destinations || [])
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
    'destinations_json','items_json','metadata_json'
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
    JSON.stringify(meta)
  ]);

  // メール通知 (顧客 + スタッフ)
  sendCustomerReceiptEmail(session, orderNum);
  sendStaffNotificationEmail(session, orderNum);

  // 顧客マスタ upsert
  upsertCustomer({
    email: session.customer_details && session.customer_details.email,
    name: meta.customer_name,
    phone: meta.customer_phone,
    last_order: orderNum,
    last_order_total: total,
    last_order_at: new Date()
  });

  return jsonResponse({ ok:true, order: orderNum });
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
  // products シートがあれば返す、なければ products-master.js とは独立した最小返り値
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
    'customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid'
  ]);
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === c.email) {
      sh.getRange(i+1, 6).setValue(c.last_order);
      sh.getRange(i+1, 7).setValue((Number(data[i][6]) || 0) + (c.last_order_total || 0));
      sh.getRange(i+1, 8).setValue((Number(data[i][7]) || 0) + 1);
      return;
    }
  }
  sh.appendRow([
    'C-' + Utilities.getUuid().slice(0, 8),
    c.email,
    c.name || '',
    c.phone || '',
    c.last_order,
    c.last_order,
    c.last_order_total || 0,
    1,
    ''
  ]);
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
  sheet('orders', ['order_number','placed_at','session_id','customer_name','customer_email','customer_phone','mode','total','shipping','payment_status','payment_method','destinations_json','items_json','metadata_json']);
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
  Logger.log('All sheets initialized');
}
