/* ============================================================
   経営/STAFF ダッシュボード用 追加アクション
   ============================================================
   使い方:
   1. GAS エディタ (https://script.google.com/) を開く
   2. 既存の Code.gs ファイルの末尾にこの内容をコピペ
   3. 既存の doGet(e) の switch (action) に下記の case を追加:

      case 'orders':            return ordersOverview(e.parameter);
      case 'subscriptions':     return subscriptionsOverview(e.parameter);
      case 'customers':         return customersOverview(e.parameter);
      case 'survey_responses':  return surveyResponsesOverview(e.parameter);
      case 'quiz_responses':    return quizResponsesOverview(e.parameter);
      case 'shipments':         return shipmentsOverview(e.parameter);
      /* staff_analytics は Code.gs に既存実装あり — 再デプロイで動く */

   4. 「デプロイ → デプロイを管理 → 編集（鉛筆アイコン）→ 新バージョン → デプロイ」
   5. https://edywagyu.github.io/eda-livestock-web/dashboard.html を再読込
      → 全タブで実データが表示される

   注意:
   - jsonResponse(), getSheet(), log() は既存 Code.gs の関数を再利用
   - シート名 (Orders, Subscriptions, Customers, Survey, Quiz) は実シート名と要確認
   - 列番号 (col 0 = A列) は実シートのヘッダ順に合わせて調整してください
   ============================================================ */

/* ====== 注文一覧 (dashboard.html の 注文タブ) ====== */
function ordersOverview(params) {
  var sheet = getSheet('Orders') || getSheet('orders');
  if (!sheet) return jsonResponse({ ok: true, orders: [], note: 'Orders シート未作成' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, orders: [] });

  // ヘッダ行から列インデックスを動的取得（順序が変わっても壊れない）
  var hdr = rows[0];
  function idx(name) { return hdr.indexOf(name); }
  var i_num = idx('order_no')      >= 0 ? idx('order_no')      : 0;
  var i_dt  = idx('created_at')    >= 0 ? idx('created_at')    : 1;
  var i_nm  = idx('customer_name') >= 0 ? idx('customer_name') : 2;
  var i_it  = idx('items')         >= 0 ? idx('items')         : 3;
  var i_tot = idx('total')         >= 0 ? idx('total')         : 4;
  var i_pay = idx('payment')       >= 0 ? idx('payment')       : 5;
  var i_shp = idx('shipping')      >= 0 ? idx('shipping')      : 6;
  var i_mod = idx('mode')          >= 0 ? idx('mode')          : 7;

  var orders = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[i_num]) continue;
    orders.push({
      num:      String(row[i_num]),
      date:     row[i_dt] ? Utilities.formatDate(new Date(row[i_dt]), 'JST', 'yyyy-MM-dd HH:mm') : '',
      customer: String(row[i_nm] || ''),
      items:    String(row[i_it] || ''),
      total:    Number(row[i_tot]) || 0,
      payment:  String(row[i_pay] || ''),
      shipping: String(row[i_shp] || 'pending').toLowerCase(),
      mode:     String(row[i_mod] || 'single')
    });
  }
  // 新しい順に並べる
  orders.sort(function(a,b) { return (b.date || '').localeCompare(a.date || ''); });
  return jsonResponse({ ok: true, orders: orders });
}

/* ====== 定期便メンバー (dashboard.html の 定期便メンバータブ) ====== */
function subscriptionsOverview(params) {
  var sheet = getSheet('Subscriptions') || getSheet('subscriptions');
  if (!sheet) return jsonResponse({ ok: true, subs: [], note: 'Subscriptions シート未作成' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, subs: [] });
  var hdr = rows[0];
  function idx(name) { return hdr.indexOf(name); }
  var subs = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[0]) continue;
    var start = row[idx('start_date') >= 0 ? idx('start_date') : 2];
    var next  = row[idx('next_delivery') >= 0 ? idx('next_delivery') : 3];
    subs.push({
      name:   String(row[idx('customer_name') >= 0 ? idx('customer_name') : 0] || ''),
      plan:   String(row[idx('plan') >= 0 ? idx('plan') : 1] || ''),
      start:  start ? Utilities.formatDate(new Date(start), 'JST', 'yyyy-MM-dd') : '',
      next:   next  ? Utilities.formatDate(new Date(next),  'JST', 'yyyy-MM-dd') : '',
      total:  String(row[idx('total_deliveries') >= 0 ? idx('total_deliveries') : 4] || '0回'),
      status: String(row[idx('status') >= 0 ? idx('status') : 5] || 'active')
    });
  }
  return jsonResponse({ ok: true, subs: subs });
}

/* ====== 顧客 CRM (dashboard.html の 顧客タブ) ====== */
function customersOverview(params) {
  var sheet = getSheet('Customers') || getSheet('customers');
  if (!sheet) return jsonResponse({ ok: true, customers: [], note: 'Customers シート未作成' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, customers: [] });
  var hdr = rows[0];
  function idx(name) { return hdr.indexOf(name); }
  var now = new Date().getTime();
  var customers = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[0]) continue;
    var totalSpent = Number(row[idx('total_spent') >= 0 ? idx('total_spent') : 4]) || 0;
    var totalOrders = Number(row[idx('total_orders') >= 0 ? idx('total_orders') : 3]) || 0;
    var lastOrderDate = row[idx('last_order') >= 0 ? idx('last_order') : 5];
    var daysSince = lastOrderDate ? Math.floor((now - new Date(lastOrderDate).getTime()) / (24 * 3600 * 1000)) : 999;
    // セグメント自動判定
    var segment;
    if (totalSpent >= 30000) segment = 'vip';
    else if (daysSince > 90)  segment = 'dormant';
    else if (totalOrders >= 2) segment = 'repeater';
    else segment = 'new';
    customers.push({
      name:    String(row[idx('name')  >= 0 ? idx('name')  : 0] || ''),
      email:   String(row[idx('email') >= 0 ? idx('email') : 1] || ''),
      phone:   String(row[idx('phone') >= 0 ? idx('phone') : 2] || ''),
      total:   totalSpent,
      last:    lastOrderDate ? Utilities.formatDate(new Date(lastOrderDate), 'JST', 'yyyy-MM-dd') : '',
      segment: segment,
      line:    !!row[idx('line_uid') >= 0 ? idx('line_uid') : 6],
      survey:  String(row[idx('survey_organic') >= 0 ? idx('survey_organic') : 7] || '')
    });
  }
  // 累計金額順
  customers.sort(function(a,b) { return b.total - a.total; });
  return jsonResponse({ ok: true, customers: customers });
}

/* ====== アンケート集計 (dashboard.html の アンケート分析タブ) ====== */
function surveyResponsesOverview(params) {
  var sheet = getSheet('Survey') || getSheet('survey');
  if (!sheet) return jsonResponse({ ok: true, survey: emptySurvey(), count: 0, note: 'Survey シート未作成' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, survey: emptySurvey(), count: 0 });
  var hdr = rows[0];
  function idx(name) { return hdr.indexOf(name); }
  var iOrg = idx('organic'); var iSrc = idx('source'); var iMt = idx('meats');
  var organic = {}, source = {}, meats = {};
  function bump(obj, key) { if (!key) return; obj[key] = (obj[key] || 0) + 1; }
  for (var r = 1; r < rows.length; r++) {
    if (iOrg >= 0) bump(organic, rows[r][iOrg]);
    if (iSrc >= 0) bump(source,  rows[r][iSrc]);
    if (iMt  >= 0) {
      // meats はカンマ区切りで複数選択を許容
      String(rows[r][iMt] || '').split(/[,、]/).forEach(function(m) { bump(meats, m.trim()); });
    }
  }
  return jsonResponse({ ok: true, survey: { organic: organic, source: source, meats: meats }, count: rows.length - 1 });
}
function emptySurvey() { return { organic: {}, source: {}, meats: {} }; }

/* ====== クイズ集計 (dashboard.html の 診断クイズタブ) ====== */
function quizResponsesOverview(params) {
  var sheet = getSheet('Quiz') || getSheet('quiz');
  if (!sheet) return jsonResponse({ ok: true, quiz: emptyQuiz(), count: 0, note: 'Quiz シート未作成' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, quiz: emptyQuiz(), count: 0 });
  var hdr = rows[0];
  function idx(name) { return hdr.indexOf(name); }
  var iFam = idx('family'); var iFrq = idx('frequency'); var iBdg = idx('budget');
  var fam = {}, freq = {}, budget = {};
  function bump(obj, key) { if (!key) return; obj[key] = (obj[key] || 0) + 1; }
  for (var r = 1; r < rows.length; r++) {
    if (iFam >= 0) bump(fam, rows[r][iFam]);
    if (iFrq >= 0) bump(freq, rows[r][iFrq]);
    if (iBdg >= 0) bump(budget, rows[r][iBdg]);
  }
  return jsonResponse({ ok: true, quiz: { fam: fam, freq: freq, budget: budget }, count: rows.length - 1 });
}
function emptyQuiz() { return { fam: {}, freq: {}, budget: {} }; }

/* ====== 配送ステータス (dashboard.html の 配送ステータスタブ) ====== */
function shipmentsOverview(params) {
  // Orders シートから shipping ステータス別に集計
  var sheet = getSheet('Orders') || getSheet('orders');
  if (!sheet) return jsonResponse({ ok: true, shipments: [], note: 'Orders シート未作成' });
  var rows = sheet.getDataRange().getValues();
  var counts = { pending: 0, paid: 0, shipped: 0, delivered: 0 };
  for (var r = 1; r < rows.length; r++) {
    var status = String(rows[r][6] || 'pending').toLowerCase();
    if (counts[status] !== undefined) counts[status]++;
  }
  return jsonResponse({ ok: true, counts: counts, total: rows.length - 1 });
}

/* ※ staffAnalytics() は Code.gs に既存実装あり (L2292〜)。重複定義は削除済み。
   未実装に見えていた原因は GAS 本体の再デプロイ未実施。
   doGet switch には Code.gs に既に case あり。 */

/* ============================================================
   実装メモ:
   - getSheet(name) は Code.gs 既存の関数 (シートをタブ名で取得)
   - jsonResponse(obj) は Code.gs 既存の関数 (CORS対応のJSONレスポンス)
   - log(action, payload) は Code.gs 既存の関数 (ログタブ書き込み)

   getSheet が無い場合の代替:
     function getSheet(name) {
       var ssId = PROPS.getProperty('SPREADSHEET_ID');
       return SpreadsheetApp.openById(ssId).getSheetByName(name);
     }
   ============================================================ */
