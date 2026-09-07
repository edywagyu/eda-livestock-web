/**
 * ============================================================
 *  🎂 お誕生日当日に「おめでとう」の1通
 *  2026-09-07 田崎さん指示 / 既存関数(cfg, sheet, log, sendLinePush,
 *                brandEmailHtml_, BRAND_MAIL, normBirthday_, rsr_stamp_) を流用
 * ------------------------------------------------------------
 *  何をするか:
 *   - 毎朝、その日が誕生日のお客様を customers の birthday(MM-DD) から拾って1通だけ送る。
 *   - LINE連携済み(customers の line_uid あり)なら LINE、無ければメール。
 *     ＝発送通知と同じ振り分け（2026-09-07 田崎さん指示）。
 *
 *  文面の中身:
 *   お祝いと、「お誕生日の月のご注文に赤身ステーキをお入れします」の2つだけ。
 *   単品の方と定期便の方で分けない（2026-09-07 田崎さん決定）。
 *   ⚠️ 文面は下の BG_TEXT ただ1つが正。直すときはここだけ。
 *
 *  同梱の条件（マイページ・管理画面と同じ。3箇所で食い違わせない）:
 *    単品   … ご自身の誕生日“月”にご注文があった分に同梱
 *    定期便 … 誕生日“月”のお届けに必ず同梱（ご注文の有無を問わない）
 *
 *  安全設計:
 *   - 実送信は BIRTHDAY_MSG_ENABLED === 'true' のときだけ。既定 false。
 *     ＝コードを本番に入れても、スイッチを入れるまで1通も飛ばない。
 *   - runBirthdayGreetingDry() はいつでも安全（送らず候補一覧をシートに出すだけ）。
 *   - 送信済みは「誕生日メッセージ_送信ログ」で冪等。同じ人に同じ年は二度送らない
 *     （トリガーが二重に走っても、手で回し直しても増えない）。
 *   - 2月29日生まれの方は、平年は2月28日に送る（その年に一度も送られないのを防ぐ）。
 *
 *  Script Properties (任意・未設定なら既定値):
 *    BIRTHDAY_MSG_ENABLED   実送信ON/OFF     （既定 'false'）
 *    BIRTHDAY_MSG_SHOP_URL  ご注文ページ      （既定 shop.html）
 *    BIRTHDAY_MSG_LINK_URL  LINE連携の案内先  （既定 line-link.html）
 * ============================================================ */

var BG_LOG_SHEET  = '誕生日メッセージ_送信ログ';
var BG_CAND_SHEET = '誕生日メッセージ_候補';
var BG_HEADERS    = ['sent_at', 'year', 'email', 'line_uid', 'name', 'birthday', 'channel'];

function bg_enabled_()  { return String(cfg('BIRTHDAY_MSG_ENABLED', 'false')) === 'true'; }
function bg_shopUrl_()  { return String(cfg('BIRTHDAY_MSG_SHOP_URL', '') || 'https://www.eda-livestock.com/shop.html'); }
function bg_linkUrl_()  { return String(cfg('BIRTHDAY_MSG_LINK_URL', '') || 'https://www.eda-livestock.com/line-link.html'); }

/* 手で叩くスイッチ */
function setBirthdayMsgOn()  { PropertiesService.getScriptProperties().setProperty('BIRTHDAY_MSG_ENABLED', 'true');  return 'BIRTHDAY_MSG_ENABLED=true'; }
function setBirthdayMsgOff() { PropertiesService.getScriptProperties().setProperty('BIRTHDAY_MSG_ENABLED', 'false'); return 'BIRTHDAY_MSG_ENABLED=false'; }

function runBirthdayGreetingDry()  { return birthdayGreeting_('dry');  }   // 送らない。候補だけシートに出す
function runBirthdayGreetingLive() { return birthdayGreeting_('live'); }   // 実送信（ENABLED=true 必須）

function installBirthdayGreetingTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runBirthdayGreetingLive'; });
  if (!has) ScriptApp.newTrigger('runBirthdayGreetingLive').timeBased().everyDays(1).atHour(9).create();
  return { ok: true, created: !has };
}

/* ============================================================
   きょう送る相手の「誕生日」の並び
   ふつうは今日1つだけ。平年の2月28日だけは 02-29 生まれの方も一緒に拾う。
   ============================================================ */
function bg_todayKeys_(now) {
  var today = Utilities.formatDate(now, 'Asia/Tokyo', 'MM-dd');
  var keys = [today];
  if (today === '02-28') {
    var y = Number(Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy'));
    var isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    if (!isLeap) keys.push('02-29');   /* 平年は2月29日生まれの方を28日にまとめる */
  }
  return keys;
}

/* ============================================================
   本体
   ============================================================ */
function birthdayGreeting_(mode) {
  var live = (mode === 'live');
  var now  = new Date();
  var year = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy');
  var keys = bg_todayKeys_(now);

  var sh = sheet('customers');
  var rows = sh.getDataRange().getValues();
  if (rows.length < 2) return { ok: true, candidates: 0, sent: 0, note: 'customers が空' };
  var h = rows[0];
  var iBday = h.indexOf('birthday');
  if (iBday === -1) return { ok: true, candidates: 0, sent: 0, note: 'customers に birthday 列がまだありません' };
  var iMail = h.indexOf('email'), iUid = h.indexOf('line_uid'), iName = h.indexOf('name');

  var sent = bg_readSentLog_(year);
  var cands = [];
  var seen = {};
  for (var r = 1; r < rows.length; r++) {
    var bd = normBirthday_(rows[r][iBday]);
    if (!bd || keys.indexOf(bd) === -1) continue;

    var em  = iMail >= 0 ? String(rows[r][iMail] || '').trim().toLowerCase() : '';
    var uid = iUid  >= 0 ? String(rows[r][iUid]  || '').trim() : '';
    if (!em && !uid) continue;                                    /* 連絡先がない行は送りようがない */
    if (em && em.indexOf('@eda-livestock.com') >= 0) continue;    /* 社内テストは除外 */

    var key = em || ('uid:' + uid);
    if (seen[key]) continue;                                      /* 同じ人が2行あっても1通 */
    seen[key] = true;
    if (sent[key]) continue;                                      /* 今年ぶんは送信済み */

    cands.push({
      key: key,
      email: em,
      uid: uid,
      name: iName >= 0 ? String(rows[r][iName] || '').trim() : '',
      birthday: bd,
      channel: uid ? 'LINE' : 'メール'
    });
  }

  /* ドライランは候補を書き出して終わり */
  if (!live) {
    bg_writeCandidates_(cands);
    return { ok: true, mode: 'dry', today: keys.join('/'), candidates: cands.length,
             note: '送信していません。「' + BG_CAND_SHEET + '」を確認してください' };
  }
  if (!bg_enabled_()) {
    return { ok: false, mode: 'live', today: keys.join('/'), candidates: cands.length, sent: 0,
             note: 'BIRTHDAY_MSG_ENABLED が true ではないので送信していません（setBirthdayMsgOn を実行）' };
  }

  var ok = 0, ng = 0;
  cands.forEach(function (p) {
    var done = false;
    try {
      done = p.uid ? bg_sendLine_(p) : bg_sendMail_(p);
      /* LINE が失敗したら（ブロック・連携切れ）メールに落とす。連絡先があるなら届けきる。 */
      if (!done && p.uid && p.email) { p.channel = 'メール(LINE失敗)'; done = bg_sendMail_(p); }
    } catch (e) {
      log('birthday_greeting_error', { key: p.key, error: e.message });
    }
    if (done) { ok++; bg_appendSentLog_(p, year); } else { ng++; }
  });
  log('birthday_greeting', { today: keys.join('/'), candidates: cands.length, sent: ok, failed: ng });
  return { ok: true, mode: 'live', today: keys.join('/'), candidates: cands.length, sent: ok, failed: ng };
}

/* ============================================================
   文面（🔴 ここだけが正。LINEもメールも同じことを言う）
   ============================================================ */
var BG_TEXT = {
  subject: 'お誕生日おめでとうございます｜江田畜産',
  line1:   'お誕生日おめでとうございます。',
  line2:   'いつも江田畜産をご利用いただき、ありがとうございます。',
  perk:    '今月中にご注文いただいた分に、お祝いとして「赤身ステーキ」をお入れします。\n' +
           '定期便をご利用の方は、今月のお届けに自動でお入れしますので、ご注文は要りません。',
  close:   '素敵な一年になりますように。',
  sign:    '江田畜産　農場長　田崎'
};

function bg_sendLine_(p) {
  var text =
    (p.name ? p.name + ' 様\n\n' : '') +
    BG_TEXT.line1 + '\n' +
    BG_TEXT.line2 + '\n\n' +
    BG_TEXT.perk + '\n\n' +
    BG_TEXT.close + '\n\n' +
    BG_TEXT.sign + '\n' +
    'ご注文はこちら ' + bg_shopUrl_();
  return sendLinePush(p.uid, [{ type: 'text', text: text }]);
}

function bg_sendMail_(p) {
  if (!p.email) return false;
  var greeting = p.name ? (p.name + ' 様') : 'お客様';
  /* メールで届く方は LINE 未連携なので、連携のご案内を1ブロックだけ足す（発送通知と同じ考え方） */
  var lineIntroText =
    '▼公式LINEでもお受けしています\n' +
    '公式LINEとつないでいただくと、ご案内がLINEに届くようになります。\n' + bg_linkUrl_();
  MailApp.sendEmail({
    to: p.email,
    name: BRAND_MAIL.sender,
    subject: BG_TEXT.subject,
    body:
      greeting + '\n\n' +
      BG_TEXT.line1 + '\n' +
      BG_TEXT.line2 + '\n\n' +
      BG_TEXT.perk + '\n\n' +
      BG_TEXT.close + '\n\n' +
      BG_TEXT.sign + '\n' +
      'ご注文はこちら ' + bg_shopUrl_() + '\n\n' +
      lineIntroText + '\n\n' +
      '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
      'https://www.eda-livestock.com/',
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroOrder,
      title: 'お誕生日おめでとうございます',
      intro: greeting + '<br><br>' + BG_TEXT.line1 + '<br>' + BG_TEXT.line2,
      boxText: BG_TEXT.perk.replace(/\n/g, '<br>'),
      ctaLabel: 'ご注文はこちら',
      ctaUrl: bg_shopUrl_(),
      note: BG_TEXT.close + '　' + BG_TEXT.sign +
            '<br>※ 公式LINEとつないでいただくと、ご案内がLINEに届くようになります。'
    })
  });
  return true;
}

/* ============================================================
   ログ（冪等の担保）— 「その人 × その年」で1回だけ
   ============================================================ */
function bg_readSentLog_(year) {
  var sh = sheet(BG_LOG_SHEET, BG_HEADERS);
  var rows = sh.getDataRange().getValues();
  var map = {};
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][1] || '') !== String(year)) continue;
    var em  = String(rows[r][2] || '').trim().toLowerCase();
    var uid = String(rows[r][3] || '').trim();
    var key = em || ('uid:' + uid);
    if (key && key !== 'uid:') map[key] = true;
  }
  return map;
}

function bg_appendSentLog_(p, year) {
  sheet(BG_LOG_SHEET, BG_HEADERS)
    .appendRow([rsr_stamp_(new Date()), year, p.email || '', p.uid || '', p.name || '', p.birthday, p.channel]);
}

function bg_writeCandidates_(cands) {
  var head = ['作成', 'email', 'line_uid', 'name', '誕生日', '送る手段'];
  var sh = sheet(BG_CAND_SHEET, head);
  sh.clear();
  sh.appendRow(head);
  var now = rsr_stamp_(new Date());
  cands.forEach(function (p) {
    sh.appendRow([now, p.email || '', p.uid || '', p.name || '', p.birthday, p.channel]);
  });
}
