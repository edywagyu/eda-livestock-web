/**
 * ============================================================
 *  初回クーポン（10%OFF）の配布と「残り1日」リマインド
 *  2026-08-31 追加 / 自己完結・既存関数(cfg, sheet, log, sendLinePush,
 *                    publicPopular, repeatShipPaidOrderCount_, _jstDayNum) を流用
 * ------------------------------------------------------------
 *  何をするか（ジョブは2つ）:
 *   1) 配布       … LINE連携済みで一度も買っていない人へ「残り◯日」を1通送る
 *   2) リマインド … 締切の**前日だけ**「残り1日」をもう1通送る
 *   どちらも LINE の個別トークのみ（対象が line_uid を持つ人だけなので
 *   メール分岐は要らない）。本文末尾に送信時点の人気商品を上位N件並べる。
 *
 *  誰に送らないか（2026-08-31 田崎さん指定）:
 *   - 一度でも注文がある人。**定期便も注文に数える**。
 *     repeatShipPaidOrderCount_ は定期便を除いて数えるので、それだけに頼ると
 *     定期便のお客様が「未購入」に混ざる（松本様・大澤様・陳様で実際に発生）。
 *   - FIRST_COUPON_EXCLUDE に挙げた人（他カートの定期便・個別事情）。
 *
 *  なぜ「全員同じ締切日」か（2026-08-31 田崎さん決定）:
 *   いまの49人は連携から中央値36日が経っており、「連携日から7日」では
 *   全員が期限切れになる。そこで**今日を登録日とみなして**全員同じ締切に置く。
 *   Script Property に日付を1つ持つだけで済み、配布リストの管理が消える。
 *   ※これから連携する人を「連携日から7日」で回す恒常版は別途。
 *
 *  なぜリマインドは締切前日だけか:
 *   毎日走らせても、前日以外は候補0で即終了する。
 *   日次トリガーに置きっぱなしにできる＝実行日を人が覚えなくていい。
 *
 *  なぜ「買っていない人」を毎回数え直すか:
 *   配布後に買った人へ「残り1日」を送ると、買った直後に値引きを見せることになる。
 *   判定は請求と同じ repeatShipPaidOrderCount_ を使う＝数え方がズレない。
 *
 *  安全設計:
 *   - 実送信は FIRST_COUPON_SEND_ENABLED / FIRST_COUPON_REMIND_ENABLED が
 *     'true' のときだけ。どちらも既定 false。
 *   - *Dry() はいつでも安全（送らず候補一覧をシートに出すだけ）。
 *   - FIRST_COUPON_DEADLINE が未設定なら、live でも何もしない。
 *   - 送信済みはログシートで冪等。同じ人へ二度送らない（配布とリマインドで別ログ）。
 *
 *  Script Properties（任意・未設定なら既定値）:
 *   FIRST_COUPON_DEADLINE        締切日 'yyyy-MM-dd'    （未設定なら停止）
 *   FIRST_COUPON_SEND_ENABLED    配布の実送信ON/OFF      （既定 'false'）
 *   FIRST_COUPON_REMIND_ENABLED  リマインドの実送信ON/OFF（既定 'false'）
 *   FIRST_COUPON_CODE            クーポンコード          （既定 'LINE10'）
 *   FIRST_COUPON_URL             配布の誘導先URL         （既定 c.html 経由 msg=coupon0831）
 *   FIRST_COUPON_URL_REMIND      リマインドの誘導先URL   （既定 c.html 経由 msg=coupon_last1）
 *   FIRST_COUPON_POPULAR_N       人気商品を何件出すか    （既定 3）
 *   FIRST_COUPON_POPULAR_DAYS    人気の集計期間(日)      （既定 14）
 *   FIRST_COUPON_POPULAR_SINGLE  定期便/会員限定を除くか （既定 'true'）
 *   FIRST_COUPON_EXCLUDE         送らない人（line_uid か表示名をカンマ区切り）
 * ============================================================ */

var FCR_SEND_SHEET  = '初回クーポン_配布ログ';
var FCR_SCAND_SHEET = '初回クーポン_配布候補';
var FCR_LOG_SHEET   = '初回クーポン_通知ログ';
var FCR_CAND_SHEET  = '初回クーポン_通知候補';
var FCR_HEADERS     = ['sent_at', 'email', 'line_uid', 'name', 'クーポン', '締切', '人気商品'];

function fcr_num_(key, def) { var v = cfg(key); v = (v === '' || v == null) ? null : Number(v); return (v == null || isNaN(v)) ? def : v; }
function fcr_sendEnabled_()   { return String(cfg('FIRST_COUPON_SEND_ENABLED', 'false')) === 'true'; }
function fcr_remindEnabled_() { return String(cfg('FIRST_COUPON_REMIND_ENABLED', 'false')) === 'true'; }
function fcr_code_()      { return String(cfg('FIRST_COUPON_CODE', '') || 'LINE10'); }
function fcr_url_()       { return String(cfg('FIRST_COUPON_URL', '') || 'https://www.eda-livestock.com/c.html?to=https%3A%2F%2Fwww.eda-livestock.com%2Fshop.html&msg=coupon0831&l=shop'); }
function fcr_urlRemind_() { return String(cfg('FIRST_COUPON_URL_REMIND', '') || 'https://www.eda-livestock.com/c.html?to=https%3A%2F%2Fwww.eda-livestock.com%2Fshop.html&msg=coupon_last1&l=shop'); }
function fcr_topN_()      { return fcr_num_('FIRST_COUPON_POPULAR_N', 3); }
function fcr_popDays_()   { return fcr_num_('FIRST_COUPON_POPULAR_DAYS', 14); }
function fcr_single_()    { return String(cfg('FIRST_COUPON_POPULAR_SINGLE', 'true')) !== 'false'; }
function fcr_stamp_(d)    { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'); }
function fcr_nz_(s)       { return String(s == null ? '' : s).replace(/[\s\u3000]/g, '').toLowerCase(); }

/* 送らない人。line_uid でも表示名でも書ける（uid が分からなくても運用で止められる）。 */
function fcr_excluded_() {
  var raw = String(cfg('FIRST_COUPON_EXCLUDE', '') || '');
  var map = {};
  raw.split(',').forEach(function (v) { var k = fcr_nz_(v); if (k) map[k] = true; });
  return map;
}

/* 一度でも注文があるか。定期便も「買った」に数える（初回クーポンの対象外にする）。 */
function fcr_hasAnyOrder_(email, uid) {
  if (repeatShipPaidOrderCount_(email, uid) > 0) return true;      // 単品の確定注文
  var em = fcr_nz_(email), ud = String(uid || '').trim();
  if (!em && !ud) return false;
  var d = sheet('orders').getDataRange().getValues();
  if (d.length < 2) return false;
  var h = d[0];
  var iE = h.indexOf('customer_email'), iU = h.indexOf('line_uid'),
      iM = h.indexOf('mode'), iS = h.indexOf('payment_status'), iP = h.indexOf('placed_at');
  for (var r = 1; r < d.length; r++) {
    if (iP >= 0 && !d[r][iP]) continue;
    if (iM < 0 || String(d[r][iM] || '').indexOf('subscription') !== 0) continue;  // ここでは定期便だけ見る
    var st = String((iS >= 0 ? d[r][iS] : 'paid') || '').toLowerCase();
    if (st === 'awaiting_payment' || st === 'canceled' || st === 'failed') continue;
    if (em && iE >= 0 && fcr_nz_(d[r][iE]) === em) return true;
    if (ud && iU >= 0 && String(d[r][iU] || '').trim() === ud) return true;
  }
  return false;
}

/* 締切日。'yyyy-MM-dd' → 日番号。未設定/壊れていれば null（＝何もしない）。 */
function fcr_deadlineDayNum_() {
  var s = String(cfg('FIRST_COUPON_DEADLINE', '') || '').trim();
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return null;
  var p = s.split('-');
  return _jstDayNum(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
var FCR_WDAY = { Sun: '日', Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土' };
function fcr_md_(n) {
  var d = new Date(n * 86400000 - 9 * 3600000);
  var w = FCR_WDAY[Utilities.formatDate(d, 'Asia/Tokyo', 'EEE')] || '';
  return Utilities.formatDate(d, 'Asia/Tokyo', 'M月d日') + '(' + w + ')';
}

/* ---- 本番ON/OFF（エディタから手で実行する）---- */
function setFirstCouponSendOn()    { PropertiesService.getScriptProperties().setProperty('FIRST_COUPON_SEND_ENABLED', 'true');    return 'FIRST_COUPON_SEND_ENABLED=true'; }
function setFirstCouponSendOff()   { PropertiesService.getScriptProperties().setProperty('FIRST_COUPON_SEND_ENABLED', 'false');   return 'FIRST_COUPON_SEND_ENABLED=false'; }
function setFirstCouponRemindOn()  { PropertiesService.getScriptProperties().setProperty('FIRST_COUPON_REMIND_ENABLED', 'true');  return 'FIRST_COUPON_REMIND_ENABLED=true'; }
function setFirstCouponRemindOff() { PropertiesService.getScriptProperties().setProperty('FIRST_COUPON_REMIND_ENABLED', 'false'); return 'FIRST_COUPON_REMIND_ENABLED=false'; }

/* ---- 締切日をセットする（'2026-09-07' のように渡す）---- */
function setFirstCouponDeadline(ymd) {
  var s = String(ymd || '').trim();
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) throw new Error('日付は yyyy-MM-dd で渡してください（例 2026-09-07）');
  PropertiesService.getScriptProperties().setProperty('FIRST_COUPON_DEADLINE', s);
  return 'FIRST_COUPON_DEADLINE=' + s + ' / リマインドは ' + fcr_md_(fcr_deadlineDayNum_() - 1) + ' に送られます';
}

/* ---- 手動エントリポイント ---- */
function runFirstCouponAnnounceDry()  { return firstCouponJob_('announce', 'dry');  }
function runFirstCouponAnnounceLive() { return firstCouponJob_('announce', 'live'); }
function runFirstCouponRemindDry()    { return firstCouponJob_('remind',   'dry');  }
function runFirstCouponRemindLive()   { return firstCouponJob_('remind',   'live'); }

/* ---- 配布を一度だけ予約する。例: scheduleFirstCouponAnnounce('2026-08-31 18:35') ---- */
function scheduleFirstCouponAnnounce(ymdHm) {
  var m = String(ymdHm || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) throw new Error("日時は 'yyyy-MM-dd HH:mm' で渡してください（例 2026-08-31 18:35）");
  var at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (at.getTime() <= Date.now()) throw new Error('過去の日時は指定できません');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runFirstCouponAnnounceLive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runFirstCouponAnnounceLive').timeBased().at(at).create();
  return '配布を ' + Utilities.formatDate(at, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + ' に予約しました';
}

/* ---- リマインドの日次トリガー設置（冪等・1回だけ実行）---- */
function installFirstCouponRemindTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runFirstCouponRemindLive'; });
  if (!has) ScriptApp.newTrigger('runFirstCouponRemindLive').timeBased().everyDays(1).atHour(18).create();
  return { ok: true, created: !has };
}

/* ============================================================
   人気商品
   publicPopular は TextOutput を返す公開APIなので、中身を取り出して使う。
   ランキングの作り方（購入×3 + カート×2 / 1時間キャッシュ）を二重に書かない。
   ============================================================ */
function fcr_popularNames_() {
  var n = fcr_topN_();
  if (!(n > 0)) return [];
  var data = null;
  try { data = JSON.parse(publicPopular({ days: String(fcr_popDays_()) }).getContent()); }
  catch (e) { log('first_coupon_popular_error', { error: String(e) }); return []; }
  var list = (data && data.ranking) || [];
  if (fcr_single_()) {
    /* 定期便とLINE会員限定は「今すぐ誰でも買える単品」ではないので、
       おすすめとして並べると押した先で買えず離脱する。 */
    list = list.filter(function (r) {
      var nm = String(r.name || '');
      return nm.indexOf('定期便') < 0 && nm.indexOf('会員限定') < 0;
    });
  }
  return list.slice(0, n).map(function (r) { return String(r.name || ''); }).filter(Boolean);
}

/* ============================================================
   対象者（配布・リマインドで共通）
   LINE連携済み × まだ一度も買っていない × そのジョブで未送信。
   まだ買っていない人は orders に居ないので customers から拾う。
   ============================================================ */
function fcr_candidates_(sentMap) {
  var cd = sheet('customers').getDataRange().getValues();
  if (cd.length < 2) return { error: 'customers が空', list: [] };
  var ch = cd[0];
  var iMail = ch.indexOf('email');
  var iName = ch.indexOf('name');
  var iUid  = ch.indexOf('line_uid');
  var iLnm  = ch.indexOf('line_name');
  if (iUid < 0) return { error: 'customers に line_uid 列がありません', list: [] };

  var people = {};
  for (var r = 1; r < cd.length; r++) {
    var uid = String(cd[r][iUid] || '').trim();
    if (!uid) continue;                                              // 未連携は個別トークを送れない
    var em = iMail >= 0 ? String(cd[r][iMail] || '').trim().toLowerCase() : '';
    if (em.indexOf('@eda-livestock.com') >= 0) continue;             // 社内テストは除外
    if (people[uid]) continue;                                       // 連携行が二重にある人がいる（ゴースト行）
    people[uid] = {
      uid: uid,
      email: em,
      name: String((iName >= 0 && cd[r][iName]) || (iLnm >= 0 && cd[r][iLnm]) || '').trim()
    };
  }

  var skip = fcr_excluded_();
  var list = [];
  Object.keys(people).forEach(function (uid) {
    var p = people[uid];
    if (sentMap && sentMap[uid]) return;                             // 1人1回だけ
    if (skip[fcr_nz_(uid)] || skip[fcr_nz_(p.name)]) return;         // 名指しの除外
    if (fcr_hasAnyOrder_(p.email, p.uid)) return;                    // 単品も定期便も「買った人」
    list.push(p);
  });
  return { error: '', list: list };
}

/* ============================================================
   本体（配布・リマインド共通）
   job: 'announce' | 'remind'
   ============================================================ */
function firstCouponJob_(job, mode) {
  var announce = (job === 'announce');
  var live  = (mode === 'live');
  var today = _jstDayNum(new Date());
  var deadline = fcr_deadlineDayNum_();

  if (deadline === null) {
    return { ok: false, job: job, mode: mode, candidates: 0, sent: 0,
             note: 'FIRST_COUPON_DEADLINE が未設定です（setFirstCouponDeadline("2026-09-07") を実行）' };
  }
  var daysLeft = deadline - today;

  if (live && daysLeft < 0) {
    return { ok: true, job: job, mode: 'live', candidates: 0, sent: 0, note: '締切を過ぎています' };
  }
  /* リマインドは締切の前日だけ動く。dry は日付に関係なく候補を見たいので通す。 */
  if (!announce && live && daysLeft !== 1) {
    return { ok: true, job: job, mode: 'live', candidates: 0, sent: 0,
             note: 'リマインド日ではありません（送るのは ' + fcr_md_(deadline - 1) + ' のみ）' };
  }

  var logSheet  = announce ? FCR_SEND_SHEET  : FCR_LOG_SHEET;
  var candSheet = announce ? FCR_SCAND_SHEET : FCR_CAND_SHEET;

  var got = fcr_candidates_(fcr_readLog_(logSheet));
  if (got.error) return { ok: false, job: job, mode: mode, candidates: 0, sent: 0, note: got.error };
  var cands = got.list;
  var popular = fcr_popularNames_();

  if (!live) {
    fcr_writeRows_(candSheet, cands, popular, deadline);
    return { ok: true, job: job, mode: 'dry', candidates: cands.length, popular: popular,
             deadline: fcr_md_(deadline), daysLeft: daysLeft,
             note: '送信していません。「' + candSheet + '」を確認してください' };
  }

  var enabled = announce ? fcr_sendEnabled_() : fcr_remindEnabled_();
  var key = announce ? 'FIRST_COUPON_SEND_ENABLED' : 'FIRST_COUPON_REMIND_ENABLED';
  if (!enabled) {
    return { ok: false, job: job, mode: 'live', candidates: cands.length, sent: 0,
             note: key + ' が true ではないので送信していません' };
  }

  var ok = 0, ng = 0;
  cands.forEach(function (p) {
    var done = false;
    try { done = fcr_send_(announce, p, popular, deadline, daysLeft); }
    catch (e) { log('first_coupon_' + job + '_error', { uid: p.uid, error: e.message }); }
    if (done) { ok++; fcr_appendLog_(logSheet, p, popular, deadline); } else { ng++; }
  });
  log('first_coupon_' + job, { candidates: cands.length, sent: ok, failed: ng, deadline: fcr_md_(deadline) });
  return { ok: true, job: job, mode: 'live', candidates: cands.length, sent: ok, failed: ng, daysLeft: daysLeft };
}

/* ============================================================
   送信（LINE個別トーク）
   文面は「得／いつまで／何をする」の3つ＋いま人気の商品。
   残り日数は締切から毎回計算する＝送信が翌日にズレても数字が嘘にならない。
   ============================================================ */
function fcr_send_(announce, p, popular, deadline, daysLeft) {
  var L = [];
  if (p.name) L.push(p.name + ' 様', '');

  if (announce) {
    L.push('いつも江田畜産のLINEをご覧いただき');
    L.push('ありがとうございます！！');
    L.push('');
    L.push('ご登録時にお渡しした【10%OFFクーポン】、');
    L.push('まだお使いいただけます😄');
    L.push('');
    L.push('　全品 10%OFF（クーポンコード：' + fcr_code_() + '）');
    L.push('　' + fcr_md_(deadline) + ' 23:59 まで');
    L.push('');
    L.push('残り' + daysLeft + '日です。');
  } else {
    L.push('先日ご案内したクーポンが、');
    L.push('明日 ' + fcr_md_(deadline) + ' 23:59 で終了します😄');
    L.push('');
    L.push('　全品 10%OFF（クーポンコード：' + fcr_code_() + '）');
    L.push('');
    L.push('残り1日です。');
  }

  if (popular && popular.length) {
    L.push('');
    L.push('―――――――――');
    L.push('【いま人気の商品】');
    popular.forEach(function (nm, i) { L.push('　' + (i + 1) + '位　' + nm); });
  }
  L.push('');
  L.push('ご注文はこちら👇');
  L.push(announce ? fcr_url_() : fcr_urlRemind_());
  return sendLinePush(p.uid, [{ type: 'text', text: L.join('\n') }]);
}

/* ============================================================
   ログ（冪等の担保）
   ============================================================ */
function fcr_readLog_(name) {
  var rows = sheet(name, FCR_HEADERS).getDataRange().getValues();
  var map = {};
  for (var r = 1; r < rows.length; r++) {
    var uid = String(rows[r][2] || '').trim();
    if (uid) map[uid] = true;
  }
  return map;
}

function fcr_appendLog_(name, p, popular, deadline) {
  sheet(name, FCR_HEADERS).appendRow([
    fcr_stamp_(new Date()), p.email || '', p.uid, p.name || '',
    fcr_code_(), fcr_md_(deadline), (popular || []).join(' / ')
  ]);
}

function fcr_writeRows_(name, cands, popular, deadline) {
  var head = ['作成', 'email', 'line_uid', 'name', 'クーポン', '締切', '人気商品'];
  var sh = sheet(name, head);
  sh.clear();
  sh.appendRow(head);
  var now = fcr_stamp_(new Date());
  var pop = (popular || []).join(' / ');
  cands.forEach(function (p) {
    sh.appendRow([now, p.email || '', p.uid, p.name || '', fcr_code_(), fcr_md_(deadline), pop]);
  });
}
function go1835() {
  return scheduleFirstCouponAnnounce("2026-08-31 18:35");
}