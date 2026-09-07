/**
 * ============================================================
 *  初回お届けの1週間後に「ご感想を聞く」1通
 *  2026-09-03 田崎さん指示 / 既存関数(cfg, sheet, log, sendLinePush,
 *                brandEmailHtml_, lastDeliveryDayNum_, _jstDayNum,
 *                repeatShipPaidOrderCount_, rsr_md_, rsr_limitDays_) を流用
 * ------------------------------------------------------------
 *  何をするか:
 *   - 「1回しか買っていない人」の前回お届けから 7 日経ったら、感想をたずねる1通だけ送る。
 *   - LINE連携済み(orders の line_uid あり)なら LINE、無ければメール。
 *   - 10 日を過ぎた人には送らない（「先日お届けした」が嘘になるので）。
 *
 *  目的は「返信をもらうこと」。特典の告知は最後の1行だけに置く（2026-09-03 田崎さん指示）。
 *  ⚠️ 文面は田崎さんが書いたもの。勝手に直さない。
 *
 *  なぜ「1回しか買っていない人」だけか:
 *   1→2回目で101人落ちるのが最大の穴（[[eda-reward-ladder]]）。
 *   2回目以降の人に「先日お届けした」と送ると、どの注文の話か分からなくなる。
 *
 *  安全設計:
 *   - 実送信は FIRST_FOLLOWUP_ENABLED === 'true' のときだけ。既定 false。
 *   - runFirstFollowupDry() はいつでも安全（送らず候補一覧をシートに出すだけ）。
 *   - 送信済みは「初回フォロー_送信ログ」シートで冪等。同じ人へ二度送らない。
 *   - 窓は 7〜10 日。窓を広げると過去のお客様全員に一斉に飛ぶので広げないこと。
 *
 *  Script Properties (任意・未設定なら既定値):
 *    FIRST_FOLLOWUP_ENABLED   実送信ON/OFF        （既定 'false'）
 *    FIRST_FOLLOWUP_DAYS      何日目に送るか       （既定 7）
 *    FIRST_FOLLOWUP_WINDOW    何日目まで送るか     （既定 10）
 *    FIRST_FOLLOWUP_LINK_URL  LINE連携の案内先     （既定 line-link.html）
 * ============================================================ */

var FDF_LOG_SHEET  = '初回フォロー_送信ログ';
var FDF_CAND_SHEET = '初回フォロー_候補';
var FDF_HEADERS    = ['sent_at', 'email', 'line_uid', 'name', 'channel', '経過日数', '半額期限'];

function fdf_num_(key, def) { var v = cfg(key); v = (v === '' || v == null) ? null : Number(v); return (v == null || isNaN(v)) ? def : v; }
function fdf_enabled_()  { return String(cfg('FIRST_FOLLOWUP_ENABLED', 'false')) === 'true'; }
function fdf_days_()     { return fdf_num_('FIRST_FOLLOWUP_DAYS', 7); }
function fdf_window_()   { return fdf_num_('FIRST_FOLLOWUP_WINDOW', 10); }
function fdf_linkUrl_()  { return String(cfg('FIRST_FOLLOWUP_LINK_URL', '') || 'https://www.eda-livestock.com/line-link.html'); }

/* 手で叩くスイッチ */
function setFirstFollowupOn()  { PropertiesService.getScriptProperties().setProperty('FIRST_FOLLOWUP_ENABLED', 'true');  return 'FIRST_FOLLOWUP_ENABLED=true'; }
function setFirstFollowupOff() { PropertiesService.getScriptProperties().setProperty('FIRST_FOLLOWUP_ENABLED', 'false'); return 'FIRST_FOLLOWUP_ENABLED=false'; }

function runFirstFollowupDry()  { return firstDeliveryFollowup_('dry');  }   // 送らない。候補だけシートに出す
function runFirstFollowupLive() { return firstDeliveryFollowup_('live'); }   // 実送信（ENABLED=true 必須）

function installFirstFollowupTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runFirstFollowupLive'; });
  if (!has) ScriptApp.newTrigger('runFirstFollowupLive').timeBased().everyDays(1).atHour(11).create();
  return { ok: true, created: !has };
}

/* ============================================================
   本体
   ============================================================ */
function firstDeliveryFollowup_(mode) {
  var live = (mode === 'live');
  var today = _jstDayNum(new Date());
  var sendAt = fdf_days_();
  var win = fdf_window_();

  /* orders は1回だけ読む（RepeatShipReminder と同じ理由） */
  _RSR_ORDER_ROWS = null;
  var rows = rsr_orderRows_();
  if (rows.length < 2) return { ok: true, candidates: 0, sent: 0, note: 'orders が空' };
  var h = rows[0];
  var iMail = h.indexOf('customer_email');
  var iUid  = h.indexOf('line_uid');
  var iName = h.indexOf('customer_name');

  /* 1) メールアドレス単位に顧客をまとめる */
  var people = {};
  for (var r = 1; r < rows.length; r++) {
    var em = iMail >= 0 ? String(rows[r][iMail] || '').trim().toLowerCase() : '';
    if (!em) continue;
    if (em.indexOf('@eda-livestock.com') >= 0) continue;              // 社内テストは除外
    if (!people[em]) people[em] = { email: em, uid: '', name: '' };
    if (!people[em].uid  && iUid  >= 0) people[em].uid  = String(rows[r][iUid]  || '').trim();
    if (!people[em].name && iName >= 0) people[em].name = String(rows[r][iName] || '').trim();
  }

  /* 2) 「1回だけ買って、前回お届けから7〜10日」を抽出 */
  var sent = fdf_readSentLog_();
  var cands = [];
  Object.keys(people).forEach(function (em) {
    var p = people[em];
    if (sent[em]) return;                                             // 1人1回だけ
    if (repeatShipPaidOrderCount_(p.email, p.uid) !== 1) return;       // 初回のお客様だけ
    var last = lastDeliveryDayNum_(p.email, p.uid);
    if (last === null) return;
    var days = today - last;
    if (days < sendAt || days > win) return;                          // 7日前・10日超は送らない
    p.days = days;
    p.halfDeadline = last + rsr_limitDays_();                          // 送料半額の期限（前回お届け+40日）
    p.channel = p.uid ? 'LINE' : 'メール';
    cands.push(p);
  });

  /* 3) ドライランは候補を書き出して終わり */
  if (!live) {
    fdf_writeCandidates_(cands);
    return { ok: true, mode: 'dry', candidates: cands.length, note: '送信していません。「' + FDF_CAND_SHEET + '」を確認してください' };
  }
  if (!fdf_enabled_()) {
    return { ok: false, mode: 'live', candidates: cands.length, sent: 0,
             note: 'FIRST_FOLLOWUP_ENABLED が true ではないので送信していません（setFirstFollowupOn を実行）' };
  }

  /* 4) 送る */
  var ok = 0, ng = 0;
  cands.forEach(function (p) {
    var done = false;
    try {
      done = p.uid ? fdf_sendLine_(p) : fdf_sendMail_(p);
    } catch (e) {
      log('first_followup_error', { email: p.email, error: e.message });
    }
    if (done) { ok++; fdf_appendSentLog_(p); } else { ng++; }
  });
  log('first_followup', { candidates: cands.length, sent: ok, failed: ng });
  return { ok: true, mode: 'live', candidates: cands.length, sent: ok, failed: ng };
}

/* ============================================================
   送信（LINE / メール）
   ⚠️ 文面は田崎さんが書いたもの。設問は1つだけ。返信をもらうのが目的。
   ============================================================ */
function fdf_sendLine_(p) {
  var text =
    (p.name ? p.name + ' 様\n' : '') +
    '先日お届けした江田和牛、お楽しみいただけましたでしょうか。\n\n' +
    'パックについて、量のこと（もっと少なく、多くなど）など、ご感想を聞かせていただけると嬉しいです。\n' +
    '今後のサービスに反映したいと思っております。\n\n' +
    '江田畜産　農場長　田崎\n' +
    '（次回のご注文が送料半額になる期限は ' + rsr_md_(p.halfDeadline) + 'です）';
  return sendLinePush(p.uid, [{ type: 'text', text: text }]);
}

function fdf_sendMail_(p) {
  var greeting = p.name ? (p.name + ' 様') : 'お客様';
  var deadline = rsr_md_(p.halfDeadline);
  /* メールの方は LINE 未連携の方なので、連携のご案内を1ブロックだけ足す（2026-09-03 田崎さん指示） */
  var lineIntroText =
    '▼公式LINEでもお受けしています\n' +
    '公式LINEとつないでいただくと、ご感想やご相談をトークからそのままお送りいただけます。\n' +
    'ご案内もLINEに届くようになります。\n' + fdf_linkUrl_();
  MailApp.sendEmail({
    to: p.email,
    name: BRAND_MAIL.sender,
    subject: '先日お届けした江田和牛はいかがでしたか｜江田畜産',
    body:
      greeting + '\n' +
      '先日お届けした江田和牛、お楽しみいただけましたでしょうか。\n\n' +
      'パックについて、量のこと（もっと少なく、多くなど）など、ご感想を聞かせていただけると嬉しいです。\n' +
      '今後のサービスに反映したいと思っております。\n' +
      'このメールにそのままご返信いただけます。\n\n' +
      '江田畜産　農場長　田崎\n' +
      '（次回のご注文が送料半額になる期限は ' + deadline + 'です）\n\n' +
      lineIntroText + '\n\n' +
      '江田畜産株式会社 / backoffice@eda-livestock.com\n' +
      'https://www.eda-livestock.com/',
    htmlBody: brandEmailHtml_({
      heroUrl: BRAND_MAIL.heroOrder,
      title: '先日の江田和牛はいかがでしたか',
      intro: greeting + '<br>先日お届けした江田和牛、お楽しみいただけましたでしょうか。<br><br>' +
             'パックについて、量のこと（もっと少なく、多くなど）など、ご感想を聞かせていただけると嬉しいです。' +
             '今後のサービスに反映したいと思っております。<br>このメールにそのままご返信いただけます。<br><br>' +
             '江田畜産　農場長　田崎',
      rows: [
        ['次回のご注文が送料半額になる期限', deadline]
      ],
      ctaLabel: '公式LINEとつなぐ',
      ctaUrl: fdf_linkUrl_(),
      note: '※ 公式LINEとつないでいただくと、ご感想やご相談をトークからそのままお送りいただけます。<br>※ 送料半額はクーポン不要・ご注文時に自動で半額になります（定期便は対象外）。'
    })
  });
  return true;
}

/* ============================================================
   ログ（冪等の担保）
   ============================================================ */
function fdf_readSentLog_() {
  var sh = sheet(FDF_LOG_SHEET, FDF_HEADERS);
  var rows = sh.getDataRange().getValues();
  var map = {};
  for (var r = 1; r < rows.length; r++) {
    var em = String(rows[r][1] || '').trim().toLowerCase();
    if (em) map[em] = true;
  }
  return map;
}

function fdf_appendSentLog_(p) {
  sheet(FDF_LOG_SHEET, FDF_HEADERS)
    .appendRow([rsr_stamp_(new Date()), p.email, p.uid || '', p.name || '', p.channel, p.days, rsr_md_(p.halfDeadline)]);
}

function fdf_writeCandidates_(cands) {
  var head = ['作成', 'email', 'line_uid', 'name', '送る手段', '経過日数', '半額期限'];
  var sh = sheet(FDF_CAND_SHEET, head);
  sh.clear();
  sh.appendRow(head);
  var now = rsr_stamp_(new Date());
  cands.forEach(function (p) {
    sh.appendRow([now, p.email, p.uid || '', p.name || '', p.channel, p.days, rsr_md_(p.halfDeadline)]);
  });
}
