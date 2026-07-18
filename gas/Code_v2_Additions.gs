/* ============================================================
   経営/STAFF ダッシュボード用 追加アクション（実スキーマ準拠・修正版 2026-05-30）
   ============================================================
   ★ 旧版の不具合（本番で「全部嘘＝デモ」になっていた真因）:
      1) getSheet() が Code.gs に未定義 → orders/shipments/customers/
         subscriptions/survey_responses/quiz_responses が全て
         「getSheet is not defined」でクラッシュ → dashboard.html はデモへ。
      2) 列マッピングが実シートと不一致（items が顧客名、payment が電話 等）。
      3) 肝心の「届け先(destinations_json)」を一切返していなかった。
   ★ 修正方針:
      - ss() を使った get-only の getSheet() を定義（読み取りで新規作成しない）。
      - 実シートのヘッダ名で列を動的解決（順序が変わっても壊れない）。
      - ordersOverview は destinations_json=届け先 / items_json=商品 /
        payment_status=ステータス / tracking_number=追跡番号 を返す。
   ★ ss(), sheet(), jsonResponse(), log() は Code.gs 既存関数を再利用。
   ============================================================ */

/* シートを get-only で取得（存在しなければ null。読み取り目的で新規作成しない） */
function getSheet(name) {
  try { return ss().getSheetByName(name); } catch (e) { return null; }
}

/* ヘッダ配列 → 「列名で index を引く」関数を返す */
function _hdr(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) map[String(headers[i]).trim()] = i;
  return function (name, fallback) {
    return (map[name] !== undefined) ? map[name] : (fallback === undefined ? -1 : fallback);
  };
}

function _fmtDate(v, fmt) {
  if (!v && v !== 0) return '';
  try {
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return Utilities.formatDate(d, 'JST', fmt || 'yyyy-MM-dd HH:mm');
  } catch (e) { return String(v); }
}

function _safeParse(s, dflt) {
  if (s === null || s === undefined || s === '') return dflt;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return dflt; }
}

function _itemsText(itemsArr) {
  if (!Array.isArray(itemsArr)) return '';
  return itemsArr.map(function (it) {
    var t = it.title || it.name || '商品';
    var v = it.variant ? '（' + it.variant + '）' : '';
    return t + v + ' ×' + (it.qty || 1);
  }).join(' / ');
}

function _normDest(d) {
  d = d || {};
  return {
    type:    d.type || '',
    name:    d.name || '',
    tel:     d.tel || d.phone || '',
    zip:     d.zip || d.postal || '',
    pref:    d.pref || d.prefecture || '',
    address: d.address || '',
    items:   Array.isArray(d.items) ? d.items : []
  };
}

/* ====== 注文一覧（dashboard.html「注文」タブ / スタッフ発送の起点） ====== */
function ordersOverview(params) {
  var sh = getSheet('orders');
  if (!sh) return jsonResponse({ ok: true, orders: [], note: 'orders シート未作成' });
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, orders: [] });
  var col = _hdr(rows[0]);
  var iNum = col('order_number', 0), iAt = col('placed_at', 1),
      iName = col('customer_name', 3), iMail = col('customer_email', 4),
      iTel = col('customer_phone', 5), iMode = col('mode', 6),
      iTot = col('total', 7), iStat = col('payment_status', 9),
      iPay = col('payment_method', 10), iDest = col('destinations_json', 11),
      iItems = col('items_json', 12), iTrk = col('tracking_number'),
      iUid = col('line_uid');

  var orders = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[iNum]) continue;
    var itemsArr = _safeParse(row[iItems], []);
    var destArr = _safeParse(row[iDest], []).map(_normDest);
    orders.push({
      num:      String(row[iNum]),
      date:     _fmtDate(row[iAt]),
      customer: String(row[iName] || ''),
      email:    String(row[iMail] || ''),
      phone:    String(row[iTel] || ''),
      mode:     String(row[iMode] || 'single'),
      total:    Number(row[iTot]) || 0,
      status:   String(row[iStat] || 'pending').toLowerCase(),
      payment:  String(row[iPay] || ''),
      items:    itemsArr,
      itemsText: _itemsText(itemsArr),
      dest:     destArr,
      tracking: iTrk >= 0 ? String(row[iTrk] || '') : '',
      line_uid: iUid >= 0 ? String(row[iUid] || '') : ''
    });
  }
  orders.reverse(); /* 追記は時系列なので reverse で新しい順 */
  return jsonResponse({ ok: true, orders: orders });
}

/* ====== 配送ステータス（dashboard.html「配送ステータス」タブ） ======
   payment_status で集計。pending は「発送対象（未発送）」の実リストも返す。 */
function shipmentsOverview(params) {
  var empty = { pending: 0, paid: 0, preparing: 0, shipped: 0, delivered: 0 };
  var sh = getSheet('orders');
  if (!sh) return jsonResponse({ ok: true, counts: empty, total: 0, pending: [] });
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, counts: empty, total: 0, pending: [] });
  var col = _hdr(rows[0]);
  var iNum = col('order_number', 0), iAt = col('placed_at', 1),
      iName = col('customer_name', 3), iTel = col('customer_phone', 5),
      iStat = col('payment_status', 9), iDest = col('destinations_json', 11),
      iItems = col('items_json', 12), iTrk = col('tracking_number');
  var counts = { pending: 0, paid: 0, preparing: 0, shipped: 0, delivered: 0 };
  var pending = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[iNum]) continue;
    var st = String(row[iStat] || 'pending').toLowerCase();
    if (counts[st] === undefined) counts[st] = 0;
    counts[st]++;
    if (st !== 'shipped' && st !== 'delivered') {
      var destArr = _safeParse(row[iDest], []).map(_normDest);
      pending.push({
        num: String(row[iNum]),
        date: _fmtDate(row[iAt]),
        customer: String(row[iName] || ''),
        phone: String(row[iTel] || ''),
        status: st,
        itemsText: _itemsText(_safeParse(row[iItems], [])),
        dest: destArr,
        tracking: iTrk >= 0 ? String(row[iTrk] || '') : ''
      });
    }
  }
  return jsonResponse({ ok: true, counts: counts, total: rows.length - 1, pending: pending });
}

/* ====== 顧客 CRM ====== */
function customersOverview(params) {
  var sh = getSheet('customers');
  if (!sh) return jsonResponse({ ok: true, customers: [] });
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, customers: [] });
  var col = _hdr(rows[0]);
  var iMail = col('email', 1), iName = col('name', 2), iTel = col('phone', 3),
      iLast = col('last_order', 5), iSpent = col('total_spent', 6),
      iCnt = col('order_count', 7), iUid = col('line_uid', 8);
  var now = Date.now();
  var customers = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[iMail] && !row[iName]) continue;
    var spent = Number(row[iSpent]) || 0, cnt = Number(row[iCnt]) || 0;
    var last = row[iLast];
    var days = last ? Math.floor((now - new Date(last).getTime()) / 86400000) : 999;
    var seg = spent >= 30000 ? 'vip' : (days > 90 ? 'dormant' : (cnt >= 2 ? 'repeater' : 'new'));
    customers.push({
      name: String(row[iName] || ''),
      email: String(row[iMail] || ''),
      phone: String(row[iTel] || ''),
      total: spent,
      orders: cnt,
      last: _fmtDate(row[iLast], 'yyyy-MM-dd'),
      segment: seg,
      line: !!(iUid >= 0 && row[iUid])
    });
  }
  customers.sort(function (a, b) { return b.total - a.total; });
  return jsonResponse({ ok: true, customers: customers });
}

/* ====== 定期便メンバー ====== */
function subscriptionsOverview(params) {
  var sh = getSheet('subscriptions');
  if (!sh) return jsonResponse({ ok: true, subs: [] });
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, subs: [] });
  var col = _hdr(rows[0]);
  var iId = col('subscription_id', 0), iCust = col('customer_id', 1),
      iPlan = col('plan', 2), iStat = col('status', 3),
      iStart = col('started_at', 4), iNext = col('current_period_end', 5);
  var subs = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row[iId]) continue;
    subs.push({
      id: String(row[iId] || ''),
      customer: String(row[iCust] || ''),
      plan: String(row[iPlan] || ''),
      status: String(row[iStat] || 'active'),
      start: _fmtDate(row[iStart], 'yyyy-MM-dd'),
      next: _fmtDate(row[iNext], 'yyyy-MM-dd')
    });
  }
  return jsonResponse({ ok: true, subs: subs });
}

/* ====== アンケート集計（survey_responses: ts,session_id,order_number,organic,source,meats_json） ====== */
function surveyResponsesOverview(params) {
  var empty = { organic: {}, source: {}, meats: {} };
  var sh = getSheet('survey_responses');
  if (!sh) return jsonResponse({ ok: true, survey: empty, count: 0 });
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, survey: empty, count: 0 });
  var col = _hdr(rows[0]);
  var iOrg = col('organic'), iSrc = col('source'), iMt = col('meats_json');
  var organic = {}, source = {}, meats = {};
  function bump(o, k) { k = String(k || '').trim(); if (!k) return; o[k] = (o[k] || 0) + 1; }
  for (var r = 1; r < rows.length; r++) {
    if (iOrg >= 0) bump(organic, rows[r][iOrg]);
    if (iSrc >= 0) bump(source, rows[r][iSrc]);
    if (iMt >= 0) {
      var arr = _safeParse(rows[r][iMt], null);
      if (Array.isArray(arr)) arr.forEach(function (m) { bump(meats, m); });
      else String(rows[r][iMt] || '').split(/[,、]/).forEach(function (m) { bump(meats, m); });
    }
  }
  return jsonResponse({ ok: true, survey: { organic: organic, source: source, meats: meats }, count: rows.length - 1 });
}

/* ====== クイズ集計（quiz_responses: ts,session_id,fam,freq,meat,use,budget,answers_json） ====== */
function quizResponsesOverview(params) {
  var empty = { fam: {}, freq: {}, budget: {}, meat: {}, use: {} };
  var sh = getSheet('quiz_responses');
  if (!sh) return jsonResponse({ ok: true, quiz: empty, count: 0 });
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return jsonResponse({ ok: true, quiz: empty, count: 0 });
  var col = _hdr(rows[0]);
  var iFam = col('fam'), iFrq = col('freq'), iBud = col('budget'), iMeat = col('meat'), iUse = col('use');
  var fam = {}, freq = {}, budget = {}, meat = {}, use = {};
  function bump(o, k) { k = String(k || '').trim(); if (!k) return; o[k] = (o[k] || 0) + 1; }
  for (var r = 1; r < rows.length; r++) {
    if (iFam >= 0) bump(fam, rows[r][iFam]);
    if (iFrq >= 0) bump(freq, rows[r][iFrq]);
    if (iBud >= 0) bump(budget, rows[r][iBud]);
    if (iMeat >= 0) bump(meat, rows[r][iMeat]);
    if (iUse >= 0) bump(use, rows[r][iUse]);
  }
  return jsonResponse({ ok: true, quiz: { fam: fam, freq: freq, budget: budget, meat: meat, use: use }, count: rows.length - 1 });
}

/* ====== お問い合わせフォーム受信 (contact.html → POST submit_inquiry) ======
   - Inquiries シートに行追加 (なければ自動作成)
   - Tom にメール通知
   - 顧客に自動返信（予約への誘導つき）
   ====== */
/* スパム/詐欺 自動判定 (2026-07-18 Tom指示: スキャム・営業スパムを受信箱に入れない)
   spam(score>=6)   = シートに記録のみ・メール通知/自動返信なし
   suspicious(3-5)  = 通知するが件名【⚠️要注意】+ 警告バナー
   clean(0-2)       = 通常通知 (全通知にセキュリティ注意フッター) */
function classifyInquiry_(body) {
  var score = 0, reasons = [];
  var msg = String(body.message || '');
  var name = String(body.name || '');
  var email = String(body.email || '');
  // honeypot (フォームの不可視 fax 欄に入力あり = bot 確定。※name=website は contact.html の正規入力欄と衝突するため不可)
  if (body.fax) { score += 10; reasons.push('honeypot'); }
  // 表示から4秒未満で送信 = bot
  var secs = Number(body.form_secs);
  if (!isNaN(secs) && secs >= 0 && secs < 4) { score += 4; reasons.push('too_fast_' + secs + 's'); }
  // メッセージ内URL
  var urls = (msg.match(/https?:\/\//gi) || []).length;
  if (urls >= 2) { score += 4; reasons.push('urls_' + urls); }
  else if (urls === 1) { score += 2; reasons.push('url_1'); }
  // SEO/被リンク営業
  if (/被リンク|相互リンク|検索順位|SEO対策|SEO会社|アクセスアップ|集客支援|backlink|link building|guest post|seo (service|expert|ranking|agency)|website traffic|google ranking|digital marketing service/i.test(msg)) { score += 4; reasons.push('seo_sales'); }
  // 送金・前払い詐欺 (419型: アフリカ系詐欺の定型語)
  if (/million (usd|dollars|euros?)|inheritance|next of kin|beneficiar|unclaimed (fund|money)|transfer (of )?funds?|consignment|diplomat|lottery|compensation fund|western union|moneygram|business proposal|investment (proposal|opportunity)|loan offer|urgent (reply|response)|God bless|dear (friend|beloved)|percentage of the (fund|money)/i.test(msg)) { score += 4; reasons.push('scam_419'); }
  // 暗号資産・アダルト・薬
  if (/bitcoin|crypto|forex|casino|viagra|cialis|porn|escort|adult site/i.test(msg + ' ' + email)) { score += 4; reasons.push('crypto_adult'); }
  // ランダム英字の名前 (母音が異常に少ない or 大文字が不規則に混在)
  var flat = name.replace(/\s/g, '');
  if (/^[A-Za-z]{8,}$/.test(flat)) {
    var vowels = (flat.match(/[aeiouAEIOU]/g) || []).length;
    var midCaps = (flat.slice(1).match(/[A-Z]/g) || []).length;
    if (vowels / flat.length < 0.25 || midCaps >= 3) { score += 3; reasons.push('random_name'); }
  }
  // 日本語向けフォーム経由なのに日本語が1文字も無い
  var hasJa = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(msg);
  var fromJaForm = String(body.source || 'contact.html').indexOf('contact') >= 0 && body.inquiry_type !== 'export';
  if (fromJaForm && msg && !hasJa) { score += 2; reasons.push('no_japanese'); }
  var verdict = score >= 6 ? 'spam' : (score >= 3 ? 'suspicious' : 'clean');
  var foreign = (msg && !hasJa) || (body.country && !/japan|日本|^jp$/i.test(String(body.country)));
  return { score: score, verdict: verdict, reasons: reasons, foreign: !!foreign };
}

function submitInquiry(body) {
  if (!body || !body.name || !body.email) {
    return jsonResponse({ ok: false, error: 'name と email は必須です' });
  }
  var judge = classifyInquiry_(body);
  try { log('inquiry_classified', { verdict: judge.verdict, score: judge.score, reasons: judge.reasons.join(','), email: body.email }); } catch (e) {}
  // 1. Inquiries シートに行追加 (なければ作成) — spam も記録は残す (誤判定の救済用)
  try {
    var sheet = getSheet('Inquiries') || getSheet('inquiries');
    if (!sheet) {
      // 自動作成
      var ssId = (typeof PROPS !== 'undefined' && PROPS.getProperty)
                   ? PROPS.getProperty('SPREADSHEET_ID') : null;
      if (ssId) {
        var ss = SpreadsheetApp.openById(ssId);
        sheet = ss.insertSheet('Inquiries');
        sheet.appendRow([
          'timestamp','inquiry_type','name','company','title','email','phone',
          'country','city','message','source','referrer','status'
        ]);
      }
    }
    if (sheet) {
      sheet.appendRow([
        new Date(), body.inquiry_type || 'general',
        body.name, body.company || '', body.title || '',
        body.email, body.phone || '', body.country || '', body.city || '',
        body.message || '', body.source || 'contact.html',
        body.page_referrer || '',
        judge.verdict === 'spam' ? 'spam(' + judge.score + ':' + judge.reasons.join(',') + ')'
          : judge.verdict === 'suspicious' ? 'review(' + judge.score + ':' + judge.reasons.join(',') + ')'
          : 'new'
      ]);
    }
  } catch (sheetErr) {
    log('submit_inquiry_sheet_error', { error: sheetErr.message });
  }

  // spam 確定: メール通知も自動返信も送らない (bot に成功を装って終了)
  if (judge.verdict === 'spam') {
    return jsonResponse({ ok: true });
  }

  // 2. Tom にメール通知
  try {
    var typeLabel = {
      general: '一般', wholesale: '卸売(B2B)', export: '海外バイヤー',
      press: 'プレス/取材', investor: '投資家',
      career: '採用', organic: 'Organic Wagyu', partnership: 'パートナーシップ'
    }[body.inquiry_type] || body.inquiry_type || '一般';

    var prefix = judge.verdict === 'suspicious' ? '【⚠️要注意(営業/詐欺の可能性)】'
               : judge.foreign ? '【海外】' : '';
    var subject = prefix + '【お問い合わせ】' + typeLabel + ' / ' + (body.company || body.name) + ' — ' + body.name;

    var warnBanner = judge.verdict === 'suspicious'
      ? '<div style="background:#FDECEA;border:2px solid #C0392B;border-radius:8px;padding:14px 16px;margin:0 0 4px;font-size:13px;color:#7B241C;">'
        + '⚠️ <strong>自動判定: 営業スパム/詐欺の可能性 (スコア ' + judge.score + ' — ' + judge.reasons.join(', ') + ')</strong><br/>'
        + 'メール内リンクは開かない・返信前に会社の実在(法人番号/公式サイト/電話)を確認してください。</div>'
      : '';

    var securityFooter =
      '<div style="margin-top:20px;padding:12px 16px;background:#F4F1EA;border-radius:8px;font-size:11px;color:#6B5E4A;line-height:1.7;">'
      + '🛡 <strong>セキュリティ注意（全問い合わせ共通）</strong>: 本文中のリンクは直接開かない ／ 支払・口座・パスワード情報は返信で送らない ／ '
      + '取引・取材の提案は、相手ドメイン・法人実在・代表電話を確認してから対応する。</div>';

    var html = [
      '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">',
      '<div style="background:#0F3D2E;color:#D4A93B;padding:24px 32px;">',
      '<h2 style="margin:0;font-size:18px;">新規お問い合わせ</h2>',
      '<p style="margin:6px 0 0;font-size:12px;color:rgba(255,229,148,0.7);">[' + typeLabel + ']</p>',
      '</div>',
      '<div style="padding:28px 32px;background:#FAF7F0;">',
      warnBanner,
      '<table style="width:100%;border-collapse:collapse;font-size:14px;">',
      tableRow('お名前', body.name),
      tableRow('会社', body.company),
      tableRow('役職', body.title),
      tableRow('Email', '<a href="mailto:' + body.email + '">' + body.email + '</a>'),
      tableRow('Phone', body.phone),
      tableRow('国/都市', (body.country || '') + ' ' + (body.city || '')),
      '</table>',
      body.message ? '<div style="margin-top:24px;padding:16px;background:white;border-left:3px solid #D4A93B;"><strong>Message:</strong><br/>' + String(body.message).replace(/\n/g,'<br/>') + '</div>' : '',
      '<div style="margin-top:24px;padding:16px;background:rgba(212,169,59,0.10);border-radius:8px;font-size:12px;color:#5C4A1F;">',
      '💡 <strong>Action:</strong> 24時間以内に返信。卸売/海外バイヤーは Calendar で 30分商談を提案してください。<br/>',
      '<a href="https://calendar.app.google/DjKHsVDhJHesaPM27" style="color:#0F3D2E;">予約ページ</a>',
      '</div>',
      securityFooter,
      '</div></div>'
    ].join('');
    MailApp.sendEmail({
      to: 'tomoki@eda-livestock.com',
      subject: subject,
      htmlBody: html,
      replyTo: body.email
    });
  } catch (mailErr) {
    log('submit_inquiry_mail_error', { error: mailErr.message });
  }

  // 3. 顧客に自動返信
  try {
    var isJP = !body.country || /Japan|日本|JP/i.test(body.country || '');
    var replySubject = isJP
      ? '【江田畜産】お問い合わせを受け付けました'
      : 'Eda Livestock — We received your inquiry';
    var replyHtml = isJP
      ? '<p>' + body.name + ' 様</p><p>お問い合わせありがとうございます。24〜48時間以内にご返信いたします。</p>'
        + '<p>お急ぎの場合、Tomoki Eda と直接 30 分のオンライン商談予約も可能です:<br/>'
        + '<a href="https://calendar.app.google/DjKHsVDhJHesaPM27">https://calendar.app.google/DjKHsVDhJHesaPM27</a></p>'
        + '<p>江田畜産株式会社<br/>backoffice@eda-livestock.com</p>'
      : '<p>Dear ' + body.name + ',</p><p>Thank you for your inquiry. We will get back to you within 24–48 hours.</p>'
        + '<p>For urgent matters, you can book a direct 30-min call with Tomoki Eda:<br/>'
        + '<a href="https://calendar.app.google/DjKHsVDhJHesaPM27">https://calendar.app.google/DjKHsVDhJHesaPM27</a></p>'
        + '<p>Eda Livestock Co., Ltd.<br/>backoffice@eda-livestock.com</p>';
    MailApp.sendEmail({
      to: body.email,
      subject: replySubject,
      htmlBody: replyHtml,
      name: '江田畜産 / Eda Livestock',
      replyTo: 'backoffice@eda-livestock.com'
    });
  } catch (replyErr) {
    log('submit_inquiry_autoreply_error', { error: replyErr.message });
  }

  return jsonResponse({ ok: true });
}
function tableRow(label, value) {
  if (!value && value !== 0) value = '—';
  return '<tr><td style="padding:8px 12px;font-weight:bold;width:120px;border-bottom:1px solid #EFE8D7;">'
       + label + '</td><td style="padding:8px 12px;border-bottom:1px solid #EFE8D7;">' + value + '</td></tr>';
}

/* ※ staffAnalytics() は Code.gs に既存実装あり。重複定義しない。 */
