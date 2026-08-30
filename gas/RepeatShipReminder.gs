/**
 * ============================================================
 *  送料半額（2回目のご注文特典）の期限リマインド
 *  2026-08-26 追加 / 自己完結・既存関数(cfg, sheet, log, sendLinePush,
 *                    brandEmailHtml_, lastDeliveryDayNum_, _jstDayNum) を流用
 * ------------------------------------------------------------
 *  何をするか:
 *   - 「1回しか買っていない人」の前回お届けから 30 日経ったら、期限のお知らせを1通だけ送る。
 *   - LINE連携済み(orders の line_uid あり)なら LINE、無ければメール。
 *   - 40 日を過ぎた人には送らない（もう失効しているので、案内すると嘘になる）。
 *
 *  なぜ「1回しか買っていない人」だけか:
 *   送料半額は 2回目のご注文だけの特典（2026-08-26 田崎さん決定）。
 *   請求側の判定 isRepeatShipHalf_ も同じ repeatShipPaidOrderCount_ を見ている＝
 *   「通知が来たのに半額にならない」「半額なのに通知が来ない」が構造的に起きない。
 *
 *  安全設計:
 *   - 実送信は REPEAT_SHIP_REMIND_ENABLED === 'true' のときだけ。既定 false。
 *   - runRepeatShipRemindDry() はいつでも安全（送らず候補一覧をシートに出すだけ）。
 *   - 送信済みは「送料半額_通知ログ」シートで冪等。同じ人へ二度送らない。
 *
 *  Script Properties（任意・未設定なら既定値）:
 *   REPEAT_SHIP_REMIND_ENABLED  実送信ON/OFF     （既定 'false'）
 *   REPEAT_SHIP_REMIND_DAYS     何日目に送るか    （既定 30）
 *   REPEAT_SHIP_DAYS            半額の期限(日)    （既定 40・Code.js と共有）
 *   REPEAT_SHIP_REMIND_URL      誘導先URL         （既定 shop.html）
 * ============================================================ */

var RSR_LOG_SHEET  = '送料半額_通知ログ';
var RSR_CAND_SHEET = '送料半額_通知候補';

function rsr_num_(key, def) { var v = cfg(key); v = (v === '' || v == null) ? null : Number(v); return (v == null || isNaN(v)) ? def : v; }
function rsr_enabled_()     { return String(cfg('REPEAT_SHIP_REMIND_ENABLED', 'false')) === 'true'; }
function rsr_remindDays_()  { return rsr_num_('REPEAT_SHIP_REMIND_DAYS', 30); }
function rsr_limitDays_()   { return rsr_num_('REPEAT_SHIP_DAYS', 40); }
function rsr_url_()         { return String(cfg('REPEAT_SHIP_REMIND_URL', '') || 'https://www.eda-livestock.com/shop.html'); }
function rsr_stamp_(d)      { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'); }
function rsr_dayToDate_(n)  { return new Date(n * 86400000 - 9 * 3600000); }
function rsr_md_(n)         { var d = rsr_dayToDate_(n); return Utilities.formatDate(d, 'Asia/Tokyo', 'M月d日'); }

/* ---- 本番ON/OFF（エディタから手で実行する）---- */
function setRepeatShipRemindOn()  { PropertiesService.getScriptProperties().setProperty('REPEAT_SHIP_REMIND_ENABLED', 'true');  return 'REPEAT_SHIP_REMIND_ENABLED=true'; }
function setRepeatShipRemindOff() { PropertiesService.getScriptProperties().setProperty('REPEAT_SHIP_REMIND_ENABLED', 'false'); return 'REPEAT_SHIP_REMIND_ENABLED=false'; }

/* ---- 送料半額そのもののON/OFF（Code.js の REPEAT_SHIP_HALF）---- */
function setRepeatShipHalfOn()  { PropertiesService.getScriptProperties().setProperty('REPEAT_SHIP_HALF', 'true');  return 'REPEAT_SHIP_HALF=true'; }
function setRepeatShipHalfOff() { PropertiesService.getScriptProperties().setProperty('REPEAT_SHIP_HALF', 'false'); return 'REPEAT_SHIP_HALF=false'; }

/* ---- 手動エントリポイント ---- */
function runRepeatShipRemindDry()  { return repeatShipRemind_('dry');  }   // 送らない。候補だけシートに出す
function runRepeatShipRemindLive() { return repeatShipRemind_('live'); }   // 実送信（ENABLED=true 必須）

/* ---- 日次トリガー設置（冪等・1回だけ実行）---- */
function installRepeatShipRemindTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runRepeatShipRemindLive'; });
  if (!has) ScriptApp.newTrigger('runRepeatShipRemindLive').timeBased().everyDays(1).atHour(10).create();
  return { ok: true, created: !has };
}

/* ============================================================
   顧客の「確定した単品注文」の件数。
   lastDeliveryDayNum_(Code.js) と同じ除外条件で数える＝定期便・未入金・
   キャンセル・失敗は数えない。ここがズレると請求と通知がズレる。
   ============================================================ */
/* orders は1回の実行の中で1度だけ読む。
   リマインドは全顧客ぶんこの関数を回すので、都度 getDataRange すると
   顧客数×シート読み込みになり実行時間の上限に当たる。 */
var _RSR_ORDER_ROWS = null;
function rsr_orderRows_() {
  if (_RSR_ORDER_ROWS === null) _RSR_ORDER_ROWS = sheet('orders').getDataRange().getValues();
  return _RSR_ORDER_ROWS;
}

function repeatShipPaidOrderCount_(email, lineUid) {
  var em  = String(email  || '').trim().toLowerCase();
  var uid = String(lineUid || '').trim();
  if (!em && !uid) return 0;
  var rows = rsr_orderRows_();
  if (rows.length < 2) return 0;
  var h = rows[0];
  var iMail = h.indexOf('customer_email');
  var iUid  = h.indexOf('line_uid');
  var iMode = h.indexOf('mode');
  var iPay  = h.indexOf('payment_status');
  var iNum  = h.indexOf('order_number');
  var seen = {}, n = 0;
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var mine = (em  && iMail >= 0 && String(row[iMail] || '').trim().toLowerCase() === em) ||
               (uid && iUid  >= 0 && String(row[iUid]  || '').trim() === uid);
    if (!mine) continue;
    if (iMode >= 0 && String(row[iMode] || '').indexOf('subscription') === 0) continue;
    if (iPay >= 0) {
      var st = String(row[iPay] || '').trim();
      if (st === 'awaiting_payment' || st === 'canceled' || st === 'failed') continue;
    }
    /* 同じ注文番号が2行あるケース（webhook と ありがとうページの二重記録）を1件に畳む */
    var key = iNum >= 0 ? String(row[iNum] || '').trim() : ('row' + r);
    if (key && seen[key]) continue;
    if (key) seen[key] = true;
    n++;
  }
  return n;
}

/* ============================================================
   本体
   ============================================================ */
function repeatShipRemind_(mode) {
  var live = (mode === 'live');
  var today = _jstDayNum(new Date());
  var remindAt = rsr_remindDays_();
  var limit = rsr_limitDays_();

  _RSR_ORDER_ROWS = null;                       // 実行のたびに読み直す（前回の残りを使わない）
  var rows = rsr_orderRows_();
  if (rows.length < 2) return { ok: true, candidates: 0, sent: 0, note: 'orders が空' };
  var h = rows[0];
  var iMail = h.indexOf('customer_email');
  var iUid  = h.indexOf('line_uid');
  var iName = h.indexOf('customer_name');

  /* 1) メールアドレス単位に顧客をまとめる（line_uid は1つでも入っていれば拾う） */
  var people = {};
  for (var r = 1; r < rows.length; r++) {
    var em = iMail >= 0 ? String(rows[r][iMail] || '').trim().toLowerCase() : '';
    if (!em) continue;
    if (em.indexOf('@eda-livestock.com') >= 0) continue;              // 社内テストは除外
    if (!people[em]) people[em] = { email: em, uid: '', name: '' };
    if (!people[em].uid  && iUid  >= 0) people[em].uid  = String(rows[r][iUid]  || '').trim();
    if (!people[em].name && iName >= 0) people[em].name = String(rows[r][iName] || '').trim();
  }

  /* 2) 「1回だけ買って、前回お届けからちょうど30日以上・40日以内」を抽出 */
  var sent = readSentLog_();
  var cands = [];
  Object.keys(people).forEach(function (em) {
    var p = people[em];
    if (sent[em]) return;                                             // 1人1回だけ
    if (repeatShipPaidOrderCount_(p.email, p.uid) !== 1) return;       // 2回目待ちの人だけ
    var last = lastDeliveryDayNum_(p.email, p.uid);
    if (last === null) return;
    var days = today - last;
    if (days < remindAt || days > limit) return;                      // 30日前・40日超は送らない
    p.days = days;
    p.deadline = last + limit;
    p.daysLeft = limit - days;
    p.channel = p.uid ? 'LINE' : 'メール';
    cands.push(p);
  });

  /* 3) ドライランは候補を書き出して終わり */
  if (!live) {
    writeCandidates_(cands);
    return { ok: true, mode: 'dry', candidates: cands.length, note: '送信していません。「' + RSR_CAND_SHEET + '」を確認してください' };
  }
  if (!rsr_enabled_()) {
    return { ok: false, mode: 'live', candidates: cands.length, sent: 0,
             note: 'REPEAT_SHIP_REMIND_ENABLED が true ではないので送信していません（setRepeatShipRemindOn を実行）' };
  }

  /* 4) 送る */
  var ok = 0, ng = 0;
  cands.forEach(function (p) {
    var done = false;
    try {
      done = p.uid ? sendRepeatShipLine_(p) : sendRepeatShipMail_(p);
    } catch (e) {
      log('repeat_ship_remind_error', { email: p.email, error: e.message });
    }
    if (done) { ok++; appendSentLog_(p); } else { ng++; }
  });
  log('repeat_ship_remind', { candidates: cands.length, sent: ok, failed: ng });
  return { ok: true, mode: 'live', candidates: cands.length, sent: ok, failed: ng };
}

/* ============================================================
   送信（LINE / メール）
   文面は「得（元値→今の値）／いつまで／何をする」の3つだけ。
   ============================================================ */
function sendRepeatShipLine_(p) {
  var text =
    (p.name ? p.name + ' 様\n\n' : '') +
    '2回目のご注文は送料が半額になります。\n' +
    '　送料 1,100円 → 550円\n' +
    '　（北海道・沖縄は 2,200円 → 1,100円）\n\n' +
    'お使いいただける期限：' + rsr_md_(p.deadline) + '（あと' + p.daysLeft + '日）\n' +
    'クーポンコードは要りません。ご注文時に自動で半額になります。\n\n' +
    '▼ご注文はこちら\n' + rsr_url_();
  return sendLinePush(p.uid, [{ type: 'text', text: text }]);
}

function sendRepeatShipMail_(p) {
  var greeting = p.name ? (p.name + ' 様') : 'お客様';
  var deadline = rsr_md_(p.deadline);
  MailApp.sendEmail({
    to: p.email,
    name: BRAND_MAIL.sender,
    subject: '【あと' + p.daysLeft + '日】2回目のご注文は送料半額です｜江田畜産',
    body:
      greeting + '\n\n' +
      '2回目のご注文は送料が半額になります。\n' +
      '  送料 1,100円 → 550円（北海道・沖縄は 2,200円 → 1,100円）\n\n' +
      'お使いいただける期限: ' + deadline + '（あと' + p.daysLeft + '日）\n' +
      'クーポンコードは要りません。ご注文時に自動で半額になります。\n\n' +
      '▼ご注文はこちら\n' + rsr_url_() + '\n\n' +
      '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
      'https://www.eda-livestock.com/',
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroShip,
      title: '2回目のご注文は送料半額です',
      intro: greeting + '<br>2回目のご注文は、送料が半額になります。',
      rows: [
        ['送料（通常配送）', '<span style="text-decoration:line-through;color:#9aa5a0;">1,100円</span>　550円'],
        ['送料（北海道・沖縄）', '<span style="text-decoration:line-through;color:#9aa5a0;">2,200円</span>　1,100円'],
        ['ご利用期限', deadline + '（あと' + p.daysLeft + '日）']
      ],
      ctaLabel: 'ご注文はこちら',
      ctaUrl: rsr_url_(),
      note: '※ クーポンコードは必要ありません。ご注文時に自動で半額になります。<br>※ 定期便のご注文は対象外です。'
    })
  });
  return true;
}

/* ============================================================
   ログ（冪等の担保）
   ============================================================ */
function readSentLog_() {
  var sh = sheet(RSR_LOG_SHEET, ['sent_at', 'email', 'line_uid', 'name', 'channel', '経過日数', '期限', '残り日数']);
  var rows = sh.getDataRange().getValues();
  var map = {};
  for (var r = 1; r < rows.length; r++) {
    var em = String(rows[r][1] || '').trim().toLowerCase();
    if (em) map[em] = true;
  }
  return map;
}

function appendSentLog_(p) {
  sheet(RSR_LOG_SHEET, ['sent_at', 'email', 'line_uid', 'name', 'channel', '経過日数', '期限', '残り日数'])
    .appendRow([rsr_stamp_(new Date()), p.email, p.uid || '', p.name || '', p.channel, p.days, rsr_md_(p.deadline), p.daysLeft]);
}

function writeCandidates_(cands) {
  var sh = sheet(RSR_CAND_SHEET, ['作成', 'email', 'line_uid', 'name', '送る手段', '経過日数', '期限', '残り日数']);
  sh.clear();
  sh.appendRow(['作成', 'email', 'line_uid', 'name', '送る手段', '経過日数', '期限', '残り日数']);
  var now = rsr_stamp_(new Date());
  cands.forEach(function (p) {
    sh.appendRow([now, p.email, p.uid || '', p.name || '', p.channel, p.days, rsr_md_(p.deadline), p.daysLeft]);
  });
}
