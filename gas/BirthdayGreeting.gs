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
 *   お祝いと、赤身ステーキのご案内の2つだけ。
 *   🔴 定期便の方と単品の方で文面を分ける（2026-09-07 田崎さん指示）。
 *     ・定期便の方 … 「今月のお届けに入れます・お手続きは要りません」＝ご注文へ誘導しない
 *     ・単品の方   … 「今月中のご注文に入れます」＝ご注文への導線を出す
 *   ⚠️ 文面は下の BG_TEXT ただ1つが正。直すときはここだけ。
 *   （箱に入れる紙のお手紙 birthday-letter.html は共通1本のまま。こちらだけ分ける）
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
var BG_HEADERS    = ['sent_at', 'year', 'email', 'line_uid', 'name', 'birthday', 'channel', '区分'];

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
   定期便のお客様かどうか
   ------------------------------------------------------------
   文面を分けるためだけに使う（2026-09-07 田崎さん指示）。
   “正”が2つあるので両方を見て、どちらかに当たれば定期便とみなす:
     ①「定期便マスター」の 状態=有効 … 手管理の名簿でこれが正
        （WIX/Shopify 時代からのお客様は新ECの注文が無いのでここにしか居ない）
        照合はお名前。空白は詰めて比べる（SubscriptionMonthRows と同じやり方）
     ② orders に mode が subscription… のご注文がある … 新ECのお客様
        こちらはメール/line_uid で確実に照合できる
   🔴 外したときに困るのは「定期便の方に “ご注文ください” と送ってしまう」方なので、
      迷ったら定期便側（＝ご注文へ誘導しない方）に倒す作りにしている。
   ============================================================ */
function bg_normName_(v) { return String(v || '').replace(/[\s　]/g, ''); }

function bg_subscriberIndex_() {
  var out = { byEmail: {}, byUid: {}, byName: {} };

  /* ① 定期便マスター（手管理・状態=有効） */
  try {
    var ms = ss().getSheetByName('定期便マスター');
    if (ms) {
      var mv = ms.getDataRange().getValues();
      var MH = {};
      (mv[0] || []).forEach(function (h, i) { MH[String(h).trim()] = i; });
      if (MH['状態'] != null && MH['名前'] != null) {
        for (var r = 1; r < mv.length; r++) {
          if (String(mv[r][MH['状態']] || '').trim() !== '有効') continue;
          var nm = bg_normName_(mv[r][MH['名前']]);
          if (nm) out.byName[nm] = true;
        }
      }
    }
  } catch (e) { /* マスターが読めなくても②で拾う */ }

  /* ② orders に定期便のご注文がある */
  try {
    var os = sheet('orders');
    var ov = os.getDataRange().getValues();
    if (ov.length >= 2) {
      var h = ov[0];
      var iMode = h.indexOf('mode'), iMail = h.indexOf('customer_email'), iUid = h.indexOf('line_uid');
      if (iMode >= 0) {
        for (var r2 = 1; r2 < ov.length; r2++) {
          if (String(ov[r2][iMode] || '').indexOf('subscription') !== 0) continue;
          if (iMail >= 0 && ov[r2][iMail]) out.byEmail[custEmailKey_(ov[r2][iMail])] = true;
          if (iUid  >= 0 && ov[r2][iUid])  out.byUid[String(ov[r2][iUid]).trim()] = true;
        }
      }
    }
  } catch (e) { /* orders が読めなくても①で拾う */ }

  return out;
}

function bg_isSubscriber_(idx, p) {
  if (p.uid   && idx.byUid[p.uid]) return true;
  if (p.email && idx.byEmail[p.email]) return true;
  var nm = bg_normName_(p.name);
  return !!(nm && idx.byName[nm]);
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

  /* 文面の出し分け（定期便 / 単品）。候補が居るときだけ名簿を読む */
  if (cands.length) {
    var subIdx = bg_subscriberIndex_();
    cands.forEach(function (p) {
      p.isSub = bg_isSubscriber_(subIdx, p);
      p.kind  = p.isSub ? '定期便' : '単品';
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
   定期便の方と単品の方で分ける（2026-09-07 田崎さん指示）。
   ・定期便の方 … もう届くことが決まっているので、ご注文へ誘導しない
   ・単品の方   … 「今月中のご注文」が条件なので、ご注文への導線を出す
   ============================================================ */
var BG_TEXT = {
  subject: 'お誕生日おめでとうございます｜江田畜産',
  greet:   'お誕生日おめでとうございます。',
  close:   '素敵な一年になりますように。',
  sign:    '江田畜産　農場長　田崎',

  /* 定期便をご利用の方 */
  sub: {
    thanks: 'いつも定期便をご利用いただき、ありがとうございます。',
    perk:   '今月のお届けに、お祝いとして「赤身ステーキ」をお入れします。\n' +
            'お手続きは要りませんので、そのままお待ちください。',
    cta:    null   /* ご注文へは誘導しない */
  },

  /* 単品でお買い物の方 */
  single: {
    thanks: 'いつも江田畜産をご利用いただき、ありがとうございます。',
    perk:   '今月中にご注文いただいた分に、お祝いとして「赤身ステーキ」をお入れします。\n' +
            'お誕生日の月だけのお楽しみです。',
    cta:    'ご注文はこちら'
  }
};

function bg_copy_(p) { return p.isSub ? BG_TEXT.sub : BG_TEXT.single; }

function bg_sendLine_(p) {
  var c = bg_copy_(p);
  var text =
    (p.name ? p.name + ' 様\n\n' : '') +
    BG_TEXT.greet + '\n' +
    c.thanks + '\n\n' +
    c.perk + '\n\n' +
    BG_TEXT.close + '\n\n' +
    BG_TEXT.sign +
    (c.cta ? '\n' + c.cta + ' ' + bg_shopUrl_() : '');
  return sendLinePush(p.uid, [{ type: 'text', text: text }]);
}

function bg_sendMail_(p) {
  if (!p.email) return false;
  var c = bg_copy_(p);
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
      BG_TEXT.greet + '\n' +
      c.thanks + '\n\n' +
      c.perk + '\n\n' +
      BG_TEXT.close + '\n\n' +
      BG_TEXT.sign + '\n' +
      (c.cta ? c.cta + ' ' + bg_shopUrl_() + '\n\n' : '\n') +
      lineIntroText + '\n\n' +
      '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
      'https://www.eda-livestock.com/',
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroOrder,
      title: 'お誕生日おめでとうございます',
      intro: greeting + '<br><br>' + BG_TEXT.greet + '<br>' + c.thanks,
      boxText: c.perk.replace(/\n/g, '<br>'),
      ctaLabel: c.cta || '',
      ctaUrl:   c.cta ? bg_shopUrl_() : '',
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
    .appendRow([rsr_stamp_(new Date()), year, p.email || '', p.uid || '', p.name || '', p.birthday, p.channel, p.kind || '']);
}

function bg_writeCandidates_(cands) {
  var head = ['作成', 'email', 'line_uid', 'name', '誕生日', '送る手段', '区分'];
  var sh = sheet(BG_CAND_SHEET, head);
  sh.clear();
  sh.appendRow(head);
  var now = rsr_stamp_(new Date());
  cands.forEach(function (p) {
    sh.appendRow([now, p.email || '', p.uid || '', p.name || '', p.birthday, p.channel, p.kind || '']);
  });
}
