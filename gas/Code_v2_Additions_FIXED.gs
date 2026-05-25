/* ============================================================
   経営/STAFF ダッシュボード用 追加アクション (v2)
   ============================================================
   Code.gs と同じプロジェクト内に置く。
   ============================================================ */

// getSheet ヘルパー (Code.gs に無い場合の補完)
function getSheet(name) {
  try {
    return ss().getSheetByName(name);
  } catch (e) {
    return null;
  }
}

/* ====== 注文一覧 ====== */
function ordersOverview(params) {
  var sheet = getSheet('Orders') || getSheet('orders');
  if (!sheet) return jsonResponse({ ok: true, orders: [], note: 'Orders sheet not found' });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, orders: [] });
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
      num: String(row[i_num]),
      date: row[i_dt] ? Utilities.formatDate(new Date(row[i_dt]), 'JST', 'yyyy-MM-dd HH:mm') : '',
      customer: String(row[i_nm] || ''),
      items: String(row[i_it] || ''),
      total: Number(row[i_tot]) || 0,
      payment: String(row[i_pay] || ''),
      shipping: String(row[i_shp] || 'pending').toLowerCase(),
      mode: String(row[i_mod] || 'single')
    });
  }
  orders.sort(function(a,b) { return (b.date || '').localeCompare(a.date || ''); });
  return jsonResponse({ ok: true, orders: orders });
}

/* ====== 定期便メンバー ====== */
function subscriptionsOverview(params) {
  var sheet = getSheet('Subscriptions') || getSheet('subscriptions');
  if (!sheet) return jsonResponse({ ok: true, subs: [] });
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
      total:  String(row[idx('total_deliveries') >= 0 ? idx('total_deliveries') : 4] || '0'),
      status: String(row[idx('status') >= 0 ? idx('status') : 5] || 'active')
    });
  }
  return jsonResponse({ ok: true, subs: subs });
}

/* ====== 顧客 CRM ====== */
function customersOverview(params) {
  var sheet = getSheet('Customers') || getSheet('customers');
  if (!sheet) return jsonResponse({ ok: true, customers: [] });
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
  customers.sort(function(a,b) { return b.total - a.total; });
  return jsonResponse({ ok: true, customers: customers });
}

/* ====== アンケート ====== */
function surveyResponsesOverview(params) {
  var sheet = getSheet('Survey') || getSheet('survey');
  if (!sheet) return jsonResponse({ ok: true, survey: { organic: {}, source: {}, meats: {} }, count: 0 });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, survey: { organic: {}, source: {}, meats: {} }, count: 0 });
  var hdr = rows[0];
  function idx(name) { return hdr.indexOf(name); }
  var iOrg = idx('organic'); var iSrc = idx('source'); var iMt = idx('meats');
  var organic = {}, source = {}, meats = {};
  function bump(obj, key) { if (!key) return; obj[key] = (obj[key] || 0) + 1; }
  for (var r = 1; r < rows.length; r++) {
    if (iOrg >= 0) bump(organic, rows[r][iOrg]);
    if (iSrc >= 0) bump(source,  rows[r][iSrc]);
    if (iMt  >= 0) {
      String(rows[r][iMt] || '').split(/[,]/).forEach(function(m) { bump(meats, m.trim()); });
    }
  }
  return jsonResponse({ ok: true, survey: { organic: organic, source: source, meats: meats }, count: rows.length - 1 });
}

/* ====== クイズ ====== */
function quizResponsesOverview(params) {
  var sheet = getSheet('Quiz') || getSheet('quiz');
  if (!sheet) return jsonResponse({ ok: true, quiz: { fam: {}, freq: {}, budget: {} }, count: 0 });
  var rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, quiz: { fam: {}, freq: {}, budget: {} }, count: 0 });
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

/* ====== 配送ステータス ====== */
function shipmentsOverview(params) {
  var sheet = getSheet('Orders') || getSheet('orders');
  if (!sheet) return jsonResponse({ ok: true, counts: { pending: 0, paid: 0, shipped: 0, delivered: 0 }, total: 0 });
  var rows = sheet.getDataRange().getValues();
  var counts = { pending: 0, paid: 0, shipped: 0, delivered: 0 };
  for (var r = 1; r < rows.length; r++) {
    var status = String(rows[r][6] || 'pending').toLowerCase();
    if (counts[status] !== undefined) counts[status]++;
  }
  return jsonResponse({ ok: true, counts: counts, total: rows.length - 1 });
}

/* ====== お問い合わせフォーム受信 ====== */
function submitInquiry(body) {
  if (!body || !body.name || !body.email) {
    return jsonResponse({ ok: false, error: 'name and email required' });
  }
  // 1. Inquiries シートに行追加
  try {
    var sheet = getSheet('Inquiries') || getSheet('inquiries');
    if (!sheet) {
      try {
        sheet = ss().insertSheet('Inquiries');
        sheet.appendRow([
          'timestamp','inquiry_type','name','company','title','email','phone',
          'country','city','message','source','referrer','status'
        ]);
      } catch (e2) {}
    }
    if (sheet) {
      sheet.appendRow([
        new Date(), body.inquiry_type || 'general',
        body.name, body.company || '', body.title || '',
        body.email, body.phone || '', body.country || '', body.city || '',
        body.message || '', 'contact.html',
        body.page_referrer || '', 'new'
      ]);
    }
  } catch (sheetErr) {
    try { log('submit_inquiry_sheet_error', { error: sheetErr.message }); } catch(_) {}
  }
  // 2. Tom にメール通知
  try {
    var typeMap = {
      general: 'general', wholesale: 'wholesale(B2B)', export: 'export buyer',
      press: 'press/media', investor: 'investor',
      career: 'career', organic: 'Organic Wagyu', partnership: 'partnership'
    };
    var typeLabel = typeMap[body.inquiry_type] || (body.inquiry_type || 'general');
    var subject = '[Inquiry] ' + typeLabel + ' / ' + (body.company || body.name) + ' - ' + body.name;
    var html = '<h2>New Inquiry: ' + typeLabel + '</h2>'
             + '<p>Name: ' + body.name + '</p>'
             + '<p>Company: ' + (body.company || '-') + '</p>'
             + '<p>Email: <a href="mailto:' + body.email + '">' + body.email + '</a></p>'
             + '<p>Phone: ' + (body.phone || '-') + '</p>'
             + '<p>Country: ' + (body.country || '-') + ' / City: ' + (body.city || '-') + '</p>'
             + '<hr><p>Message:</p><p>' + String(body.message || '').replace(/\n/g, '<br/>') + '</p>'
             + '<hr><p><a href="https://calendar.app.google/DjKHsVDhJHesaPM27">Book a 30-min call</a></p>';
    MailApp.sendEmail({
      to: 'tomoki@eda-livestock.com',
      subject: subject,
      htmlBody: html,
      replyTo: body.email
    });
  } catch (mailErr) {
    try { log('submit_inquiry_mail_error', { error: mailErr.message }); } catch(_) {}
  }
  // 3. 顧客に自動返信
  try {
    var isJP = !body.country || /Japan|JP/i.test(body.country || '');
    var replySubject = isJP ? '[Eda Livestock] Inquiry received' : 'Eda Livestock - We received your inquiry';
    var replyHtml = isJP
      ? '<p>' + body.name + ' 様</p><p>Thank you. We will reply within 24-48 hours.</p>'
        + '<p>Urgent? Book a direct 30-min call:<br/><a href="https://calendar.app.google/DjKHsVDhJHesaPM27">https://calendar.app.google/DjKHsVDhJHesaPM27</a></p>'
        + '<p>Eda Livestock Co., Ltd.</p>'
      : '<p>Dear ' + body.name + ',</p><p>Thank you for your inquiry. We will get back to you within 24-48 hours.</p>'
        + '<p>Urgent? Book a direct 30-min call:<br/><a href="https://calendar.app.google/DjKHsVDhJHesaPM27">https://calendar.app.google/DjKHsVDhJHesaPM27</a></p>'
        + '<p>Eda Livestock Co., Ltd.</p>';
    MailApp.sendEmail({
      to: body.email,
      subject: replySubject,
      htmlBody: replyHtml,
      name: 'Eda Livestock',
      replyTo: 'backoffice@eda-livestock.com'
    });
  } catch (replyErr) {
    try { log('submit_inquiry_autoreply_error', { error: replyErr.message }); } catch(_) {}
  }
  return jsonResponse({ ok: true });
}
