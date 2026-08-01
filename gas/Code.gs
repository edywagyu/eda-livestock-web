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

/* 社内向け「注文通知」の宛先（Tom 2026-06-08）。EC対応の田崎さん＋backoffice の両方へ送る。
   Script Property STAFF_NOTIFICATION_EMAIL に他アドレスがあれば取り込み、重複は除外して結合。
   ※ お客様への確認メールはこの関数を使わない（お客様アドレス宛・LINE連携時は送らないルールを維持）。 */
function staffNotificationRecipients() {
  var list = ['r.tasaki@eda-livestock.com', 'backoffice@eda-livestock.com'];
  var prop = cfg('STAFF_NOTIFICATION_EMAIL');
  if (prop) String(prop).split(',').forEach(function (e) {
    e = e.trim();
    if (e && list.indexOf(e) === -1) list.push(e);
  });
  return list.join(',');
}

/* 読み取り専用のシート取得（存在しなければ null・新規作成しない）。
   🔴 Code_v2_Additions.gs 側の定義が本番プロジェクトへ同期されておらず、
   survey_responses 等の overview が「getSheet is not defined」で落ちていた恒久対策（2026-06-12）。
   同名定義が複数ファイルにあっても GAS は後勝ちで動作し実装は同一＝無害。 */
function getSheet(name) {
  return ss().getSheetByName(name);
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

/* 🔒 staff トークン必須アクション（router で一括ガード）。
   staff_login は token 発行の入口なので除外。token は GET/POST とも e.parameter.token で受ける。 */
var STAFF_PROTECTED = {
  staff_dashboard: 1, staff_inventory: 1, staff_orders: 1, staff_analytics: 1, b2_csv: 1,
  customers: 1, customers_csv: 1, customers_segment: 1, segment_stats: 1,
  orders: 1, subscriptions: 1, survey_responses: 1, quiz_responses: 1, shipments: 1,
  staff_update_stock: 1, staff_product_save: 1, staff_product_delete: 1,
  staff_gift_save: 1, staff_gift_delete: 1, staff_subscription_save: 1, staff_subscription_delete: 1,
  staff_ship: 1, staff_confirm_payment: 1,
  diag_webhooks: 1, diag_recover_sub: 1, diag_subscriptions: 1, diag_cancel_subscription: 1,
  diag_update_webhook: 1, diag_find_session: 1, diag_dedupe_orders: 1
};

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'ping';
  if (STAFF_PROTECTED[action] && !requireStaff(e)) {
    return jsonResponse({ ok:false, error: 'unauthorized' });
  }
  try {
    switch (action) {
      case 'ping':              return ping();
      case 'order_status':      return orderStatus(e.parameter.session_id);
      case 'public_products':   return publicProducts();
      case 'public_gifts':      return publicGifts();
      case 'public_subscriptions': return publicSubscriptionPlans();
      case 'public_catalog':    return publicCatalog();
      case 'cart_holds':        return cartHoldsPublic(e.parameter);   /* カート確保数 (gas/cart_holds.gs) */
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
      case 'diag_bank_reminders': return jsonResponse(remindPendingBankTransfers(true));   /* ドライラン: 候補一覧のみ・送信なし */
      case 'setup_bank_reminder': return jsonResponse(setupBankReminderTrigger());          /* 日次10時トリガー設置(冪等) */
      case 'diag_ship_reminders': return ContentService.createTextOutput(alertUnshippedOrders(true)); /* 発送リマインドのドライラン(送信せず本文表示) */
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

  if (STAFF_PROTECTED[action] && !requireStaff(e)) {
    return jsonResponse({ ok:false, error: 'unauthorized' });
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
    version: '2026.07.26-line10-coupon-fix',
    versionNote: 'v42: LINE10クーポンのキー名不一致を根治(2026-07-26)。決済ページは couponCode(キャメル)を送るのに createCheckout は coupon_code(スネーク)を読んでおり、割引も「1人1回」ガードも一度も発火していなかった(createBankOrder は元から couponCode で正常)。normalizeCustomerCoupon_ を新設し両キーを受けて大文字化＋許可リスト照合(エダチク10 / LINK_COUPON_CODE)。LINE10 は Stripe セッション作成前に assertLinkCouponUnused_ を実行し、カード/銀行振込の両方でガード。checkoutParams.discounts に載せるのは STRIPE_DEMO_COUPON(管理者Script Property)のみに限定＝顧客入力を Stripe coupon ID として渡す経路を廃止(FIRST50 直打ち等を封じる)。値引きの実体はフロントの単価書き換えなので discounts には載せない(二重割引防止)。フロント側は checkout.html の COUPONS に LINE10 を登録＋戻るリンク誤タップの確認・shop.html のモバイル2列化/バッジ重なり/カートのサムネ切れ根治。v39: Stripe metadata 500字制限バグ根治(2026-07-13)。createCheckoutが destinations_json/deliveries_json/items_json を Stripe metadata に保存するのをやめ(v34のlean化でも9品種11点カートで destinations_json=551字となり決済不能＝2026-07-06実顧客3連続失敗)、完全版(delivery込みdestinations＋items)は pending_orders シートへ保存(recordPendingOrderに items_json 列を ensureCol 追加)→finalizeOrder が session_id で復元して orders保存・在庫減算・スタッフ通知・metadata_json に使用。items_json の .slice(0,480) 途中切断(壊れたJSONで在庫減算スキップ)も撤去で根治。旧セッション(metadataに実体あり)は従来経路のまま後方互換。定期便 createSubscriptionCheckout は1宛先5フィールド固定で500字リスク無し＝無変更。v38: 振込未入金リマインド(2026-07-04 Tom承認)。ordersの payment_method=bank & payment_status=awaiting_payment を日次10時に走査(bankReminderDaily trigger)、注文3〜14日窓・1回のみ(bank_reminder_at列で冪等)・社内/テスト除外で、LINE連携済はLINE(リマインド文+振込先Flex再送)・無ければブランドHTMLメール(sendBankReminderEmail)。?action=diag_bank_reminders=ドライラン / setup_bank_reminder=トリガー設置(冪等)。背景=ファネル実測で銀行振込の未入金離脱を検出。v37: 未発送アラート(alertUnshippedOrders)から定期便を除外(mode=subscriptionで始まる注文＝初回subscription_first/継続subscription_renewal を一律スキップ)。毎月1日発送の確定運用の定期便が「2日以上未発送」で毎朝アラートされ続けるノイズを停止(2026-06-11松本様の初回ボックスで6/13〜毎日backofficeへ誤通知)。単品(通常注文)の発送漏れアラートは従来どおり継続。2026-06-17 Tom指示。v36: 顧客向けメールをブランドHTML化(緑#0F3D2E×金#D4A93B×クリーム/写真=LINE Flexと同素材hero-0・ship-truck/送信者表示名=江田畜産｜EDA WAGYU)＋文字化け根治(plain単独だと一部経路でISO-2022-JP変換され罫線━や絵文字が化ける→htmlBody UTF-8を必ず併送・plain fallbackはJIS外文字を排除)。対象=注文確認/発送通知/振込案内(OTPは送信者名のみ)。定期便を出荷フローへ包含=b2Rows_がitems空の定期便注文にも品名「定期便ボックス(プラン)」でラベル行を生成(電話はtel→phone→注文者電話フォールバック=定期便destはphoneキー)＋alertUnshippedOrdersも定期便(宛先あり)を監視対象に(2026-06-11松本様の初回ボックスが発送リスト/B2/未発送アラート全てから構造的に漏れていた穴の修正)。getSheetをCode.gsに定義(survey_responses「getSheet is not defined」クラッシュ5件の恒久修正)。v35: ありがとうページ(order-complete.html→?action=order_status)でfinalizeOrderを実行＝Stripe webhookのGAS /exec 302失敗に依存せず新規注文・定期便初月を確実に確定。finalizeOrderはsession_id冪等(ScriptLock+既存チェック)でwebhook復活時も二重記録なし。webhook受信コード(handleStripeWebhook/processWebhookQueue)は保険で残置。v34: お届け日時をお届け先ごとに対応(b2Rows_=各destinationのaddr.delivery.date/timeを優先・無ければ注文共通delivery_dateへフォールバック)＋timeCodeを時間帯テキスト→ヤマトコード変換に拡充(従来は午前以外が空)。createCheckoutはStripe metadata 500字制限回避でdestinationsをdelivery抜きのlean保存+deliveries_json(compact)分離→finalizeOrderでdestinationsに再マージしてシート保存(銀行振込は直接保存のままinline)。フロント=決済ページのお届け日時を「お届け先カードごと」に再構成(定期便自宅=毎月1日固定・時間帯のみ/ギフト=日付指定可/単品自分用=定期便と一緒or先に送るを選択)＋ご注文サマリーの割引二重表示を修正(ミニ通常価格表示で内訳一致)＋index OGP og:title/twitter:titleを「江田畜産」に・og:url/imageを本番ドメインへ。v33: 全体コードレビュー修正(2026-06-08)。getOrdersByEmail を items_json パースに修正(マイページ/LINE/OTPで注文明細が常に空だったバグ)＋staffAnalytics日別トレンドのdayKeyをAsia/Tokyo基準に(0〜9時の取引が前日にズレる問題)。フロント側=レシピ/定期便アドオンの価格をカタログに統一・checkout削除ボタン修正・products-master版番号統一。v32: 社内向け「注文通知」(新規注文/振込待ち)の宛先を田崎(r.tasaki@)＋backoffice@ の両方に変更(staffNotificationRecipients・Tom 2026-06-08)。お客様への確認/振込案内メールは従来通りお客様アドレス宛・LINE連携済みなら送信しない(不変)。v31: 専用「EC発送」スプシ自動更新を追加。未発送注文を基本レイアウト28列で writeShippingSheet が専用スプシ(Script Property SHIPPING_SHEET_ID)へ30分ごと自動書出(「発送リスト」+「使い方」タブ)→スタッフはPCで開きCSVダウンロード→B2取込。setupShippingSheet を1回実行でスプシ作成+トリガー設置。b2CsvExportは共有ヘルパー b2Rows_ にリファクタ(出力不変)。v30: 発送伝票CSVをヤマト「基本レイアウト」標準フォーマット(公式 送り状発行データレイアウト No.1〜28順・28列)に刷新→スタッフは取込パターン=基本レイアウト(csv)を選ぶだけ(カスタム紐付け不要・列ズレ根絶)。固定値=送り状種類0発払い/クール区分1冷凍/出荷予定日=当日JST/敬称様/依頼主空欄=B2アカウント既定。配達時間帯はコード(0812等)のみ・個数列は廃止(1宛先=1ラベル)。v29: 発送処理(staffShip)でお届け予定日をordersに保存→マイページ「次回お届け予定」に反映(従来は通知のみで未保存=日程調整中表示のバグ修正)。v28: 発送伝票CSVをヤマトB2クラウド向けフル項目化(お客様管理番号/クール区分冷凍/お届け予定日/配達時間帯/お届け先/敬称様/品名/個数)＝住所も品名もクールも自動。依頼主はB2クラウド固定設定(お客様コード080579307081)。v27: 発送通知LINEのヒーロー画像を江田畜産オリジナルの配送トラックイラスト(public/images/line/ship-truck.png・16:9)に差し替え。v26: 未発送アラートに「出荷物あり(配送対象明細あり)」条件追加＝定期便/明細なしの誤検知を除外。v25: 入金済×N日未発送を毎朝検知しbackofficeへメール(alertUnshippedOrders/日次trigger #1主因対策)＋b2_csv各項目のカンマ/改行除去で伝票列ズレ防止(#2)。v24: 発送処理staffShipに通知ON/OFF(notify:false=記録のみ・手動連絡用)を追加。v23: 発送伝票b2_csvを未発送の実注文のみ＋社内テスト(@eda-livestock.com)除外(#4)。v22: LINE↔注文を電話番号で自動連携(lineLogin電話ブリッジ+注文時逆連携 #1再犯防止)。v21: Stripe webhook 非同期キュー化(受信→webhook_queueに積んで即200→1分毎trigger processWebhookQueueが再照会検証&finalizeOrder等を実行)。同期処理の応答遅延によるタイムアウト失敗→自動停止を根治。v20: staff/dashboard 認証＝署名トークン・発送通知冪等化・在庫LockService。v19: 銀行振込=GMOあおぞら手動フロー',
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

  /* 🔒 他のお客様がカート確保中の分 (gas/cart_holds.gs)。表示側の「残り○」と同じ数字を
     ここでも押さえる ＝ 表示だけ減らして実際は売る、をやらないための対。 */
  try {
    const heldErrors = cartHoldErrors_(items, body.analytics_session_id);
    if (heldErrors.length > 0) {
      return jsonResponse({
        ok: false, error: 'CART_HELD',
        message: '以下の商品は他のお客様がカートに確保中です:\n' + heldErrors.join('\n'),
        out_of_stock: heldErrors
      });
    }
  } catch (e) { log('cart_hold_check_warn', { error: e.message }); }

  // 🎟️ 顧客クーポン: 正規化 → 許可リスト照合 → LINE10 は「1人1回」ガード。
  //    🔴 Stripe には渡さない（値引きはフロントが単価を書き換え済み＝渡すと二重割引）。
  //    ガードは Stripe セッションを作る前に投げる＝副作用ゼロで止める。
  const custCoupon = normalizeCustomerCoupon_(body);
  if (custCoupon === linkCouponCode_()) {
    assertLinkCouponUnused_((body.customer && body.customer.email) || '');
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
      coupon_code:  custCoupon,   // 使用クーポン（1人1回判定は orders.metadata_json を走査）
      // 🔴 destinations/items の実体は Stripe metadata に入れない（1値500字制限。lean化しても
      //    9品種11点カートで destinations_json=551字となり決済不能＝2026-07-06 実顧客3連続失敗）。
      //    完全版(delivery込み destinations + items)は recordPendingOrder が pending_orders シートに
      //    order_number/session_id キーで保存 → finalizeOrder が復元して orders 保存・在庫減算・通知に使う。
      delivery_date: (body.delivery && body.delivery.date) || '',   // 後方互換 top-level (最初の発送分・ISO YYYY-MM-DD・未指定は空)
      delivery_time: (body.delivery && body.delivery.time) || ''    // 後方互換 top-level (表示用ラベル文字列)
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
  // 🔴🔴 discounts に載せてよいのは **Script Property 由来の管理者クーポンだけ**（2026-07-26）。
  //   顧客入力(custCoupon)を Stripe coupon ID として渡してはいけない。理由2つ:
  //   ① 値引きはフロントが単価を書き換えて実現済み＝ここで更に引くと二重割引。
  //   ② 顧客が任意の Stripe coupon ID を指定できてしまう（例 定期便用 FIRST50=50%OFF を
  //      単品注文に適用）。旧コードは body.coupon_code をそのまま discounts に渡していたが、
  //      フロントが送るキーが couponCode だったため一度も発火しておらず、実害は出ていない。
  const demoCoupon = cfg('STRIPE_DEMO_COUPON');
  if (demoCoupon) {
    checkoutParams.discounts = [{ coupon: demoCoupon }];
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

  // pending 注文として記録（items も保存＝finalizeOrder が metadata の代わりにここから復元する）
  recordPendingOrder(orderNum, data.id, body, subtotal, shipping, null, items);

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

  /* 🔒 他のお客様がカート確保中の分 (gas/cart_holds.gs)。表示側の「残り○」と同じ数字を
     ここでも押さえる ＝ 表示だけ減らして実際は売る、をやらないための対。 */
  try {
    const heldErrors = cartHoldErrors_(items, body.analytics_session_id);
    if (heldErrors.length > 0) {
      return jsonResponse({
        ok: false, error: 'CART_HELD',
        message: '以下の商品は他のお客様がカートに確保中です:\n' + heldErrors.join('\n'),
        out_of_stock: heldErrors
      });
    }
  } catch (e) { log('cart_hold_check_warn', { error: e.message }); }

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

  // 🎟️ 銀行振込も同じクーポン規則（カード側だけガードすると振込を選ぶだけで再利用できてしまう）
  const custCoupon = normalizeCustomerCoupon_(body);
  if (custCoupon === linkCouponCode_()) {
    assertLinkCouponUnused_((body.customer && body.customer.email) || '');
  }

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
    coupon_code: custCoupon,
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
  var amount = '¥' + Number(totalYen || 0).toLocaleString();
  var body =
    greeting + '\n\n' +
    'この度はご注文いただきありがとうございます。\n' +
    '下記の口座へお振込をお願いいたします。ご入金を確認後、商品を発送いたします。\n\n' +
    'ご注文番号: ' + orderNum + '\n' +
    'お振込金額: ' + amount + '\n\n' +
    '【お振込先】\n' +
    bankAccountText() + '\n\n' +
    '※ 振込手数料はお客様のご負担にてお願いいたします。\n' +
    '※ ご入金の確認後、発送のご連絡（追跡番号）をお送りいたします。\n' +
    '※ お振込の際は、お名前（ご注文者様）でお願いいたします。\n\n' +
    '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
    'https://www.eda-livestock.com/';
  MailApp.sendEmail({
    to: email,
    name: BRAND_MAIL.sender,
    subject: '【江田畜産】お振込先のご案内（' + orderNum + '）',
    body: body,
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroOrder,
      title: 'お振込先のご案内',
      intro: greeting + '、この度はご注文いただき誠にありがとうございます。<br>下記の口座へお振込をお願いいたします。ご入金の確認後、商品を発送いたします。',
      rows: [['ご注文番号', orderNum], ['お振込金額', amount]],
      boxText: '<span style="font-weight:bold;color:#0F3D2E;">お振込先</span><br>' + String(bankAccountText()).replace(/\n/g, '<br>'),
      note: '※ 振込手数料はお客様のご負担にてお願いいたします。<br>※ お振込の際は、ご注文者様のお名前でお願いいたします。<br>※ ご入金の確認後、発送のご連絡（追跡番号）をお送りいたします。'
    })
  });
}

/* スタッフ向け「振込待ち」通知（入金を実額で照合するアナログ確認の起点）。 */
function sendStaffBankPendingEmail(orderNum, totalYen, cust) {
  var to = staffNotificationRecipients();   /* 田崎＋backoffice 両方（Tom 2026-06-08）*/
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
   💰 振込未入金リマインド（v38 / 2026-07-04 Tom承認）
   ・対象: orders の payment_method=bank & payment_status=awaiting_payment
   ・注文から 3〜14日 の窓のみ / 1回だけ（bank_reminder_at 列で冪等）
   ・社内(@eda-livestock.com)・テストは除外
   ・LINE連携済みは LINE（リマインド文＋振込先Flex再送）、無ければメール
   ・?action=diag_bank_reminders でドライラン / setup_bank_reminder でトリガー設置
   ============================================================ */
const BANK_REMINDER_AFTER_DAYS = 3;
const BANK_REMINDER_MAX_DAYS = 14;

function remindPendingBankTransfers(dryRun) {
  dryRun = dryRun === true;   /* trigger のイベントオブジェクト等が渡っても誤ドライラン化しない */
  var sh = sheet('orders');
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return { ok: true, candidates: [], sent: 0, dryRun: dryRun };
  var headers = data[0];
  var idx = function (n) { return headers.indexOf(n); };
  var remIdx = idx('bank_reminder_at');
  if (remIdx === -1 && !dryRun) {
    sh.getRange(1, headers.length + 1).setValue('bank_reminder_at');
    headers.push('bank_reminder_at');
    remIdx = headers.length - 1;
  }
  var now = new Date();
  var out = [], sent = 0;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[idx('payment_method')] || '') !== 'bank') continue;
    if (String(row[idx('payment_status')] || '').toLowerCase() !== 'awaiting_payment') continue;
    var em = String(row[idx('customer_email')] || '').toLowerCase().trim();
    if (em.indexOf('@eda-livestock.com') >= 0 || em.indexOf('test@') === 0) continue;
    if (remIdx >= 0 && row[remIdx]) continue;                       /* リマインド済み */
    var placed = row[idx('placed_at')] ? new Date(row[idx('placed_at')]) : null;
    var days = placed ? Math.floor((now - placed) / 86400000) : -1;
    if (days < BANK_REMINDER_AFTER_DAYS || days > BANK_REMINDER_MAX_DAYS) continue;
    var on = row[idx('order_number')], name = row[idx('customer_name')] || '';
    var total = Number(row[idx('total')]) || 0;
    var cand = { order: on, days: days, total: total, via: '' };
    out.push(cand);
    if (dryRun) continue;
    var ok = false;
    var uid = String(row[idx('line_uid')] || '').trim() || lineUidForEmail(em);
    if (uid) {
      try {
        ok = sendLinePush(uid, [
          { type: 'text', text: (name ? name + '様\n' : '') + 'ご注文（' + on + '）のお振込がまだ確認できておりません。お手続きがお済みの場合は行き違いですのでご容赦ください。\nお振込先を改めてお送りいたします🙇' },
          buildBankTransferMessage(name, on, total)
        ]);
        if (ok) cand.via = 'line';
      } catch (e) { log('bank_reminder_line_error', { order: on, error: e.message }); }
    }
    if (!ok && em) {
      try { sendBankReminderEmail(em, name, on, total); ok = true; cand.via = 'email'; }
      catch (e) { log('bank_reminder_email_error', { order: on, error: e.message }); }
    }
    if (ok) {
      sh.getRange(i + 1, remIdx + 1).setValue(new Date());
      sent++;
    }
  }
  log('bank_reminder', { candidates: out.length, sent: sent, dryRun: dryRun });
  return { ok: true, candidates: out, sent: sent, dryRun: dryRun };
}

/* 顧客向け 振込リマインドメール（brandEmailHtml_ 準拠・htmlBody必須） */
function sendBankReminderEmail(email, customerName, orderNum, totalYen) {
  if (!email) return;
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  var amount = '¥' + Number(totalYen || 0).toLocaleString();
  MailApp.sendEmail({
    to: email,
    name: BRAND_MAIL.sender,
    subject: '【江田畜産】お振込のご確認（' + orderNum + '）',
    body:
      greeting + '\n\n' +
      '先日はご注文いただき誠にありがとうございます。\n' +
      'ご注文のお振込がまだ確認できておりません。行き違いの場合はご容赦ください。\n\n' +
      'ご注文番号: ' + orderNum + '\n' +
      'お振込金額: ' + amount + '\n\n' +
      '【お振込先】\n' + bankAccountText() + '\n\n' +
      '※ ご入金の確認後、発送のご連絡（追跡番号）をお送りいたします。\n' +
      '※ ご不明点はこのメールへの返信にてお気軽にご連絡ください。\n\n' +
      '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
      'https://www.eda-livestock.com/',
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroOrder,
      title: 'お振込のご確認',
      intro: greeting + '、先日はご注文いただき誠にありがとうございます。<br>ご注文のお振込がまだ確認できておりません。行き違いの場合はご容赦ください。',
      rows: [['ご注文番号', orderNum], ['お振込金額', amount]],
      boxText: '<span style="font-weight:bold;color:#0F3D2E;">お振込先</span><br>' + String(bankAccountText()).replace(/\n/g, '<br>'),
      note: '※ ご入金の確認後、発送のご連絡（追跡番号）をお送りいたします。<br>※ ご不明点はこのメールへの返信にてお気軽にご連絡ください。'
    })
  });
}

/* 日次トリガーの実体（trigger はイベントObjを渡すため wrapper で dryRun 混入を防ぐ） */
function bankReminderDaily() {
  return remindPendingBankTransfers(false);
}

/* トリガー設置（冪等・1回だけ ?action=setup_bank_reminder で実行） */
function setupBankReminderTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'bankReminderDaily'; });
  if (!has) ScriptApp.newTrigger('bankReminderDaily').timeBased().everyDays(1).atHour(10).create();
  return { ok: true, created: !has };
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
   POST: stripe_webhook  (⚡ 非同期キュー方式 2026-06-05)
   ------------------------------------------------------------
   旧実装は「受信 → Stripe再照会 → finalizeOrder(メール2通/在庫/Lock最大30s)
   → 200」を同期実行していたため応答に十数秒かかり、Stripe のタイムアウトを
   超えて全配信が失敗扱い → 9日連続失敗で 2026-06-05 にエンドポイント自動停止。
   対策: 受信したら webhook_queue に積んで【即 200】を返す。重い処理と
   Stripe 再照会による実在検証は 1分毎の time-trigger processWebhookQueue()
   が裏で実行する。受信応答はシート追記1回のみ＝1秒未満でタイムアウト根治。
   ============================================================ */
var WEBHOOK_QUEUE_HEADERS = ['received_at','event_id','type','raw_json','status','attempts','processed_at','error'];

function handleStripeWebhook(e) {
  const raw = (e && e.postData && e.postData.contents) || '';

  let event;
  try { event = JSON.parse(raw); } catch (err) {
    return jsonResponse({ ok:false, error: 'Invalid JSON' });
  }

  const evId = event && event.id;
  const evType = (event && event.type) || '';

  // Stripe の event 形式だけ受理（実在検証は処理時に再照会で行う）。
  // 形式不正は 200 で静かに捨てる（ここで ok:false を返すと Stripe が無駄にリトライする）。
  if (!evId || String(evId).indexOf('evt_') !== 0) {
    log('stripe_webhook_bad_event', { id: evId, type: evType });
    return jsonResponse({ received: true, ignored: 'bad_event' });
  }

  // キューに積む（重複は処理時に event_id 単位で吸収するので、受信は無条件 append＝最速）
  try {
    const q = sheet('webhook_queue', WEBHOOK_QUEUE_HEADERS);
    q.appendRow([ new Date(), evId, evType, String(raw).slice(0, 45000), 'pending', 0, '', '' ]);
  } catch (qe) {
    // 積めなかった時だけ ok:false(=2xx以外) を返して Stripe にリトライさせ、取りこぼしを防ぐ
    log('stripe_webhook_enqueue_error', { id: evId }, { error: qe.message });
    return jsonResponse({ ok:false, error: 'enqueue failed' });
  }

  log('stripe_webhook_queued', { id: evId, type: evType });
  return jsonResponse({ received: true });   // ⚡ 即 200（Stripe のタイムアウト回避）
}

/* ============================================================
   ⚙ 1分毎の time-trigger が呼ぶ: webhook_queue の pending を検証→処理（重い処理はここ）
   ・event_id 単位の冪等(Stripe リトライ重複を吸収)
   ・Stripe 再照会で実在検証してから本処理 → 偽造を弾く
   ・失敗は最大5回まで pending のまま再試行、超えたら failed
   ============================================================ */
function processWebhookQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;   // 多重起動防止。取れなければ次回 trigger に任せる
  try {
    const q = sheet('webhook_queue', WEBHOOK_QUEUE_HEADERS);
    const data = q.getDataRange().getValues();
    if (data.length < 2) return;
    const H = data[0];
    const cId = H.indexOf('event_id'), cType = H.indexOf('type'), cRaw = H.indexOf('raw_json'),
          cStatus = H.indexOf('status'), cAtt = H.indexOf('attempts'),
          cProc = H.indexOf('processed_at'), cErr = H.indexOf('error');

    // event_id 単位の冪等: 既に done のイベントは再処理しない
    const doneIds = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][cStatus] === 'done') doneIds[data[i][cId]] = true;
    }

    const MAX_PER_RUN = 50;            // 6分制限対策。通常は数件
    let processed = 0;
    for (let i = 1; i < data.length && processed < MAX_PER_RUN; i++) {
      if (data[i][cStatus] !== 'pending') continue;
      const row = i + 1;
      const evId = data[i][cId];

      if (doneIds[evId]) {             // 同一イベント処理済み → skip(冪等)
        q.getRange(row, cStatus + 1).setValue('done');
        q.getRange(row, cErr + 1).setValue('dup-skip');
        continue;
      }

      const attempts = Number(data[i][cAtt] || 0) + 1;
      q.getRange(row, cAtt + 1).setValue(attempts);

      let verified = null;
      try {
        verified = verifyStripeEvent_(evId, data[i][cRaw]);
      } catch (verr) {
        q.getRange(row, cErr + 1).setValue('verify_err: ' + String(verr.message).slice(0, 200));
      }

      if (!verified) {                 // 偽造 or 一時的な検証失敗
        if (attempts >= 5) {
          q.getRange(row, cStatus + 1).setValue('failed');
          log('webhook_queue_verify_failed', { id: evId, attempts: attempts });
        }
        continue;                      // pending のまま次回再試行（上限5回）
      }

      try {
        dispatchWebhookEvent_(verified);
        doneIds[evId] = true;
        q.getRange(row, cStatus + 1).setValue('done');
        q.getRange(row, cProc + 1).setValue(new Date());
        processed++;
      } catch (err) {
        log('webhook_queue_dispatch_error', { id: evId, type: data[i][cType] }, { error: err.message });
        q.getRange(row, cErr + 1).setValue(String(err.message).slice(0, 300));
        if (attempts >= 5) q.getRange(row, cStatus + 1).setValue('failed');
      }
    }
  } finally {
    lock.releaseLock();
  }
}

/* event.id を Stripe に再照会して実在検証。200 のときだけ取得データ(=正)を返す。
   鍵未設定時は後方互換で raw を信頼（live 運用では鍵必須）。401(鍵不正)/404(偽造)→null。 */
function verifyStripeEvent_(evId, rawFallback) {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) { try { return JSON.parse(rawFallback); } catch (e) { return null; } }
  if (!evId || String(evId).indexOf('evt_') !== 0) return null;
  const vr = UrlFetchApp.fetch('https://api.stripe.com/v1/events/' + evId, {
    method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
  });
  if (vr.getResponseCode() === 200) return JSON.parse(vr.getContentText());
  return null;
}

/* 検証済みイベントを種類別ハンドラへ振り分け（旧 switch を関数化） */
function dispatchWebhookEvent_(verified) {
  switch (verified.type) {
    case 'checkout.session.completed':    return finalizeOrder(verified.data.object);
    case 'customer.subscription.created': return logSubscriptionCreated(verified.data.object);
    case 'customer.subscription.deleted': return logSubscriptionCancelled(verified.data.object);
    case 'invoice.payment_succeeded':     return logInvoicePaid(verified.data.object);
    default:                              return null;   // 未対応 type は無視
  }
}

/* 🔧 デプロイ後に1回だけ実行: processWebhookQueue の1分毎トリガーを登録（重複登録防止）。
   GAS エディタでこの関数を選んで Run する（裏で処理を回すために必須・1回だけ）。 */
/* ============================================================
   🚚 発送リマインド（着日基準・2026-08 田崎指示で「入金からN日」方式を刷新）
   ------------------------------------------------------------
   狙い: 「入金から2日で発送漏れアラート」だと、お届け希望日が先の注文でも即鳴り、
   逆に希望日直前でも輸送日数を織り込めず“間に合わない”。→ お届け着日(T)から逆算して
   「明日発送してください」を出す方式に変更。

   着日 T の決め方（お届け先ごと）:
     ・希望日あり … destinations[].delivery.date（無ければ注文共通 delivery_date）。buffer=1日
     ・希望日なし … 最短お届け日＝注文日+3日（checkout の min=+3 と一致）。buffer=0日
   地域（宮崎発ヤマト実測・県庁所在地基準）:
     ・西日本＝翌日着（近畿・中国・四国・九州の22県）→ 輸送1日
     ・東日本＝翌々日着（東海以東＋北海道＋沖縄本島の25県）→ 輸送2日（不明県も東扱い＝長い方で安全）
   発送すべき日  shipDeadline = T − 輸送日数 − buffer
   「明日発送」日 alertDay     = shipDeadline − 1
     → 希望日あり: 東=T−4 / 西=T−3（1日余裕で前日着）
     → 希望日なし: 東=T−3 / 西=T−2（最短日はギリギリなので余裕0でジャスト着）
   毎朝8時トリガーで today>=alertDay かつ未発送を検知（＝発送するまで鳴り続ける安全網）。
   定期便(mode=subscription*)は毎月1日発送の別運用のため従来どおり対象外。
   ============================================================ */
// 宮崎発ヤマト「翌日着」＝西日本の22県（これ以外＝東日本＝翌々日着。空欄/不明も東扱い）。
var WEST_NEXTDAY_PREFS = [
  '福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県',   // 九州
  '岡山県','広島県','鳥取県','島根県','山口県',                     // 中国
  '徳島県','香川県','愛媛県','高知県',                             // 四国
  '大阪府','兵庫県','京都府','滋賀県','奈良県','和歌山県'            // 近畿（三重は東海=翌々日=東）
];
// JST暦日を整数(日番号)へ。Date型と 'YYYY-MM-DD' 文字列で同じ基準に揃える。
function _jstDayNum(d) { return Math.floor((d.getTime() + 9 * 3600000) / 86400000); }
function _ymdDayNum(s) {
  var m = String(s || '').slice(0, 10).replace(/\//g, '-').split('-');
  if (m.length < 3 || !m[0] || !m[1] || !m[2]) return null;
  var n = Date.UTC(+m[0], +m[1] - 1, +m[2]);
  return isNaN(n) ? null : Math.floor(n / 86400000);
}
function _dayNumLabel(n) {
  var d = new Date(n * 86400000); // UTC正午境界ではなくUTC 0時＝_ymdDayNum/_jstDayNumと整合
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + ['日','月','火','水','木','金','土'][d.getUTCDay()] + ')';
}

/* dryRun=true でメール送信せず本文だけ返す（?action 経由の下見/デバッグ用・Tomの diag_bank_reminders と同様）。 */
function alertUnshippedOrders(dryRun) {
  try {
    var sh = sheet('orders');
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return 'no_orders';
    var headers = data[0];
    var get = function (row, name) { var k = headers.indexOf(name); return k >= 0 ? row[k] : ''; };
    var todayNum = _jstDayNum(new Date());
    var hits = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var ps = String(get(row, 'payment_status') || '').toLowerCase();
      if (ps !== 'paid') continue;                                    // 入金済のみ（未入金/その他は対象外）
      if (String(get(row, 'tracking_number') || '').trim()) continue; // 発送済(伝票あり)は対象外
      var em = String(get(row, 'customer_email') || '').toLowerCase();
      if (em.indexOf('@eda-livestock.com') >= 0) continue;            // 社内/テスト除外
      if (String(get(row, 'mode') || '').indexOf('subscription') === 0) continue; // 定期便は別運用
      var placed = get(row, 'placed_at');
      var placedNum = placed ? _jstDayNum(new Date(placed)) : null;
      var orderDate = _ymdDayNum(get(row, 'delivery_date'));          // 注文共通の希望日（フォールバック）
      var ds; try { ds = JSON.parse(get(row, 'destinations_json') || '[]'); } catch (e) { ds = []; }
      var dests = ds.filter(function (a) { return a && Array.isArray(a.items) && a.items.length > 0; });
      if (!dests.length) continue;                                    // 配送対象明細なし（ギフト差出人等）は対象外
      dests.forEach(function (a) {
        var pref = String(a.pref || '').trim();
        var isWest = WEST_NEXTDAY_PREFS.indexOf(pref) >= 0;           // 空欄/不明は false＝東（長い方で安全）
        var transit = isWest ? 1 : 2;                                 // 西=翌日着 / 東=翌々日着
        // 着日 T：希望日（宛先→注文共通）。無ければ 最短＝注文日+3。
        var wishNum = _ymdDayNum((a.delivery || {}).date) || orderDate;
        var hasWish = !!wishNum;
        var T = hasWish ? wishNum : (placedNum != null ? placedNum + 3 : null);
        if (T == null) return;                                        // 着日を確定できない（placed も希望日も無い）
        var buffer = hasWish ? 1 : 0;                                 // 希望日は1日余裕 / 最短日は余裕0
        var shipDeadline = T - transit - buffer;                      // この日までに発送
        var alertDay = shipDeadline - 1;                              // 「明日発送」を出す日
        if (todayNum < alertDay) return;                             // まだ早い（希望日が先＝鳴らさない）
        var untilShip = shipDeadline - todayNum;                      // 発送期限まで（日）
        var status = untilShip >= 1 ? '🚚 明日発送' : (untilShip === 0 ? '🚨 本日発送' : '🔴 発送期限超過(' + (-untilShip) + '日遅れ)');
        hits.push({
          on: get(row, 'order_number'), name: a.name || get(row, 'customer_name'),
          region: isWest ? '西' : '東', pref: pref, wish: hasWish,
          arrive: T, ship: shipDeadline, until: untilShip, status: status,
          items: a.items.map(function (it) { return (it.title || '') + (it.variant ? ' ' + it.variant : '') + (it.qty ? '×' + it.qty : ''); }).join(' / ')
        });
      });
    }
    if (!hits.length) { if (!dryRun) log('unshipped_alert', { count: 0 }); return 'none'; }
    hits.sort(function (a, b) { return a.ship - b.ship; });           // 期限が近い/超過を上に
    var overdue = hits.filter(function (h) { return h.until < 0; }).length;
    var body = '【発送リマインド】着日から逆算して「そろそろ発送」の注文が ' + hits.length + ' 件あります' +
      (overdue ? '（うち発送期限超過 ' + overdue + ' 件）' : '') + '。\n' +
      '※東日本=翌々日着・西日本=翌日着で計算。希望日ありは1日余裕、希望日なしは最短(注文+3日)着で算出。\n\n';
    hits.forEach(function (h) {
      body += '・' + h.on + '（' + (h.name || '') + '）' + h.status + '\n' +
        '   ' + h.region + '日本[' + (h.pref || '?') + '] / 着日 ' + _dayNumLabel(h.arrive) +
        '（' + (h.wish ? '希望日' : '最短') + '）→ 発送期限 ' + _dayNumLabel(h.ship) + '\n' +
        '   ' + h.items + '\n\n';
    });
    body += 'STAFFポータルで発送処理してください: https://www.eda-livestock.com/staff.html\n';
    var subject = (overdue ? '🔴' : '🚚') + '【発送リマインド ' + hits.length + '件】' + (overdue ? '期限超過' + overdue + '件あり' : '着日から逆算');
    if (dryRun) return body;
    var to = cfg('STAFF_NOTIFICATION_EMAIL') || 'backoffice@eda-livestock.com';
    MailApp.sendEmail({ to: to, subject: subject, body: body });
    log('unshipped_alert', { count: hits.length, overdue: overdue, orders: hits.map(function (h) { return h.on; }) });
    return 'alerted:' + hits.length;
  } catch (e) { log('unshipped_alert_error', { error: e.message }); return 'error:' + e.message; }
}

/* 毎朝8時に未発送アラートを実行する日次トリガーを設置（冪等）。1回だけ実行すればよい。 */
function setupUnshippedAlertTrigger() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'alertUnshippedOrders') return 'already_exists';
  }
  ScriptApp.newTrigger('alertUnshippedOrders').timeBased().everyDays(1).atHour(8).create();
  return 'created';
}

/* ============================================================
   📋 自動化一覧スプレッドの自動更新 (2026-08-01 田崎要望)
   公式LINE/ECの自動処理を「誰が見ても分かる」言葉で1枚のスプレッドに保つ。
   新しい自動化を足したら AUTOMATION_REGISTRY に1行足すだけ→毎朝6時に自動反映。
   書き出し先=Drive作成のシート(所有 r.tasaki@)。setupは r.tasaki@ で実行すること。
   ============================================================ */
var AUTOMATION_CATALOG_SHEET_ID = '189axg2iFwQcZn6hNc64QJnag8lB_nn4MqCuvdGR2xXo';
// [分類, 機能, いつ動く, 状態, 何をする]。状態=稼働中/停止中(オフ)/手動/未反映/裏方。
var AUTOMATION_REGISTRY = [
  ['公式LINE', '買った人を自動でLINE連携', '注文された瞬間', '稼働中', 'LINE経由で買った人のLINEと注文を自動でひも付け（次から個別に連絡できる）'],
  ['公式LINE', '連携で10%OFFクーポンを配布', 'LINE連携した瞬間', '稼働中', '連携してくれた人に割引クーポンを自動で送る'],
  ['公式LINE', '発送をLINEでお知らせ', '発送処理した時', '稼働中', '「発送しました＋お届け予定日」をLINEに自動送信（未連携の人にはメール）'],
  ['公式LINE', '一斉配信', 'あなたが送信した時', '手動（自動ではない）', 'LINEの友だち全員やセグメントへ配信。人が押して送る'],
  ['公式LINE', 'かご落ちのLINE催促', '1時間ごと', '稼働中', 'カートに入れて離脱した人へLINEで催促。購入済みの人には送らないよう修正済み'],
  ['公式LINE', 'LINE成績を毎日自動記録', '毎日', '未反映（動いていない）', '友だち数や配信成績を表に自動記録。仕組みは完成済みだが本番に入れていない'],
  ['公式LINE', '顧客名簿（LINE連携）の自動更新', '毎日 朝7時', '稼働中', 'LINE連携した顧客を重複整理し、購入額の多い順に名簿シートへ毎日作り直す（GASが正・手編集は消える）'],
  ['EC', '発送リマインド', '毎朝8時', '稼働中', 'お客様の到着希望日から逆算して「そろそろ発送して」を社内に通知（東日本は4日前・西日本は3日前）'],
  ['EC', '振込のお願い催促', '毎朝10時', '稼働中', '銀行振込を選んだのに未入金の人を見つけてリマインドを送る'],
  ['EC', '発送リストを自動更新', '30分ごと', '稼働中', '発送すべき注文を、伝票印刷用の一覧に常に最新化する'],
  ['EC', '在庫の自動引き算', '商品が売れた時', '稼働中', '売れると在庫数が自動で減る'],
  ['EC', '注文確認メール', '注文が入った時', '稼働中', 'お客様に確認メールを自動送信'],
  ['EC', '振込案内メール', '銀行振込を選んだ時', '稼働中', '振込先の案内を自動送信'],
  ['EC', '限定品の自動終了', '締切が来た時', '稼働中', '「〇日まで」の限定商品を、締切で表示ごと自動で消す'],
  ['EC', 'カートの残り個数表示', '常時', '稼働中', '在庫の残りをリアルタイムで見せる'],
  ['EC', '決済の取りこぼし防止', '1分ごと・6時間ごと', '裏方（お客様には見えない）', '支払い情報を二重チェックして注文の記録漏れを防ぐ']
];

/* 一覧スプレッドを AUTOMATION_REGISTRY の内容で書き換える（毎朝トリガー＋setupから呼ばれる）。 */
function syncAutomationCatalog() {
  try {
    var ss = SpreadsheetApp.openById(AUTOMATION_CATALOG_SHEET_ID);
    var sh = ss.getSheets()[0];
    sh.clear();
    var head = ['分類', '機能', 'いつ動く', '状態', '何をする'];
    sh.getRange(1, 1, 1, 5).setValues([head]).setFontWeight('bold').setBackground('#0F3D2E').setFontColor('#FFFFFF');
    sh.getRange(2, 1, AUTOMATION_REGISTRY.length, 5).setValues(AUTOMATION_REGISTRY);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    sh.getRange(AUTOMATION_REGISTRY.length + 3, 1).setValue('最終更新: ' + stamp + '（毎日自動更新。自動化を追加・変更するとこの表に反映されます）');
    sh.setFrozenRows(1);
    try { sh.autoResizeColumns(1, 5); } catch (e) {}
    log('automation_catalog_sync', { rows: AUTOMATION_REGISTRY.length });
    return 'synced ' + AUTOMATION_REGISTRY.length + ' rows @' + stamp;
  } catch (e) { log('automation_catalog_error', { error: e.message }); return 'error:' + e.message; }
}

/* 1回だけ実行(r.tasaki@で): 毎朝6時トリガーを設置＋即時反映。 */
function setupAutomationCatalog() {
  var ts = ScriptApp.getProjectTriggers();
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'syncAutomationCatalog') return 'already_exists / ' + syncAutomationCatalog();
  }
  ScriptApp.newTrigger('syncAutomationCatalog').timeBased().everyDays(1).atHour(6).create();
  return 'created / ' + syncAutomationCatalog();
}

function setupWebhookQueueTrigger() {
  const ts = ScriptApp.getProjectTriggers();
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'processWebhookQueue') return 'already_exists';
  }
  ScriptApp.newTrigger('processWebhookQueue').timeBased().everyMinutes(1).create();
  return 'created';
}

/* ============================================================
   🛰 Stripe events ポーリング (2026-06-13)
   webhook は GAS /exec の 302 リダイレクトで Stripe 側「失敗」扱い→自動停止する構造問題がある。
   その保険として time-trigger で Stripe events API を定期取得し、未処理イベントを webhook_queue に
   積んで processWebhookQueue へ委譲する（処理経路・冪等は webhook と完全共通）。
   webhook が生きていれば同じ event_id は done 済→ dup-skip で二重なし。
   特に定期便2回目(invoice.payment_succeeded)・解約(subscription.deleted)は success_url を通らない
   ため、webhook 停止時はこのポーリングが唯一の取りこぼし防止経路になる。
   ============================================================ */
function pollStripeEvents() {
  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return 'no_key';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 'busy';
  let fetched = 0;
  try {
    const TYPES = ['checkout.session.completed', 'customer.subscription.created',
                   'customer.subscription.deleted', 'invoice.payment_succeeded'];
    let url = 'https://api.stripe.com/v1/events?limit=100';
    TYPES.forEach(function (t) { url += '&types[]=' + encodeURIComponent(t); });
    const cursor = PROPS.getProperty('STRIPE_POLL_CURSOR');     // 前回処理済みの最新 event id
    if (cursor) url += '&ending_before=' + encodeURIComponent(cursor);   // それより新しいものだけ
    else url += '&created[gte]=' + (Math.floor(new Date().getTime() / 1000) - 2 * 86400);  // 初回は直近2日に限定

    const res = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 400 && cursor) {   // cursor が失効(古すぎ等)→クリアして次回フォールバック
      PROPS.deleteProperty('STRIPE_POLL_CURSOR');
      log('stripe_poll_cursor_reset', { cursor: cursor });
      return 'cursor_reset';
    }
    if (code !== 200) { log('stripe_poll_error', {}, { code: code, body: res.getContentText().slice(0, 200) }); return 'err_' + code; }

    const body = JSON.parse(res.getContentText());
    const events = (body && body.data) || [];     // created 降順
    if (!events.length) { log('stripe_poll', { fetched: 0 }); return 'none'; }

    const q = sheet('webhook_queue', WEBHOOK_QUEUE_HEADERS);
    // 古い順に積む(処理順を webhook と揃える)。重複は processWebhookQueue が event_id で吸収。
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      q.appendRow([new Date(), ev.id, ev.type || '', JSON.stringify(ev).slice(0, 45000), 'pending', 0, '', 'via:poll']);
    }
    PROPS.setProperty('STRIPE_POLL_CURSOR', events[0].id);   // 最新(先頭)を次回 cursor に
    fetched = events.length;
    log('stripe_poll', { fetched: fetched, newest: events[0].id });
  } finally {
    lock.releaseLock();
  }
  // 積んだ分を即処理(1分 trigger を待たない)
  try { processWebhookQueue(); } catch (e) { log('stripe_poll_process_error', {}, { error: e.message }); }
  return 'ok:' + fetched;
}

/* 🔧 1回だけ実行: pollStripeEvents を6時間毎に回す time-trigger を登録(重複防止) */
function setupStripePollTrigger() {
  const ts = ScriptApp.getProjectTriggers();
  for (let i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'pollStripeEvents') return 'already_exists';
  }
  ScriptApp.newTrigger('pollStripeEvents').timeBased().everyHours(6).create();
  return 'created';
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

  // 🔴 v39: Stripe metadata 1値500字制限の根治。新方式のセッションは destinations/items の実体を
  //    metadata に持たない → pending_orders から session_id で復元して meta に詰め直す。
  //    meta は session.metadata と同一参照のため、下流の在庫減算(decrementStockAfterOrder)・
  //    スタッフ通知(sendStaffNotificationEmail)・purchase イベント(logPurchaseEvent)・
  //    metadata_json 列保存もそのまま復元値を読む。旧セッション(metadata に実体あり)は無変更で通る。
  //    pending_orders の destinations_json は delivery 込みの完全版＝deliveries_json 再マージ不要。
  try {
    if (!meta.destinations_json || !meta.items_json) {
      const pending = pendingOrderRow_(session.id, meta.order_number || '');
      if (pending) {
        if (!meta.destinations_json && pending.destinations_json) meta.destinations_json = String(pending.destinations_json);
        if (!meta.items_json && pending.items_json) meta.items_json = String(pending.items_json);
      }
    }
  } catch (e) { log('pending_restore_error', { session: session.id, error: e.message }); }

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

    // 🔴 お届け先ごとの希望日時を destinations に再マージ（Stripeでは lean 保存 + deliveries_json 別キー）。b2Rows_ が addr.delivery を読む。
    var destinationsOut = meta.destinations_json || '[]';
    try {
      var _dArr = JSON.parse(meta.destinations_json || '[]');
      var _vArr = JSON.parse(meta.deliveries_json || '[]');
      if (Array.isArray(_dArr) && Array.isArray(_vArr) && _vArr.length) {
        _dArr.forEach(function (d, i) { if (_vArr[i] && (_vArr[i].d || _vArr[i].t)) d.delivery = { date: _vArr[i].d || '', time: _vArr[i].t || '' }; });
        destinationsOut = JSON.stringify(_dArr);
      }
    } catch (e) { /* lean のまま (後方互換) */ }

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
      destinationsOut,
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
  var lineUid = (meta.line_uid && String(meta.line_uid).trim()) || lineUidForEmail(custEmailForLine) || lineUidByPhone_(meta.customer_phone);
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
    line_uid: lineUid || '',
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

  // 🧩 BOM: セット商品はセット行ではなく構成品の stock を減らす
  const consumedByTitle = expandBundles_(unitsByTitle, data, headers);

  // products シートの該当行を減算
  for (let i = 1; i < data.length; i++) {
    const title = data[i][titleIdx];
    const consumed = consumedByTitle[title];
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
  // 監査用: invoices タブに毎月課金の記録(従来どおり)
  const sh = sheet('invoices', ['invoice_id','subscription_id','customer','amount_paid','paid_at']);
  sh.appendRow([inv.id, inv.subscription || '', inv.customer || '', inv.amount_paid, new Date(inv.created * 1000)]);

  // 🔴 2026-06-13: 定期便2回目以降のボックスを orders に立てる(発送リスト+売上計上)。
  //   これが無いと「課金されたのに発送されない/売上に乗らない」(invoices タブに残るだけ)。
  //   初月は Checkout(finalizeOrder)が別 session_id で記録済→ここは inv.id を冪等キーに二重防止。
  try { recordSubscriptionRenewalOrder_(inv); }
  catch (e) { log('sub_renewal_order_error', { invoice: inv.id }, { error: e.message }); }

  return jsonResponse({ ok:true });
}

/* ============================================================
   🔁 定期便の継続課金(invoice.payment_succeeded)から orders に発送注文を1行立てる (2026-06-13)
   ・guard: subscription 紐付き かつ 実課金(amount_paid>0) のみ
   ・冪等: orders.session_id == inv.id 既存なら skip(ScriptLock で直列化)
   ・配送先 = 初回注文(subscription.metadata.order_number)の destinations から復元
   ・中身   = subscription_plans(price_id 一致)の name/spec を「{plan} 定期便」1明細に
   ・通知   = 顧客(LINE優先/失敗時メール) + スタッフ(発送依頼メール)
   ・在庫減算は定期便ボックス(複数品の詰合せ)につき個別 decrement はしない(別管理・誤減算防止)
   ============================================================ */
function recordSubscriptionRenewalOrder_(inv) {
  if (!inv || !inv.subscription) return;              // サブスク以外の invoice は対象外
  if (!(Number(inv.amount_paid) > 0)) return;         // 0円(初回スキップ等)は対象外

  const STRIPE = cfg('STRIPE_SECRET_KEY');
  if (!STRIPE) return;

  const ORDER_HEADERS = ['order_number','placed_at','session_id','customer_name','customer_email','customer_phone',
    'mode','total','shipping','payment_status','payment_method',
    'destinations_json','items_json','metadata_json','line_uid','line_name','contact_method'];
  const sh = sheet('orders', ORDER_HEADERS);

  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { log('sub_renewal_lock_timeout', { invoice: inv.id }); return; }
  try {
    // 冪等: この invoice を既に orders 化済みなら skip(session_id 列に inv.id を入れている)
    const rows = sh.getDataRange().getValues();
    const H = rows[0];
    const cSess = H.indexOf('session_id');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][cSess] === inv.id) { log('sub_renewal_dup_skip', { invoice: inv.id, order: rows[i][0] }); return; }
    }

    // subscription を引いて初回注文番号・price_id を得る
    const subRes = UrlFetchApp.fetch('https://api.stripe.com/v1/subscriptions/' + encodeURIComponent(inv.subscription), {
      method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true
    });
    const sub = JSON.parse(subRes.getContentText());
    const subMeta = (sub && sub.metadata) || {};
    const firstOrderNum = subMeta.order_number || '';
    let priceId = '';
    try { priceId = inv.lines.data[0].price.id; } catch (e) {}
    if (!priceId) { try { priceId = sub.items.data[0].price.id; } catch (e) {} }

    // プラン定義(name/spec)を price_id で解決
    let planName = subMeta.plan || '定期便', planSpec = '';
    try {
      const pData = ss().getSheetByName('subscription_plans').getDataRange().getValues();
      const pH = pData[0];
      const cPrice = pH.indexOf('stripePriceId'), cName = pH.indexOf('name'), cSpec = pH.indexOf('spec');
      for (let i = 1; i < pData.length; i++) {
        if (priceId && pData[i][cPrice] === priceId) { planName = pData[i][cName] || planName; planSpec = pData[i][cSpec] || ''; break; }
      }
    } catch (e) {}

    // 初回注文行から配送先・顧客情報を復元
    let firstRow = null;
    if (firstOrderNum) { for (let i = 1; i < rows.length; i++) { if (rows[i][0] === firstOrderNum) { firstRow = rows[i]; break; } } }
    const gf = function (name) { const k = H.indexOf(name); return (firstRow && k >= 0) ? firstRow[k] : ''; };

    const custName = gf('customer_name') || '';
    const custEmail = gf('customer_email') || (inv.customer_email || '');
    const custPhone = gf('customer_phone') || '';
    const lineUidFirst = gf('line_uid') || '';
    const lineName = gf('line_name') || '';
    const contact = gf('contact_method') || '';

    // 配送先: 初回 destinations の住所を流用し、items を「{plan} 定期便」1明細に差し替え
    const boxTitle = planName + ' 定期便' + (planSpec ? '（' + planSpec + '）' : '');
    const boxItems = [{ title: boxTitle, variant: '定期便', qty: 1 }];
    let destinations;
    try {
      destinations = JSON.parse(gf('destinations_json') || '[]');
      if (!Array.isArray(destinations) || !destinations.length) throw new Error('no dest');
      destinations = destinations.map(function (d) { return Object.assign({}, d, { items: boxItems }); });
    } catch (e) {
      destinations = [{ type: 'self', name: custName, items: boxItems }];   // 住所不明でも未発送アラートに乗せる
    }

    const total = Number(inv.amount_paid) || 0;
    const newOrderNum = 'EDA-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd') + '-' + String(inv.id).slice(-6).toUpperCase();

    sh.appendRow([
      newOrderNum, new Date(), inv.id, custName, custEmail, custPhone,
      'subscription_renewal', total, 0, 'paid', 'card',
      JSON.stringify(destinations), JSON.stringify(boxItems),
      JSON.stringify({ source: 'invoice.payment_succeeded', invoice: inv.id, subscription: inv.subscription, plan: planName, first_order: firstOrderNum, cycle: true }),
      lineUidFirst, lineName, contact
    ]);
    log('sub_renewal_order_created', { invoice: inv.id, order: newOrderNum, total: total, plan: planName });

    // 通知: 顧客(LINE優先・失敗時メール) + スタッフ(発送依頼)
    let uid = lineUidFirst || lineUidForEmail(custEmail) || lineUidByPhone_(custPhone);
    let pushed = false;
    if (uid) { try { pushed = sendLinePush(uid, [buildOrderConfirmMessage(custName, newOrderNum, total)]); } catch (e) {} }
    if (!pushed && custEmail) {
      try {
        MailApp.sendEmail({
          to: custEmail,
          subject: '【江田畜産】定期便のお届け準備を開始しました',
          body: custName + ' 様\n\n定期便（' + boxTitle + '）のお届け準備を開始しました。\n注文番号: ' + newOrderNum + '\n\n発送まで今しばらくお待ちください。\n\n江田畜産｜EDA WAGYU'
        });
      } catch (e) {}
    }
    try {
      MailApp.sendEmail({
        to: cfg('STAFF_NOTIFICATION_EMAIL') || 'backoffice@eda-livestock.com',
        subject: '🔁【定期便ボックス発送依頼】' + custName + '様 ' + planName,
        body: '定期便の継続課金が確定しました。発送をお願いします。\n\n注文番号: ' + newOrderNum + '\nお客様: ' + custName + '（' + custEmail + '）\nプラン: ' + boxTitle + '\n金額: ¥' + total + '\n\nSTAFFポータル: https://www.eda-livestock.com/staff.html'
      });
    } catch (e) {}

    try { upsertCustomer({ email: custEmail, name: custName, phone: custPhone, line_uid: uid || '', line_name: lineName, last_order: newOrderNum, last_order_total: total, last_order_at: new Date() }); } catch (e) {}
  } finally {
    lock.releaseLock();
  }
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

  // 🔴 Webhook 補完 (v35 2026-06-12): 決済完了済みなのに orders 未記録＝Stripe webhook が
  //   GAS /exec の 302 リダイレクトで失敗しているケース。お客様が必ず通る「ありがとうページ」
  //   (order-complete.html が叩く ?action=order_status) で finalizeOrder を実行し、注文記録・
  //   通知・在庫・定期便生成まで確定させる。finalizeOrder は session_id 単位で冪等(ScriptLock＋
  //   既存チェック)なので、webhook 復活時に両方走っても二重記録しない。未払い(銀行振込待ち等)は確定しない。
  if (session.payment_status === 'paid') {
    try {
      finalizeOrder(session);
      const after = sheet('orders').getDataRange().getValues();
      const ahdr = after[0];
      for (var k = 1; k < after.length; k++) {
        if (after[k][2] === session.id) {
          var ord = {}; ahdr.forEach(function (h, idx) { ord[h] = after[k][idx]; });
          return jsonResponse({ ok: true, order: ord, finalized: true });
        }
      }
    } catch (e) {
      log('orderstatus_finalize_error', { session: sessionId }, { error: e.message });
    }
  }

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
    name: BRAND_MAIL.sender,
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
        // 注文明細を items にパース。🔴 orders シートの列名は items_json で o.items は存在しないため
        //   items_json を読む（旧コードは o.items を見ており mypage/LINE/OTP で明細が常に空だった。2026-06-08修正）。
        if (typeof o.items_json === 'string' && o.items_json) {
          try { o.items = JSON.parse(o.items_json); } catch (_) { o.items = []; }
        } else if (typeof o.items === 'string') {
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
/* ダッシュボード用: 実 active サブスクの件数と MRR(月額合計・円)を Stripe 実態から算出。
   テスト顧客 cus_Uake 除外。年額は /12 で月次換算。CacheService 600s。失敗時は {count:0,mrr:0}。
   （旧実装は activeSub/mrr を 0 ハードコードで定期便収益が一切反映されなかった。2026-06-02 修正） */
function getActiveSubsSummary() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('active_subs_summary');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = { count: 0, mrr: 0 };
  try {
    var STRIPE = cfg('STRIPE_SECRET_KEY');
    if (!STRIPE) return out;
    var TEST_CUS = 'cus_UakeKnQRLIzK9x';
    var startingAfter = '', guard = 0;
    do {
      var url = 'https://api.stripe.com/v1/subscriptions?status=active&limit=100';
      if (startingAfter) url += '&starting_after=' + startingAfter;
      var res = UrlFetchApp.fetch(url, { method: 'get', headers: { 'Authorization': 'Bearer ' + STRIPE }, muteHttpExceptions: true });
      var data = JSON.parse(res.getContentText());
      if (data.error) break;
      (data.data || []).forEach(function (s) {
        if (s.customer === TEST_CUS) return;
        out.count++;
        var item = (s.items && s.items.data && s.items.data[0]) || {};
        var price = item.price || {};
        var amt = Number(price.unit_amount) || 0;
        var interval = (price.recurring && price.recurring.interval) || 'month';
        out.mrr += (interval === 'year') ? Math.round(amt / 12) : amt;
      });
      startingAfter = (data.has_more && data.data.length) ? data.data[data.data.length - 1].id : '';
      guard++;
    } while (startingAfter && guard < 10);
    cache.put('active_subs_summary', JSON.stringify(out), 600);
  } catch (e) { /* fail-open: 0 */ }
  return out;
}

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
    // 社内/テスト注文(@eda-livestock.com)は売上から除外（alertUnshippedOrders と同基準・実態化 2026-06-16）
    var _email = String(ordersData[i][4] || '').toLowerCase();
    if (_email.indexOf('@eda-livestock.com') >= 0) continue;
    const placedAt = new Date(ordersData[i][1]);
    // 入金済(paid)に加え、発送済(shipped)・着荷(delivered)も売上計上する。
    // 🔴 発送処理で payment_status が paid→shipped に変わると売上から消える過小バグの修正(2026-06-16)。
    //    'paid'限定だと発送が進むほどダッシュボード売上が減る逆転現象になっていた。
    var _ps = String(ordersData[i][9] || '').toLowerCase();
    if (placedAt >= since && (_ps === 'paid' || _ps === 'shipped' || _ps === 'delivered')) {
      revenue += Number(ordersData[i][7]) || 0;
      orderCount++;
      customers[ordersData[i][4]] = true;
    }
  }

  const _subs = getActiveSubsSummary(); // 実 active サブスク(Stripe・cus_Uake除外)
  const _lineFriends = getLineFriendCount(); // LINE 友だち数(targetedReaches・1hキャッシュ)。未設定/エラーは0
  const _uniqueBuyers = Object.keys(customers).length; // 期間内の実購入ユニーク顧客数(届け先あり・paid・dedup済)
  // LINE転換率 = 期間内の実購入客 / LINE友だち（新サイト基準。Wix/Shopify移行途中のため低めに出る・実値）
  const _lineConvRate = _lineFriends > 0 ? Math.round((_uniqueBuyers / _lineFriends) * 1000) / 10 : 0;

  return jsonResponse({
    ok: true,
    overview: {
      revenue: revenue,
      revenueDelta: 0,
      orders: orderCount,
      avg: orderCount ? Math.round(revenue / orderCount) : 0,
      activeSub: _subs.count,
      subDelta: 0,
      mrr: _subs.mrr,
      line: _lineFriends,
      lineDelta: 0,
      lineConvRate: _lineConvRate,
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
/* LINE 友だち数(targetedReaches)取得の本体。{count,date,cached} または {count:0,date:null,error} を返す。
   1時間キャッシュ('line_friends_count'={count,date})を lineFriends() と dashboardSummary で共用する。 */
function getLineFriendData() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('line_friends_count');
  if (cached) {
    try {
      var c = JSON.parse(cached);
      return { count: c.count, date: c.date, cached: true };
    } catch (e) {}
  }
  var token = cfg('LINE_CHANNEL_TOKEN');
  if (!token) {
    return { count: 0, date: null, error: 'LINE_CHANNEL_TOKEN not set' };
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
      return { count: 0, date: null, error: 'LINE insight data not ready' };
    }
    // targetedReaches = ブロック除外の有効フォロワー (公式に「友だち」と呼ばれる数)
    // followers = 累計 (ブロック含む)
    var count = (typeof data.targetedReaches === 'number') ? data.targetedReaches : (data.followers || 0);
    // 1 時間キャッシュ
    cache.put('line_friends_count', JSON.stringify({ count: count, date: dateStr }), 3600);
    return { count: count, date: dateStr };
  } catch (e) {
    return { count: 0, date: null, error: e.message };
  }
}

/* LINE 友だち数を数値で返す（dashboardSummary 用）。未設定/エラー/未ready は 0。 */
function getLineFriendCount() {
  return getLineFriendData().count || 0;
}

/* GET ?action=line_friends — 外部API互換の jsonResponse（ok/count/friends/date/cached） */
function lineFriends() {
  var d = getLineFriendData();
  if (d.error && !d.count) {
    return jsonResponse({ ok: false, count: 0, friends: 0, error: d.error });
  }
  return jsonResponse({ ok: true, count: d.count, friends: d.count, date: d.date, cached: !!d.cached });
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

    // 🧩 BOM: セット商品は構成品に展開してから在庫を見る
    const needByTitle = expandBundles_(cartUnitsByTitle, data, headers);

    // products シートの stock と比較
    for (let i = 1; i < data.length; i++) {
      const title = data[i][titleIdx];
      const stock = Number(data[i][stockIdx]) || 0;
      const needed = needByTitle[title] || 0;
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

function recordPendingOrder(orderNum, sessionId, body, subtotal, shipping, mode, items) {
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
  // 🔴 items_json は後付け列（既存シートは9列）。appendRow の固定列に足すと列ズレするため
  //    ensureCol 方式で名前解決して追記行に書く。finalizeOrder の復元元（Stripe metadata 500字対策）。
  if (items && items.length) {
    try {
      const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      let idx = hdr.indexOf('items_json');
      if (idx === -1) { sh.getRange(1, hdr.length + 1).setValue('items_json'); idx = hdr.length; }
      sh.getRange(sh.getLastRow(), idx + 1).setValue(JSON.stringify(items.map(function (it) {
        return { title: it.title || it.name || '', variant: it.variant || '', qty: it.qty || 1 };
      })));
    } catch (e) { log('pending_items_write_error', { order: orderNum, error: e.message }); }
  }
}

/* pending_orders から session_id（無ければ order_number）で1件引く。最新行優先（末尾から走査）。
   finalizeOrder が destinations/items を復元する読み出し口（Stripe metadata 500字対策）。 */
function pendingOrderRow_(sessionId, orderNum) {
  const sh = ss().getSheetByName('pending_orders');
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0];
  const sIdx = headers.indexOf('session_id');
  const oIdx = headers.indexOf('order_number');
  for (let i = data.length - 1; i >= 1; i--) {
    if ((sessionId && sIdx >= 0 && data[i][sIdx] === sessionId) ||
        (orderNum && oIdx >= 0 && data[i][oIdx] === orderNum)) {
      const row = {};
      headers.forEach(function (h, j) { if (h) row[h] = data[i][j]; });
      return row;
    }
  }
  return null;
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

/* ============================================================
   📧 顧客向けブランドHTMLメール（共通テンプレ）
   ------------------------------------------------------------
   ・🔴 文字化け根治: プレーンtextのみだと一部経路で ISO-2022-JP に変換され
     罫線(━)や絵文字が「〓」化する → 必ず htmlBody(UTF-8) を併送し、
     plain fallback には JIS 外の装飾文字を使わない。
   ・写真は公式LINE Flex と同素材（hero-0.jpeg / ship-truck.png）＝世界観統一。
   ・配色はブランド基本（緑#0F3D2E × 金#D4A93B × クリーム#FAF7F0）。
   ・スタッフ向けメールは従来どおりプレーン（対象は顧客向けのみ）。
   ============================================================ */
var BRAND_MAIL = {
  sender: '江田畜産｜EDA WAGYU',
  heroOrder: 'https://www.eda-livestock.com/public/images/cuts/hero-0.jpeg',
  heroShip:  'https://www.eda-livestock.com/public/images/line/ship-truck.png'
};

function brandEmailHtml_(o) {
  // o = { heroUrl, title, intro, rows:[[label,value]], boxText, ctaLabel, ctaUrl, cta2Label, cta2Url, note }
  var s = function (v) { return String(v == null ? '' : v); };
  var rowsHtml = (o.rows || []).map(function (r) {
    return '<tr><td style="padding:10px 2px;color:#7c8a83;font-size:13px;border-bottom:1px solid #ece8dc;">' + s(r[0]) + '</td>' +
           '<td align="right" style="padding:10px 2px;color:#1a1a1a;font-size:14px;font-weight:bold;border-bottom:1px solid #ece8dc;">' + s(r[1]) + '</td></tr>';
  }).join('');
  var cta = function (label, url, bg, color) {
    if (!label || !url) return '';
    return '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:10px auto 0;"><tr>' +
           '<td align="center" bgcolor="' + bg + '" style="border-radius:999px;">' +
           '<a href="' + url + '" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:bold;color:' + color + ';text-decoration:none;border-radius:999px;font-family:sans-serif;">' + s(label) + '</a></td></tr></table>';
  };
  var section = function (inner) { return '<tr><td style="padding:18px 30px 0;font-family:sans-serif;">' + inner + '</td></tr>'; };
  return '<div style="margin:0;padding:0;background-color:#FAF7F0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF7F0;"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #ece8dc;">' +
    '<tr><td align="center" bgcolor="#0F3D2E" style="padding:22px 20px 18px;">' +
      '<div style="font-family:Georgia,serif;font-size:21px;letter-spacing:6px;color:#FAF7F0;font-weight:bold;">江田畜産</div>' +
      '<div style="font-family:Georgia,serif;font-size:10px;letter-spacing:5px;color:#D4A93B;padding-top:5px;">EDA LIVESTOCK &mdash; MIYAZAKI</div>' +
    '</td></tr>' +
    (o.heroUrl ? '<tr><td style="line-height:0;"><img src="' + o.heroUrl + '" width="560" alt="EDA WAGYU" style="width:100%;height:280px;object-fit:cover;object-position:center;display:block;"></td></tr>' : '') +
    '<tr><td align="center" style="padding:30px 30px 0;font-family:sans-serif;">' +
      '<div style="font-size:19px;font-weight:bold;color:#0F3D2E;letter-spacing:1px;">' + s(o.title) + '</div>' +
      '<div style="width:36px;height:3px;background-color:#D4A93B;margin:14px auto 0;border-radius:2px;font-size:0;line-height:0;">&nbsp;</div>' +
    '</td></tr>' +
    (o.intro ? section('<p style="font-size:14px;line-height:2;color:#444444;margin:0;">' + o.intro + '</p>') : '') +
    (rowsHtml ? section('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF7F0;border-radius:12px;"><tr><td style="padding:8px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rowsHtml + '</table></td></tr></table>') : '') +
    (o.boxText ? section('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAF7F0;border-radius:12px;"><tr><td style="padding:16px 18px;font-size:13px;line-height:2;color:#333333;">' + o.boxText + '</td></tr></table>') : '') +
    ((o.ctaLabel || o.cta2Label) ? '<tr><td align="center" style="padding:22px 30px 4px;">' + cta(o.ctaLabel, o.ctaUrl, '#D4A93B', '#1a1a1a') + cta(o.cta2Label, o.cta2Url, '#0F3D2E', '#FAF7F0') + '</td></tr>' : '') +
    (o.note ? section('<p style="font-size:12px;line-height:1.9;color:#8b968f;margin:0;">' + o.note + '</p>') : '') +
    '<tr><td align="center" style="padding:24px 30px 26px;">' +
      '<div style="border-top:1px solid #ece8dc;padding-top:18px;font-family:sans-serif;font-size:11px;color:#8b968f;line-height:1.9;">' +
      '宮崎・高原町の自家牧場から、安心安全な本物の和牛をお届けします。<br>' +
      '<span style="color:#0F3D2E;font-weight:bold;">江田畜産株式会社</span><br>' +
      '<a href="https://www.eda-livestock.com/" style="color:#0F3D2E;">www.eda-livestock.com</a> ｜ ' +
      '<a href="mailto:backoffice@eda-livestock.com" style="color:#0F3D2E;">backoffice@eda-livestock.com</a></div>' +
    '</td></tr>' +
    '</table></td></tr></table></div>';
}

function sendCustomerReceiptEmail(session, orderNum) {
  const email = session.customer_details && session.customer_details.email;
  if (!email) return;
  const total = session.amount_total ? '¥' + Number(session.amount_total).toLocaleString() : '-';
  const meta = session.metadata || {};
  const greeting = meta.customer_name ? (meta.customer_name + ' 様') : 'お客様';

  // ワンタップ LINE 連携リンク: LIFF (line-link.html) にメールを base64 で埋め込む。
  // タップ → LINE 認証 → line_link_account が自動実行され、メール一致で全注文が即連携される。
  // 注文番号も order param で渡す（line-link.html 側で連携完了直後の追跡導線に利用可能）。
  const liffId = cfg('LIFF_ID', '1657458587-mz1dR9e6');
  const lineLinkUrl = 'https://liff.line.me/' + liffId + '/line-link.html'
    + '?e=' + encodeURIComponent(Utilities.base64Encode(email, Utilities.Charset.UTF_8))
    + '&order=' + encodeURIComponent(orderNum);

  MailApp.sendEmail({
    to: email,
    name: BRAND_MAIL.sender,
    subject: '【江田畜産】ご注文ありがとうございます (' + orderNum + ')',
    body:  // plain fallback（JIS外の装飾文字を使わない＝文字化け防止）
      greeting + '\n\n' +
      'この度はご注文いただき誠にありがとうございます。\n\n' +
      'ご注文番号: ' + orderNum + '\n' +
      'お支払い額: ' + total + '\n\n' +
      'LINEで配送状況を受け取る（タップで連携完了）:\n' + lineLinkUrl + '\n\n' +
      'マイページ: https://www.eda-livestock.com/mypage.html\n\n' +
      '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
      'https://www.eda-livestock.com/',
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroOrder,
      title: 'ご注文ありがとうございます',
      intro: greeting + '、この度は江田和牛をお選びいただき誠にありがとうございます。<br>宮崎の牧場より、心を込めて発送の準備をいたします。',
      rows: [['ご注文番号', orderNum], ['お支払い金額', total]],
      ctaLabel: 'LINEで配送状況を受け取る',
      ctaUrl: lineLinkUrl,
      cta2Label: 'マイページで注文を確認',
      cta2Url: 'https://www.eda-livestock.com/mypage.html',
      note: '※ 上のLINEボタンはタップするだけで連携が完了し、発送のお知らせがLINEに届きます。<br>※ 商品はクール冷凍便でお届けします。発送時に追跡番号をお知らせいたします。'
    })
  });
}

function sendStaffNotificationEmail(session, orderNum) {
  const to = staffNotificationRecipients();   /* 田崎＋backoffice 両方（Tom 2026-06-08）*/
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

/* ============================================================
   🔗 LINE↔注文 自動連携ヘルパー (#1 再犯防止 2026-06)
   ============================================================
   目的: 「メールで注文 → 別途LINE友だち追加」で customers が2レコードに
   分かれても、電話番号で必ず注文へ辿り着けるようにする。
   - normPhone_      : 電話番号を比較用に正規化 (非数字/先頭0/国番号81を除去)
   - emailByPhone_   : orders を電話で引いて customer_email を返す
   - lineUidByPhone_ : customers を電話で引いて line_uid を返す (注文時の逆連携)
*/
function normPhone_(p) {
  var d = String(p == null ? '' : p).replace(/[^0-9]/g, '');
  if (d.indexOf('81') === 0 && d.length > 10) d = d.slice(2);
  return d.replace(/^0+/, '');
}

function emailByPhone_(phone) {
  var np = normPhone_(phone);
  if (!np) return '';
  try {
    var sh = sheet('orders');
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var pIdx = headers.indexOf('customer_phone'), eIdx = headers.indexOf('customer_email');
    if (pIdx < 0 || eIdx < 0) return '';
    for (var i = 1; i < data.length; i++) {
      if (data[i][eIdx] && normPhone_(data[i][pIdx]) === np) return data[i][eIdx];
    }
  } catch (e) { log('email_by_phone_error', { error: e.message }); }
  return '';
}

function lineUidByPhone_(phone) {
  var np = normPhone_(phone);
  if (!np) return '';
  try {
    var sh = ss().getSheetByName('customers');
    if (!sh) return '';
    var data = sh.getDataRange().getValues();
    var headers = data[0];
    var pIdx = headers.indexOf('phone'), lIdx = headers.indexOf('line_uid');
    if (pIdx < 0 || lIdx < 0) return '';
    for (var i = 1; i < data.length; i++) {
      if (data[i][lIdx] && normPhone_(data[i][pIdx]) === np) return data[i][lIdx];
    }
  } catch (e) { log('line_uid_by_phone_error', { error: e.message }); }
  return '';
}

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
        // 注文履歴: email紐付けがあれば email で取得。無い/0件でも電話番号で必ず照合（#1 自動連携・読取のみ）
        let orders = customer.email ? getOrdersByEmail(customer.email) : [];
        if (!orders.length && customer.phone) {
          const bridgedEmail = emailByPhone_(customer.phone);
          if (bridgedEmail) {
            const bridged = getOrdersByEmail(bridgedEmail);
            if (bridged.length) { orders = bridged; if (!customer.email) customer.email = bridgedEmail; }
          }
        }
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

/* LINE連携特典のクーポンコード。Script Property LINK_COUPON_CODE で差し替え可（デプロイ不要）。
   Stripe側に同名のクーポン(10%OFF)が存在することが前提。line-link.html の表示も合わせること。 */
function linkCouponCode_() {
  return cfg('LINK_COUPON_CODE', 'LINE10');
}

/* 🎟️ 顧客クーポンの正規化＋許可リスト（2026-07-26 新設）。
   🔴 フロント checkout.html の `COUPONS`(:2258付近) と**必ず対で維持する**。
      片方だけに足すと「入力できるのに記録されない」「記録されるのに割引されない」になる。
   🔴 キー名の罠：決済ページは `couponCode`(キャメル)で送る。`createBankOrder` は元から
      couponCode を読んでいたが `createCheckout` は `coupon_code`(スネーク)を読んでいたため、
      LINE10 の割引も「1人1回」ガードも**一度も動いていなかった**（2026-07-26 発見）。
      ここで両方を受けて正規化し、以後どちらのケースでも同じ結果にする。
   値引きの実体はフロントが単価を書き換えて表現する（Stripe coupon は使わない）。
   ここは「どのコードが使われたか」を確定し metadata に刻む役割＝1人1回ガードの根拠になる。 */
function normalizeCustomerCoupon_(body) {
  var raw = String((body && (body.couponCode || body.coupon_code)) || '').trim().toUpperCase();
  if (!raw) return '';
  var allowed = { 'エダチク10': true };
  allowed[linkCouponCode_()] = true;         // 既定 LINE10（LINK_COUPON_CODE で変更可）
  if (!allowed[raw]) {
    log('coupon_unknown_code', { code: raw.slice(0, 32) });
    return '';                               // 未知コードは無視（フロントが弾く前提の保険）
  }
  return raw;
}

/* 連携特典クーポンの「1人(1メール)1回」ガード。
   支払済みで orders に落ちた注文の metadata_json に coupon_code が刻まれる（createCheckout の
   session.metadata 経由）ので、同メール×同コードの既存行があれば checkout 作成を拒否する。
   注: メール違いは検知不可 / 決済未完了(離脱)はカウントしない（再挑戦可）仕様。 */
function assertLinkCouponUnused_(email) {
  var code = linkCouponCode_();
  var em = String(email || '').trim().toLowerCase();
  if (!em) throw new Error('クーポンのご利用にはメールアドレスの入力が必要です');
  var sh = sheet('orders');
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return;
  var h = rows[0];
  var iMail = h.indexOf('customer_email');
  var iMeta = h.indexOf('metadata_json');
  if (iMail < 0 || iMeta < 0) return;
  var needle = '"coupon_code":"' + code + '"';
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][iMail] || '').trim().toLowerCase() !== em) continue;
    if (String(rows[r][iMeta] || '').indexOf(needle) >= 0) {
      throw new Error('クーポン「' + code + '」はお一人様1回までのご利用です');
    }
  }
}

/** 連携完了後に送る Flex Message（購入歴の有無に関わらずクーポン付き） */
function buildLinkSuccessMessage(customerName) {
  var liffMypage = 'https://liff.line.me/' + cfg('LIFF_ID', '1657458587-mz1dR9e6') + '/mypage.html';
  var liffShop = 'https://liff.line.me/' + cfg('LIFF_ID', '1657458587-mz1dR9e6') + '/shop.html';
  var coupon = linkCouponCode_();
  return {
    type: 'flex',
    altText: '🎁 連携ありがとうございます — 全品10%OFFクーポンをどうぞ',
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
          { type: 'text', text: (customerName || 'お客') + '様、連携ありがとうございます。\n特典として全品10%OFFクーポンをお贈りします🎁', wrap: true, size: 'sm', color: '#666666' },
          { type: 'separator' },
          { type: 'text', text: 'クーポンコード', weight: 'bold', size: 'xs', color: '#888888', margin: 'md' },
          { type: 'text', text: coupon, weight: 'bold', size: 'xxl', color: '#0F3D2E', align: 'center' },
          { type: 'text', text: 'お会計の「クーポンコード」欄に入力 → 全品10%OFF！', wrap: true, size: 'xs', color: '#999999' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '🛒 クーポンを使って商品を見る', uri: liffShop },
            style: 'primary',
            color: '#0F3D2E'
          },
          {
            type: 'button',
            action: { type: 'uri', label: '📦 配送状況を確認する', uri: liffMypage },
            style: 'secondary'
          }
        ]
      }
    }
  };
}

/** 新規会員登録後に送る Flex Message (全品10%OFFクーポン特典) */
function buildRegisterRewardMessage(customerName) {
  var liffShop = 'https://liff.line.me/' + cfg('LIFF_ID', '1657458587-mz1dR9e6') + '/shop.html';
  var greeting = customerName ? (customerName + ' 様') : 'お客様';
  return {
    type: 'flex',
    altText: '🎁 全品10%OFFクーポン — 会員登録ありがとうございます',
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
          { type: 'text', text: '🎁 全品10%OFFクーポン GET!', weight: 'bold', size: 'lg', color: '#0F3D2E' },
          { type: 'text', text: greeting + '、会員登録ありがとうございます！アンケート回答特典の全品10%OFFクーポンです。', wrap: true, size: 'sm', color: '#666666' },
          { type: 'separator' },
          { type: 'text', text: 'クーポンコード', weight: 'bold', size: 'xs', color: '#888888', margin: 'md' },
          { type: 'text', text: linkCouponCode_(), weight: 'bold', size: 'xxl', color: '#0F3D2E', align: 'center' },
          { type: 'text', text: 'お会計の「クーポンコード」欄に入力 → 全品10%OFF！', wrap: true, size: 'xs', color: '#999999' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '🛒 商品を見る', uri: liffShop },
            style: 'primary',
            color: '#0F3D2E',
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
      hero: { type: 'image', url: 'https://www.eda-livestock.com/public/images/line/ship-truck.png', size: 'full', aspectRatio: '16:9', aspectMode: 'cover' },
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
  var trackUrl = tracking ? 'https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?number01=' + encodeURIComponent(tracking) : '';
  var rows = [['ご注文番号', orderNum], ['お問い合わせ番号', tracking || '-']];
  if (deliveryDate) rows.push(['お届け予定', deliveryDate]);
  var lines = [
    greeting,
    '',
    'ご注文の商品を発送いたしました。',
    '',
    '注文番号: ' + orderNum,
    '配送番号: ' + (tracking || '-')
  ];
  if (deliveryDate) lines.push('お届け予定: ' + deliveryDate);
  if (trackUrl) {
    lines.push('');
    lines.push('配送状況の確認（クロネコヤマト）:');
    lines.push(trackUrl);
  }
  lines.push('');
  lines.push('このたびは江田畜産をご利用いただき、誠にありがとうございます。');
  try {
    MailApp.sendEmail({
      to: email,
      name: BRAND_MAIL.sender,
      subject: '【江田畜産】商品を発送しました（' + orderNum + '）',
      body: lines.join('\n'),
      htmlBody: brandEmailHtml_({
        heroUrl: BRAND_MAIL.heroShip,
        title: '商品を発送しました',
        intro: greeting + '、お待たせいたしました。<br>ご注文の商品をクール冷凍便で発送いたしました。お受け取り後は冷凍庫で保管してください。',
        rows: rows,
        ctaLabel: '配送状況を確認する',
        ctaUrl: trackUrl || 'https://www.eda-livestock.com/mypage.html',
        cta2Label: 'マイページ',
        cta2Url: 'https://www.eda-livestock.com/mypage.html',
        note: '※ お問い合わせ番号の反映には数時間かかる場合があります。<br>※ 解凍は冷蔵庫でゆっくり戻していただくと、旨みを逃さずお召し上がりいただけます。'
      })
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
/* ============================================================
   🔒 STAFF 認証トークン（ステートレス HMAC・12時間有効）
   - 秘密鍵 = Script Properties STAFF_TOKEN_SECRET（無ければ自動生成・サーバ内のみ）
   - token = "<expMs>.<base64url(HMAC_SHA256(expMs, secret))>"
   - staffLogin で発行 → フロントが ?token= で送る → requireStaff(e) が router で検証
   ============================================================ */
function staffSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('STAFF_TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('STAFF_TOKEN_SECRET', s); }
  return s;
}
function makeStaffToken_(expMs) {
  var sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(String(expMs), staffSecret_()));
  return String(expMs) + '.' + sig;
}
function verifyStaffToken_(token) {
  if (!token) return false;
  var parts = String(token).split('.');
  if (parts.length !== 2) return false;
  var expMs = Number(parts[0]);
  if (!expMs || Date.now() > expMs) return false;
  var expect = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(String(expMs), staffSecret_()));
  return expect === parts[1];
}
function requireStaff(e) {
  var token = (e && e.parameter && e.parameter.token) || '';
  return verifyStaffToken_(token);
}

function staffLogin(params) {
  const pin = params.pin || '';
  const validPin = cfg('STAFF_PIN', '1234');
  if (String(pin) !== String(validPin)) {
    return jsonResponse({ ok:false, success:false, error: 'Invalid PIN' });
  }
  const token = makeStaffToken_(Date.now() + 12 * 3600 * 1000); // 12h 有効
  return jsonResponse({ ok:true, success:true, token: token, name: '江田畜産スタッフ', role: 'admin' });
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
  'image','isOrganic','comingSoon','published','components'
];

/* ============================================================
   BOM (調合) — セット商品を構成品に展開して在庫を管理する
   ------------------------------------------------------------
   セット商品は「自分の stock」ではなく「構成品の stock」で
   在庫チェック(validateStockBeforeCheckout)と
   在庫減算(decrementStockAfterOrder)を行う。
   → セットが1つ売れたら構成品がそれぞれ減る＝二重販売しない。

   定義場所は2つ。両方あればシートが優先。
     1. products シートの components 列 (JSON文字列・列は任意)
        [{"name":"ミスジステーキ","qty":1},{"name":"切り落とし","qty":1}]
     2. 下の PRODUCT_BOM 定数 (列を足さずに使える)
   name は products シートの name と完全一致させること
   (在庫の突合は全て name 一致で動いているため)。
   ============================================================ */
const PRODUCT_BOM = {
  '肉の日限定セット': [
    { name: 'ミスジステーキ', qty: 1 },
    { name: '切り落とし',     qty: 1 }
  ]
};

/* 商品名 → 構成品 の対応表を作る (シート列 > 定数 の優先順) */
function bomMap_(data, headers) {
  const map = {};
  Object.keys(PRODUCT_BOM).forEach(k => { map[k] = PRODUCT_BOM[k]; });

  const nameIdx = headers.indexOf('name');
  const compIdx = headers.indexOf('components');
  if (nameIdx === -1 || compIdx === -1) return map;

  for (let i = 1; i < data.length; i++) {
    const raw = data[i][compIdx];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) map[data[i][nameIdx]] = parsed;
    } catch (e) {
      log('bom_parse_error', { name: data[i][nameIdx], raw: String(raw).slice(0, 120) });
    }
  }
  return map;
}

/* {商品名: 必要数} を受け取り、セットを構成品に置き換えた {商品名: 必要数} を返す。
   入れ子セットにも対応。循環参照は深さ5で打ち切る (無限ループ防止)。 */
function expandBundles_(unitsByTitle, data, headers) {
  const bom = bomMap_(data, headers);
  if (!Object.keys(bom).length) return unitsByTitle;

  let cur = unitsByTitle;
  for (let depth = 0; depth < 5; depth++) {
    let expanded = false;
    const next = {};
    Object.keys(cur).forEach(title => {
      const units = cur[title];
      const comps = bom[title];
      if (!comps) { next[title] = (next[title] || 0) + units; return; }
      expanded = true;
      comps.forEach(c => {
        const n = c.name || c.title;
        if (!n) return;
        next[n] = (next[n] || 0) + units * (Number(c.qty) || 1);
      });
    });
    cur = next;
    if (!expanded) break;
  }
  return cur;
}

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
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);  // 在庫の read-modify-write を直列化（同時更新のロストアップデート防止）
  try {
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
  } finally {
    lock.releaseLock();
  }
}

/* POST staff_product_save { 全フィールド } — 新規追加 or 全フィールド更新 */
function staffProductSave(body) {
  if (!body.variantId) throw new Error('variantId required');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);  // 商品行の read-modify-write を直列化
  try {
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
      /* components など配列/オブジェクトは JSON 文字列で保存
         (String() だと "[object Object]" になり BOM が壊れる) */
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });

    if (foundRow > 0) {
      sh.getRange(foundRow, 1, 1, row.length).setValues([row]);
      return jsonResponse({ ok:true, action: 'updated', row: foundRow });
    } else {
      sh.appendRow(row);
      return jsonResponse({ ok:true, action: 'created' });
    }
  } finally {
    lock.releaseLock();
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
      // 冪等化: 既に発送済み(status=shipped/delivered) or 伝票番号が既存なら「再発送」とみなし、
      //         LINE/メール通知を再送しない（二重通知防止）。記録(伝票/STS)の更新自体は許可。
      const _existingTracking = tnIdx >= 0 ? String(data[i][tnIdx] || '').trim() : '';
      const _alreadyShipped = (_curStatus === 'shipped' || _curStatus === 'delivered') || !!_existingTracking;
      if (tnIdx === -1) {
        sh.getRange(1, headers.length + 1).setValue('tracking_number');
        tnIdx = headers.length;
      }
      const tracking = String(body.tracking_number || '').trim();
      sh.getRange(i + 1, tnIdx + 1).setValue(tracking);
      if (stIdx >= 0) sh.getRange(i + 1, stIdx + 1).setValue('shipped');
      // お届け予定日も orders に保存（マイページ「次回お届け予定」に反映。従来は通知のみで未保存＝日程調整中バグ）。
      if (body.delivery_date) {
        var _hdrNow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        var _ddIdx = _hdrNow.indexOf('delivery_date');
        if (_ddIdx === -1) { _ddIdx = _hdrNow.length; sh.getRange(1, _ddIdx + 1).setValue('delivery_date'); }
        var _ddCell = sh.getRange(i + 1, _ddIdx + 1); _ddCell.setNumberFormat('@'); _ddCell.setValue(String(body.delivery_date).slice(0, 10));
      }

      // ★ 発送通知 (②配送確定): 発送伝票確定が起点。初回発送時のみ送る（_alreadyShipped は再送しない）。
      //   LINE 連携済み (line_uid あり。無ければ email 逆引き) → LINE で配送番号/お届け予定。
      //   未連携、または LINE 失敗 → メール。通知失敗で発送記録自体は失敗させない。
      //   🔕 body.notify === false なら通知せず記録のみ（担当が手動連絡する場合用・既定は通知あり）。
      const _doNotify = body.notify !== false;
      if (!_alreadyShipped && _doNotify) {
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
      } else if (!_doNotify) {
        log('ship_notify_suppressed', { order: body.order_number, tracking: tracking });
      }

      return jsonResponse({ ok:true, already: _alreadyShipped, notified: (!_alreadyShipped && _doNotify) });
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
/* 🟢 ヤマトB2クラウド「基本レイアウト」標準フォーマット(送り状発行データレイアウト 公式 No.1〜28順)の行を構築する共有ヘルパー。
   CSV出力(b2CsvExport)と発送スプシ(writeShippingSheet)の両方が使う＝ロジック一元化。
   固定値→送り状種類=0発払い / クール区分=1冷凍 / 出荷予定日=当日(JST) / 敬称=様 / 依頼主(19-26列)=空欄=B2アカウント既定(江田畜産)補完。
   配達時間帯(7列)はヤマトコード(0812午前/1416/1618/1820/1921)のみ。1宛先=1ラベル。未発送の実注文のみ(発送済/社内テスト除外)。 */
const B2_HEADER = ['お客様管理番号','送り状種類','クール区分','伝票番号','出荷予定日','お届け予定（指定）日','配達時間帯','お届け先コード','お届け先電話番号','お届け先電話番号枝番','お届け先郵便番号','お届け先住所','お届け先住所（アパートマンション名）','お届け先会社・部門名１','お届け先会社・部門名２','お届け先名','お届け先名略称カナ','敬称','ご依頼主コード','ご依頼主電話番号','ご依頼主電話番号枝番','ご依頼主郵便番号','ご依頼主住所','ご依頼主住所（アパートマンション名）','ご依頼主名','ご依頼主略称カナ','品名コード１','品名１'];

function b2Rows_() {
  const sh = sheet('orders');
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { header: B2_HEADER, rows: [], excluded: 0 };
  const headers = data[0];
  const get = (row, name) => row[headers.indexOf(name)] || '';
  // 列ズレ防止: 各項目のカンマ/改行を除去（ヤマトB2は素のCSV取込＝引用符でなく除去で安全。スプシ→CSV書出時も同基準）。
  const clean = (v) => String(v == null ? '' : v).replace(/,/g, ' ').replace(/[\r\n]+/g, ' ');
  // 配達時間帯はヤマト公式コードのみ許可。EC checkout は既にコード値(0812等)で保存。不正値は空＝指定なし。
  const timeCode = (v) => {
    const t = String(v || '').trim();
    if (/^(0812|1416|1618|1820|1921)$/.test(t)) return t;            // 既にヤマトコード
    if (t.indexOf('午前') >= 0) return '0812';                       // 午前中（〜12:00）
    if (t.indexOf('14') >= 0 && t.indexOf('16') >= 0) return '1416'; // 14:00 - 16:00
    if (t.indexOf('16') >= 0 && t.indexOf('18') >= 0) return '1618'; // 16:00 - 18:00
    if (t.indexOf('18') >= 0 && t.indexOf('20') >= 0) return '1820'; // 18:00 - 20:00（推奨）
    if (t.indexOf('19') >= 0 && t.indexOf('21') >= 0) return '1921'; // 19:00 - 21:00
    return '';
  };
  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd'); // 出荷予定日=実行当日(JST)
  const rows = [];
  let excluded = 0;
  data.slice(1).forEach(row => {
    const ps = String(get(row, 'payment_status') || '').toLowerCase();
    if (ps === 'awaiting_payment') return;                                   // 🏦 未入金(銀行振込)は対象外
    if (ps === 'shipped' || ps === 'delivered' || get(row, 'tracking_number')) { excluded++; return; } // 🚚 発送済みは対象外
    if (String(get(row, 'customer_email') || '').toLowerCase().indexOf('@eda-livestock.com') >= 0) { excluded++; return; } // 🧪 社内テスト除外
    const name = get(row, 'customer_name');
    const orderNo = get(row, 'order_number');
    const orderDDate = String(get(row, 'delivery_date') || '').slice(0, 10).replace(/-/g, '/');  // ISO→YYYY/MM/DD (注文共通=フォールバック)
    const orderTCode = timeCode(get(row, 'delivery_time'));
    // 1宛先=1送り状(1ラベル)。複数個口は発行枚数/複数口で別管理(現状1箱運用)。お届け予定日(dd)/時間帯(tc)は宛先ごと。
    const pushRow = (tel, zip, addr, nm, hinmei, dd, tc) => {
      const r = new Array(28).fill('');
      r[0]  = clean(orderNo);  // 1 お客様管理番号
      r[1]  = '0';             // 2 送り状種類=発払い
      r[2]  = '1';             // 3 クール区分=クール冷凍(全商品冷凍・冷蔵追加時はproducts.temp連動に要変更)
      r[4]  = today;           // 5 出荷予定日=当日(JST)
      r[5]  = dd || '';        // 6 お届け予定（指定）日(宛先ごと)
      r[6]  = tc || '';        // 7 配達時間帯(コード・宛先ごと)
      r[8]  = clean(tel);      // 9 お届け先電話番号
      r[10] = clean(zip);      // 11 お届け先郵便番号
      r[11] = clean(addr);     // 12 お届け先住所
      r[15] = clean(nm);       // 16 お届け先名
      r[17] = '様';            // 18 敬称
      r[27] = clean(hinmei);   // 28 品名１
      rows.push(r);
    };
    // 🔴 定期便は items が空でも初回/毎月のボックスを必ず出荷する（2026-06-11 松本様の初回ボックスが
    //   発送リスト/B2 から漏れた対策）。品名は「定期便ボックス（プラン）」を合成する。
    const isSub = String(get(row, 'mode') || '').indexOf('subscription') === 0;
    let subPlan = '';
    if (isSub) { try { subPlan = JSON.parse(get(row, 'metadata_json') || '{}').plan || ''; } catch (e) {} }
    const dest = get(row, 'destinations_json');
    try {
      const d = JSON.parse(dest);
      d.forEach(addr => {
        // 商品が割り当てられていない宛先(ギフトのご依頼主=差出人など)は配送ラベルを作らない。
        // ただし定期便は items 空が正常形＝ボックスとして出荷対象に含める。
        const its = Array.isArray(addr.items) ? addr.items : [];
        if (its.length === 0 && !isSub) return;
        const hinmei = its.length
          ? its.map(function (it) { return (it.title || '') + (it.variant ? (' ' + it.variant) : ''); }).join(' / ')
          : ('定期便ボックス' + (subPlan ? '（' + subPlan + '）' : ''));
        // 🔴 お届け先ごとの希望日/時間（destinations[].delivery）を優先。無ければ注文共通(order-level)へフォールバック。
        const _dv = addr.delivery || {};
        const _dd = _dv.date ? String(_dv.date).slice(0, 10).replace(/-/g, '/') : orderDDate;
        const _tc = _dv.time ? timeCode(_dv.time) : orderTCode;
        pushRow(addr.tel || addr.phone || get(row, 'customer_phone') || '', addr.zip || '', (addr.pref || '') + (addr.address || ''), addr.name || name, hinmei, _dd, _tc);
      });
    } catch (e) {
      pushRow('', '', '', name, '', orderDDate, orderTCode);
    }
  });
  return { header: B2_HEADER, rows: rows, excluded: excluded };
}

/* スタッフがB2クラウドへ取り込むCSV(?action=b2_csv)。取込パターン=「基本レイアウト(csv)」・取込み開始行=2。 */
function b2CsvExport() {
  try {
    const b = b2Rows_();
    if (b.excluded) log('b2_csv_excluded', { count: b.excluded, note: '発送済み/社内テストを除外' });
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
    const csv = [b.header.join(',')].concat(b.rows.map(function (r) { return r.join(','); }));
    return ContentService.createTextOutput(csv.join('\n'))
      .setMimeType(ContentService.MimeType.CSV)
      .downloadAsFile('b2-' + today.replace(/\//g, '-') + '.csv');
  } catch (e) {
    return ContentService.createTextOutput('error: ' + e.message);
  }
}

/* 🟢 専用「EC発送」スプシ(スタッフPC用)へ未発送注文を自動書き出し。30分ごとの時刻トリガー(setupShippingSheet で設置)で実行＝常に最新。
   書き出し先IDは Script Property SHIPPING_SHEET_ID。「発送リスト」タブ(基本レイアウト28列・ファイル→ダウンロード→CSVでB2取込)＋「使い方」タブ。
   注文確定等の重要処理には一切割り込まない(独立トリガー)＝安全。 */
function writeShippingSheet() {
  try {
    const id = PROPS.getProperty('SHIPPING_SHEET_ID');
    if (!id) return 'no_sheet_id';
    const b = b2Rows_();
    const ss = SpreadsheetApp.openById(id);
    // --- 発送リスト(B2取込用・先頭タブ) ---
    const list = ss.getSheetByName('発送リスト') || ss.insertSheet('発送リスト', 0);
    list.clear();
    const all = [b.header].concat(b.rows);
    list.getRange(1, 1, all.length, b.header.length).setValues(all);
    list.setFrozenRows(1);
    ss.setActiveSheet(list); ss.moveActiveSheet(1);
    // --- 使い方 ---
    const help = ss.getSheetByName('使い方') || ss.insertSheet('使い方');
    help.clear();
    const ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    help.getRange(1, 1, 9, 1).setValues([
      ['📦 EC発送リスト（スタッフ用・自動更新）'],
      ['最終更新: ' + ts + ' ／ 未発送 ' + b.rows.length + ' 件（30分ごとに自動更新）'],
      [''],
      ['① 「発送リスト」タブを開く → ファイル → ダウンロード → カンマ区切り形式(.csv)'],
      ['② ヤマトB2クラウド → 外部データから発行 → 取込パターン「基本レイアウト(csv,xls,xlsx)」/ 取込み開始行=2 → 取込み開始'],
      ['③ 「修正必要 0件」を確認 → 印刷内容の確認へ → 発行（ラベル印刷）'],
      ['④ 発送後、STAFFページで該当注文に伝票番号を入力し「発送済として記録」（お客様へ通知が1回送られます）'],
      [''],
      ['※ このリストは「未発送の実注文のみ」。発送処理すると次回更新で自動的に消えます。'],
    ]);
    help.setColumnWidth(1, 760);
    // 余計なタブ(作成時の既定シート等)は削除し、2タブだけにする
    ss.getSheets().forEach(function (s) {
      const n = s.getName();
      if (n !== '発送リスト' && n !== '使い方') ss.deleteSheet(s);
    });
    return 'ok:' + b.rows.length;
  } catch (e) { log('shipping_sheet_error', { error: e.message }); return 'error:' + e.message; }
}

/* 🟢 初回セットアップ(1回だけGASエディタで実行)。専用「EC発送」スプシを作成→ID保存→30分自動更新トリガー設置→初回書き出し。
   返り値=スプシURL。実行後、Tom がそのスプシを開いてスタッフ(田崎/野々)へ共有する。再実行は冪等(既存IDを再利用)。 */
function setupShippingSheet() {
  let id = PROPS.getProperty('SHIPPING_SHEET_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('★EC発送リスト（スタッフ用・自動更新）');
    PROPS.setProperty('SHIPPING_SHEET_ID', ss.getId());
    try { DriveApp.getFileById(ss.getId()).addEditor('tomoki@eda-livestock.com'); } catch (e) {}
  }
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'writeShippingSheet'; });
  if (!has) ScriptApp.newTrigger('writeShippingSheet').timeBased().everyMinutes(30).create();
  writeShippingSheet();
  return ss.getUrl();
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

    /* dev/テスト流入(localhost/127.0.0.1)の session を除外集合に（分析の汚染除去・2026-06-02） */
    const devSessions = {};
    for (let j = 1; j < data.length; j++) {
      const rj = data[j][refIdx];
      if (rj && /^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(String(rj))) {
        const sj = data[j][sidIdx];
        if (sj) devSessions[sj] = true;
      }
    }

    for (let i = 1; i < data.length; i++) {
      const ts = new Date(data[i][tsIdx]);
      if (isNaN(ts.getTime())) continue;
      if (ts < since) continue;

      const type = data[i][typeIdx];
      const sid = data[i][sidIdx];
      if (sid && devSessions[sid]) continue; // dev/localhost セッションは分析から除外
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
      const dayKey = Utilities.formatDate(ts, 'Asia/Tokyo', 'yyyy-MM-dd'); /* JST基準。toISOString(UTC)だと0〜9時の取引が前日にズレるため(2026-06-08修正) */
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
