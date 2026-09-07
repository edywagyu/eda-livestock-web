/**
 * ============================================================
 *  毎晩20時「今日どの自動配信が誰に飛んだか／飛ぶか」ダイジェストメール
 *  2026-09-07 田崎さん指示 / 既存関数(cfg, ss, sheet, log, BRAND_MAIL,
 *                rosterOrdersByUid_, runFirstCouponRemindDry,
 *                runRepeatShipRemindDry, runFirstFollowupDry) を流用
 * ------------------------------------------------------------
 *  何をするか:
 *   1) 日次で確定する3本（初回クーポン残り1日／送料半額残り1日／初回お届け1週間後の感想）は
 *      Dry を回して「今日この後に誰へ飛ぶか」を出す。判定は実送信とまったく同じ関数を
 *      通すので、予告と実際が食い違わない。
 *   2) カゴ落ち（毎時・当日その場で発生）は朝には確定しないので、
 *      これまで送った全件と、その後どうなったか
 *      （売れた／カートから外した／カートに残っている）を出す。
 *   3) LINE表示名（customers の line_name）とご注文名（customers/候補の name）を
 *      並べた表にして、1通のHTMLメールで送る。
 *
 *  ⚠️ LINE に既読/未読を取る手段は無い（Messaging API に存在しない）。
 *     代わりに配信リンクのクリック（events の msg_click／meta.msg=cart_recovery）で
 *     「開いたか」を出す。開いていない＝未読とは言い切れないので表記も分ける。
 *  ⚠️ 初回クーポンのリマインドは実送信が「締切の前日だけ」。
 *     Dry は日付に関係なく候補を出すので、戻り値の daysLeft を見て今日送るか判定する。
 *     これを見ないと「今日送る」が嘘になる。
 *  ⚠️ Dry は候補シートを毎回 clear して書き直す（既存仕様）。このダイジェストが
 *     朝8時に3本回すので、候補シートの中身は「その朝の状態」になる。
 *
 *  Script Properties（任意・未設定なら既定値）:
 *   DIGEST_TO       宛先（既定 r.tasaki@eda-livestock.com・カンマ区切りで複数可）
 *   DIGEST_ENABLED  'false' で送信停止        （既定 送る）
 *   DIGEST_EV_ROWS  events を末尾から何行見るか（既定 30000）
 *
 *  2026-09-07 田崎さん指示で 朝8時 → **毎晩20時** に変更。
 *  2026-09-07 田崎さん指示で カゴ落ちに「カートの中身（商品名）」列を追加。
 *   中身は events の add_to_cart の meta.title から作り、そのあと remove_from_cart
 *   された商品は外す。line_uid が全イベントに付く前（2026-08 頭より前）の古い送信は
 *   取れないので「（記録なし）」と出る。
 * ============================================================ */

var DSD_TZ         = 'Asia/Tokyo';
var DSD_TO_DEFAULT = 'r.tasaki@eda-livestock.com';
var DSD_WD         = ['日', '月', '火', '水', '木', '金', '土'];
var DSD_CART_BACK_H = 48;   /* カート投入をどれだけ前までさかのぼって見るか（時間） */
/* 表に出さない人（2026-09-07 田崎さん指示「あと俺も」＝自分の行は要らない）。
   uid は customers の line_uid、メールは注文に使っているもの。増やす時は Script Property で足す。 */
var DSD_EXCLUDE_UIDS_DEFAULT   = 'U9f604bc69c9c1f40276f5d28458e353e';
var DSD_EXCLUDE_EMAILS_DEFAULT = 'ryochin429@gmail.com,r.tasaki@eda-livestock.com';

function dsd_to_()      { return String(cfg('DIGEST_TO', '') || DSD_TO_DEFAULT); }
function dsd_enabled_() { return String(cfg('DIGEST_ENABLED', 'true')) !== 'false'; }
function dsd_evRows_()  { var v = Number(cfg('DIGEST_EV_ROWS', '')); return (v && v > 0) ? v : 30000; }
function dsd_esc_(v)    { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function dsd_stamp_(d)  { return Utilities.formatDate(d, DSD_TZ, 'M/d HH:mm'); }
function dsd_yen_(n)    { n = Math.round(Number(n) || 0); return '¥' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function dsd_onoff_(k)  { return String(cfg(k, 'false')) === 'true' ? 'ON' : 'OFF'; }

function dsd_set_(csv) {
  var m = {};
  String(csv || '').split(',').forEach(function (v) { v = v.trim(); if (v) m[v.toLowerCase()] = 1; });
  return m;
}
function dsd_excluded_(uid, email) {
  var u = dsd_set_(cfg('DIGEST_EXCLUDE_UIDS', '') || DSD_EXCLUDE_UIDS_DEFAULT);
  var e = dsd_set_(cfg('DIGEST_EXCLUDE_EMAILS', '') || DSD_EXCLUDE_EMAILS_DEFAULT);
  if (uid && u[String(uid).toLowerCase()]) return true;
  if (email && e[String(email).toLowerCase()]) return true;
  return false;
}

function dsd_parse_(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/* ---- 初期設定（これ1本でトリガー設置＋いまの中身を1通送って確かめる）----
   CustomerRoster の setupRosterAutomation と同じ流儀。時刻を変えた時もこれを実行すればよい。 */
function setupDigest() {
  var t = installDailyDigestTrigger();
  var d = runDailySendDigest();
  return { trigger: t, mail: d };
}

/* ---- トリガー（毎晩20時。その日の配信は10時・11時・18時に済んでいる）----
   時刻を変えたい時もこの1本を実行すれば済むよう、既存のものは消して作り直す。 */
var DSD_HOUR = 20;
function installDailyDigestTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailySendDigest') { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('runDailySendDigest').timeBased().everyDays(1).atHour(DSD_HOUR).inTimezone(DSD_TZ).create();
  return { ok: true, hour: DSD_HOUR, removed: removed };
}
function setDigestOn()  { PropertiesService.getScriptProperties().setProperty('DIGEST_ENABLED', 'true');  return 'DIGEST_ENABLED=true'; }
function setDigestOff() { PropertiesService.getScriptProperties().setProperty('DIGEST_ENABLED', 'false'); return 'DIGEST_ENABLED=false'; }

/* ============================================================
   名前（LINE表示名 / ご注文名）
   customers: customer_id,email,name,phone,first_order,last_order,
              total_spent,order_count,line_uid,line_name,linked_at
   ============================================================ */
function dsd_names_() {
  var out = { lineByUid: {}, lineByEmail: {}, orderByUid: {}, orderByEmail: {} };
  var cs = ss().getSheetByName('customers'); if (!cs) return out;
  var d = cs.getDataRange().getValues(); if (d.length < 2) return out;
  var H = d[0].map(function (v) { return String(v || ''); });
  var iUid = H.indexOf('line_uid'), iLn = H.indexOf('line_name'),
      iNm  = H.indexOf('name'),     iEm = H.indexOf('email');
  function fuller(a, b) { a = String(a || ''); b = String(b || ''); return b.length > a.length ? b : a; }
  for (var r = 1; r < d.length; r++) {
    var uid = iUid >= 0 ? String(d[r][iUid] || '').trim() : '';
    var em  = iEm  >= 0 ? String(d[r][iEm]  || '').trim().toLowerCase() : '';
    var ln  = iLn  >= 0 ? String(d[r][iLn]  || '').trim() : '';
    var nm  = iNm  >= 0 ? String(d[r][iNm]  || '').trim() : '';
    if (uid) { out.lineByUid[uid]   = fuller(out.lineByUid[uid], ln);   out.orderByUid[uid]   = fuller(out.orderByUid[uid], nm); }
    if (em)  { out.lineByEmail[em]  = fuller(out.lineByEmail[em], ln);  out.orderByEmail[em]  = fuller(out.orderByEmail[em], nm); }
  }
  return out;
}
function dsd_lineName_(names, uid, email) {
  var v = uid ? names.lineByUid[uid] : '';
  if (!v && email) v = names.lineByEmail[String(email).toLowerCase()];
  return v || '';
}
function dsd_orderName_(names, uid, email, fallback) {
  var v = fallback || '';
  if (!v && uid) v = names.orderByUid[uid];
  if (!v && email) v = names.orderByEmail[String(email).toLowerCase()];
  return v || '';
}

/* ---- 候補シートを読む（列名で拾う。余った列は「補足」にまとめる）---- */
function dsd_readCand_(sheetName) {
  var sh = ss().getSheetByName(sheetName); if (!sh) return [];
  var d = sh.getDataRange().getValues(); if (d.length < 2) return [];
  var H = d[0].map(function (v) { return String(v || ''); });
  var iEm = H.indexOf('email'), iUid = H.indexOf('line_uid'), iNm = H.indexOf('name'), iCh = H.indexOf('送る手段');
  var rows = [];
  for (var r = 1; r < d.length; r++) {
    var em = iEm >= 0 ? String(d[r][iEm] || '').trim() : '';
    var uid = iUid >= 0 ? String(d[r][iUid] || '').trim() : '';
    if (!em && !uid) continue;
    if (dsd_excluded_(uid, em)) continue;   /* 自分の行は出さない */
    var extra = [];
    for (var c = 0; c < H.length; c++) {
      if (c === iEm || c === iUid || c === iNm || c === iCh) continue;
      if (H[c] === '作成' || H[c] === 'sent_at' || H[c] === '人気商品') continue;
      var v = d[r][c];
      if (v === '' || v == null) continue;
      extra.push(H[c] + ' ' + (v instanceof Date ? Utilities.formatDate(v, DSD_TZ, 'M/d') : v));
    }
    rows.push({
      email: em, uid: uid,
      name: iNm >= 0 ? String(d[r][iNm] || '') : '',
      channel: iCh >= 0 ? String(d[r][iCh] || '') : 'LINE',
      extra: extra.join('・')
    });
  }
  return rows;
}

/* ============================================================
   カゴ落ち：これまで送った全件＋その後どうなったか
   ログ列 = 送信日時 / line_uid / 表示名 / カゴ落ち時刻 / 金額 / 送信結果 / 復帰 / 復帰売上
   ============================================================ */
function dsd_cartHistory_() {
  var res = { rows: [], note: '' };
  var sh = ss().getSheetByName(CART_SENT_SHEET);
  if (!sh) { res.note = '「' + CART_SENT_SHEET + '」がまだありません（送信実績なし）'; return res; }
  var d = sh.getDataRange().getValues();
  if (d.length < 2) { res.note = 'まだ1件も送っていません'; return res; }

  var H = d[0].map(function (v) { return String(v || ''); });
  var iAt = H.indexOf('送信日時'), iUid = H.indexOf('line_uid'), iNm = H.indexOf('表示名'),
      iVal = H.indexOf('金額'), iRes = H.indexOf('送信結果');
  var sent = [], oldest = null, hiddenSelf = 0;
  for (var r = 1; r < d.length; r++) {
    var uid = String(d[r][iUid] || '').trim(); if (!uid) continue;
    if (dsd_excluded_(uid, '')) { hiddenSelf++; continue; }   /* 自分の行は出さない */
    var at = dsd_parse_(d[r][iAt]);
    sent.push({
      uid: uid, at: at,
      lineName: iNm >= 0 ? String(d[r][iNm] || '') : '',
      value: iVal >= 0 ? (Number(d[r][iVal]) || 0) : 0,
      result: iRes >= 0 ? String(d[r][iRes] || '') : ''
    });
    if (at && (!oldest || at < oldest)) oldest = at;
  }
  if (!sent.length) { res.note = 'まだ1件も送っていません'; return res; }

  var uids = {}; sent.forEach(function (s2) { uids[s2.uid] = 1; });
  var ev = dsd_scanEvents_(oldest, uids);
  var pnames = {};
  try { pnames = dsd_productNames_(); } catch (e) { log('digest_products_err', { error: e.message }); }
  var ordersByUid = {};
  try { ordersByUid = rosterOrdersByUid_(); } catch (e) { log('digest_orders_err', { error: e.message }); }

  sent.forEach(function (s) {
    var bought = null;
    (ordersByUid[s.uid] || []).forEach(function (o) {
      if (s.at && o.pt >= s.at && (!bought || o.pt < bought.pt)) bought = o;
    });
    var removed = !!(s.at && ev.removeByUid[s.uid] && ev.removeByUid[s.uid] >= s.at);
    var opened  = !!(s.at && ev.clickByUid[s.uid]  && ev.clickByUid[s.uid]  >= s.at);
    if (String(s.result).indexOf('失敗') >= 0)      s.state = '⚠️ 送信できていない';
    else if (bought)                                s.state = '✅ 売れた（' + dsd_yen_(bought.total) + '）';
    else if (removed)                               s.state = '🗑 カートから外した';
    else                                            s.state = '🛒 カートに残っている';
    s.bought = bought;
    s.opened = opened ? '開いた' : '—';
    s.items  = dsd_cartItems_(ev.cartByUid[s.uid], s.at, pnames);
  });
  /* 2026-09-07 田崎さん指示「売れた人は記載しなくていい」＝買ってくれた行は落とす。
     何件あったかだけは注記で残す（黙って消すと「減った」に見えるので）。 */
  var boughtCount = 0;
  sent = sent.filter(function (s) { if (s.bought) { boughtCount++; return false; } return true; });

  sent.sort(function (a, b) { return (b.at ? b.at.getTime() : 0) - (a.at ? a.at.getTime() : 0); });
  res.rows = sent;
  res.hiddenBought = boughtCount;
  res.hiddenSelf = hiddenSelf;
  res.note = ev.note;
  return res;
}

/* events を末尾から走査。カート投入は送信より前に起きるので since より 48 時間ぶん余分に見る。
   uids を渡すと、その人たちのイベントだけ拾う（全員ぶん持つと重い）。 */
function dsd_scanEvents_(since, uids) {
  var out = { removeByUid: {}, clickByUid: {}, cartByUid: {}, note: '' };
  var sh = ss().getSheetByName('events');
  if (!sh) { out.note = 'events タブなし'; return out; }
  var last = sh.getLastRow(); if (last < 2) return out;
  var cols = sh.getLastColumn();
  var H = sh.getRange(1, 1, 1, cols).getValues()[0].map(function (v) { return String(v || ''); });
  var iTs = H.indexOf('ts'), iType = H.indexOf('event_type'), iMeta = H.indexOf('meta_json'), iPid = H.indexOf('product_id');
  if (iTs < 0 || iType < 0 || iMeta < 0) { out.note = 'events の列が想定と違う'; return out; }

  var from = since ? new Date(since.getTime() - DSD_CART_BACK_H * 3600 * 1000) : null;
  var want = Math.min(dsd_evRows_(), last - 1);
  var vals = sh.getRange(last - want + 1, 1, want, cols).getValues();
  var seen = 0;
  for (var r = vals.length - 1; r >= 0; r--) {
    var ts = dsd_parse_(vals[r][iTs]);
    if (ts && from && ts < from) break;
    seen++;
    var type = String(vals[r][iType] || '');
    if (type !== 'remove_from_cart' && type !== 'msg_click' && type !== 'add_to_cart') continue;
    var m = {}; try { m = JSON.parse(vals[r][iMeta] || '{}'); } catch (e) {}
    var uid = String(m.line_uid || m.uid || '').trim();
    if (!uid || !ts) continue;
    if (uids && !uids[uid]) continue;

    if (type === 'msg_click') {
      if (String(m.msg || '').indexOf('cart_recovery') === 0) {
        if (!out.clickByUid[uid] || ts > out.clickByUid[uid]) out.clickByUid[uid] = ts;
      }
      continue;
    }
    var title = String(m.title || m.pid || (iPid >= 0 ? vals[r][iPid] : '') || '').trim();
    if (type === 'remove_from_cart') {
      if (!out.removeByUid[uid] || ts > out.removeByUid[uid]) out.removeByUid[uid] = ts;
    }
    if (!title) continue;
    (out.cartByUid[uid] = out.cartByUid[uid] || []).push({ kind: (type === 'add_to_cart' ? 'add' : 'rm'), ts: ts, title: title });
  }
  out.note = 'events 直近 ' + seen + ' 行を確認';
  return out;
}

/* 商品ID(P0xx / variantId / SKU) → 商品名。events に商品名が入っていない行があるため。
   products: productId,variantId,sku,stripePriceId,name,... */
function dsd_productNames_() {
  var map = {};
  var sh = ss().getSheetByName('products'); if (!sh) return map;
  var d = sh.getDataRange().getValues(); if (d.length < 2) return map;
  var H = d[0].map(function (v) { return String(v || ''); });
  var iPid = H.indexOf('productId'), iVar = H.indexOf('variantId'), iSku = H.indexOf('sku'), iNm = H.indexOf('name');
  if (iNm < 0) return map;
  for (var r = 1; r < d.length; r++) {
    var nm = String(d[r][iNm] || '').trim(); if (!nm) continue;
    [iPid, iVar, iSku].forEach(function (i) {
      if (i < 0) return;
      var k = String(d[r][i] || '').trim();
      if (k && !map[k.toLowerCase()]) map[k.toLowerCase()] = nm;
    });
  }
  return map;
}

/* その送信の時点でカートに入っていた商品名。入れたあとに外した商品は落とす。 */
function dsd_cartItems_(events, sentAt, pnames) {
  if (!events || !events.length || !sentAt) return '';
  var from = new Date(sentAt.getTime() - DSD_CART_BACK_H * 3600 * 1000);
  var lastAdd = {}, lastRm = {};
  events.forEach(function (e) {
    if (e.ts < from || e.ts > sentAt) return;
    var box = (e.kind === 'add') ? lastAdd : lastRm;
    if (!box[e.title] || e.ts > box[e.title]) box[e.title] = e.ts;
  });
  var items = [];
  Object.keys(lastAdd).forEach(function (t) {
    if (lastRm[t] && lastRm[t] > lastAdd[t]) return;
    items.push((pnames && pnames[String(t).toLowerCase()]) || t);   /* IDのままだと何の商品か分からない */
  });
  return items.join(' / ');
}

/* ============================================================
   本体
   ============================================================ */
function runDailySendDigest() {
  var now = new Date();
  var names = dsd_names_();
  var plans = [];

  /* ① 初回クーポン「残り1日」… 実送信は締切の前日だけ */
  var p1 = { title: '初回クーポン 残り1日', time: '18時台', channel: 'LINEのみ',
             sw: dsd_onoff_('FIRST_COUPON_REMIND_ENABLED'), rows: [], note: '' };
  try {
    var r1 = runFirstCouponRemindDry();
    p1.rows = dsd_readCand_(FCR_CAND_SHEET);
    var dl = Number(r1 && r1.daysLeft);
    if (dl !== 1) {
      p1.note = '今日は送りません（送るのは締切の前日だけ。締切 ' + ((r1 && r1.deadline) || '不明') +
                '／残り ' + (isNaN(dl) ? '?' : dl) + ' 日）。下の人数は「いま条件に合う人」';
    }
  } catch (e) { p1.note = '集計できませんでした: ' + e.message; }
  plans.push(p1);

  /* ② 送料半額「残り1日」 */
  var p2 = { title: '送料半額 残り1日', time: '10時台', channel: 'LINE / メール',
             sw: dsd_onoff_('REPEAT_SHIP_REMIND_ENABLED'), rows: [], note: '' };
  try { runRepeatShipRemindDry(); p2.rows = dsd_readCand_(RSR_CAND_SHEET); }
  catch (e) { p2.note = '集計できませんでした: ' + e.message; }
  plans.push(p2);

  /* ③ 初回お届け1週間後の感想 */
  var p3 = { title: '初回お届け1週間後の感想', time: '11時台', channel: 'LINE / メール',
             sw: dsd_onoff_('FIRST_FOLLOWUP_ENABLED'), rows: [], note: '' };
  try { runFirstFollowupDry(); p3.rows = dsd_readCand_(FDF_CAND_SHEET); }
  catch (e) { p3.note = '集計できませんでした: ' + e.message; }
  plans.push(p3);

  /* ④ カゴ落ち（毎時・当日発生型）＝これまでの全件とその後 */
  var cart = { rows: [], note: '' };
  try { cart = dsd_cartHistory_(); } catch (e) { cart.note = '集計できませんでした: ' + e.message; }

  var todayCount = 0;
  plans.forEach(function (p) { if (!p.note) todayCount += p.rows.length; });

  var subject = '【自動配信】' + Utilities.formatDate(now, DSD_TZ, 'M月d日') +
                '(' + DSD_WD[Number(Utilities.formatDate(now, DSD_TZ, 'u')) % 7] + ')' +
                ' 今日送る ' + todayCount + '件 ／ カゴ落ちのその後 ' + cart.rows.length + '件';

  var html = dsd_html_(now, plans, cart, names);
  var to = dsd_to_();

  if (!dsd_enabled_()) {
    log('digest_skipped', { reason: 'DIGEST_ENABLED=false', today: todayCount, cart: cart.rows.length });
    return { ok: true, sent: false, note: 'DIGEST_ENABLED=false なので送っていません', today: todayCount };
  }
  MailApp.sendEmail({ to: to, name: BRAND_MAIL.sender, subject: subject, htmlBody: html, body: dsd_text_(plans, cart, names) });
  log('digest_sent', { to: to, today: todayCount, cart: cart.rows.length });
  return { ok: true, sent: true, to: to, today: todayCount, cart: cart.rows.length };
}

/* 送らずに中身だけ確認したいとき */
function runDailySendDigestDry() {
  var saved = cfg('DIGEST_ENABLED', 'true');
  PropertiesService.getScriptProperties().setProperty('DIGEST_ENABLED', 'false');
  try { return runDailySendDigest(); }
  finally { PropertiesService.getScriptProperties().setProperty('DIGEST_ENABLED', saved); }
}

/* ============================================================
   見た目（社内向け。ブランドテンプレは2列表しか出せないので自前で組む）
   ============================================================ */
function dsd_html_(now, plans, cart, names) {
  var G = '#0F3D2E', LINE_ = '#ece8dc', SUB = '#7c8a83';
  var th = 'padding:8px 10px;background:' + G + ';color:#fff;font-size:12px;text-align:left;white-space:nowrap;';
  var td = 'padding:8px 10px;border-bottom:1px solid ' + LINE_ + ';font-size:13px;vertical-align:top;';
  var h = [];

  h.push('<div style="font-family:sans-serif;max-width:860px;margin:0 auto;padding:16px;color:#1a1a1a;">');
  h.push('<div style="font-size:12px;color:' + SUB + ';">' + dsd_esc_(Utilities.formatDate(now, DSD_TZ, 'yyyy年M月d日')) +
         '(' + DSD_WD[Number(Utilities.formatDate(now, DSD_TZ, 'u')) % 7] + ') ' + Utilities.formatDate(now, DSD_TZ, 'HH:mm') + ' 時点</div>');
  h.push('<h2 style="margin:6px 0 2px;font-size:19px;">今日、公式LINE（自動）で誰に何が飛ぶか</h2>');
  h.push('<div style="font-size:12px;color:' + SUB + ';margin-bottom:16px;">判定は実際に送るプログラムと同じものを通しています。止めたい場合はスイッチをOFFにしてください。</div>');

  /* --- 今日の予定 --- */
  plans.forEach(function (p) {
    var swColor = (p.sw === 'ON') ? G : '#b3261e';
    h.push('<div style="margin:0 0 6px;font-size:15px;font-weight:bold;">' + dsd_esc_(p.title) +
           ' <span style="font-weight:normal;font-size:12px;color:' + SUB + ';">' + dsd_esc_(p.time) + '／' + dsd_esc_(p.channel) + '</span>' +
           ' <span style="font-size:11px;color:#fff;background:' + swColor + ';padding:2px 8px;border-radius:999px;">スイッチ ' + p.sw + '</span></div>');
    if (p.note) h.push('<div style="font-size:12px;color:#b3261e;margin:0 0 6px;">' + dsd_esc_(p.note) + '</div>');
    if (!p.rows.length) {
      h.push('<div style="font-size:13px;color:' + SUB + ';margin:0 0 20px;">対象なし</div>');
      return;
    }
    h.push('<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">');
    h.push('<tr><th style="' + th + '">LINEの名前</th><th style="' + th + '">ご注文の名前</th>' +
           '<th style="' + th + '">送る手段</th><th style="' + th + '">宛先</th><th style="' + th + '">補足</th></tr>');
    p.rows.forEach(function (x) {
      var ln = dsd_lineName_(names, x.uid, x.email);
      var on = dsd_orderName_(names, x.uid, x.email, x.name);
      h.push('<tr><td style="' + td + '">' + (ln ? dsd_esc_(ln) : '<span style="color:' + SUB + ';">（未連携）</span>') + '</td>' +
             '<td style="' + td + 'font-weight:bold;">' + (on ? dsd_esc_(on) : '<span style="color:' + SUB + ';font-weight:normal;">（名前の登録なし）</span>') + '</td>' +
             '<td style="' + td + '">' + dsd_esc_(x.channel) + '</td>' +
             '<td style="' + td + 'color:' + SUB + ';font-size:12px;">' + dsd_esc_(x.channel === 'LINE' ? '個別トーク' : x.email) + '</td>' +
             '<td style="' + td + 'color:' + SUB + ';font-size:12px;">' + dsd_esc_(x.extra) + '</td></tr>');
    });
    h.push('</table>');
  });

  /* --- カゴ落ち --- */
  h.push('<div style="margin:24px 0 6px;font-size:15px;font-weight:bold;">カゴ落ちリマインド' +
         ' <span style="font-weight:normal;font-size:12px;color:' + SUB + ';">毎時・その場で発生／LINEのみ</span>' +
         ' <span style="font-size:11px;color:#fff;background:' + ((dsd_onoff_('CART_RECOVERY_ENABLED') === 'ON') ? G : '#b3261e') +
         ';padding:2px 8px;border-radius:999px;">スイッチ ' + dsd_onoff_('CART_RECOVERY_ENABLED') + '</span></div>');
  h.push('<div style="font-size:12px;color:' + SUB + ';margin:0 0 8px;">朝の時点では「今日誰に飛ぶか」は決まりません（お客様がカートを置いた時に発生）。これまでに送った全件と、その後どうなったかです。</div>');
  var hid = [];
  if (cart.hiddenBought) hid.push('買ってくださった ' + cart.hiddenBought + ' 件');
  if (cart.hiddenSelf)   hid.push('自分の ' + cart.hiddenSelf + ' 件');
  if (hid.length) h.push('<div style="font-size:12px;color:' + SUB + ';margin:0 0 6px;">' + dsd_esc_(hid.join('と') + 'は省いています') + '</div>');
  if (cart.note) h.push('<div style="font-size:12px;color:' + SUB + ';margin:0 0 6px;">' + dsd_esc_(cart.note) + '</div>');
  if (!cart.rows.length) {
    h.push('<div style="font-size:13px;color:' + SUB + ';">送信実績なし</div>');
  } else {
    h.push('<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">');
    h.push('<tr><th style="' + th + '">送った日時</th><th style="' + th + '">LINEの名前</th><th style="' + th + '">ご注文の名前</th>' +
           '<th style="' + th + '">カートに入っている商品</th><th style="' + th + '">カゴの金額</th>' +
           '<th style="' + th + '">その後</th><th style="' + th + '">リンク</th></tr>');
    cart.rows.forEach(function (s) {
      var ln = s.lineName || dsd_lineName_(names, s.uid, '');
      var on = dsd_orderName_(names, s.uid, '', '');
      var color = (s.state.indexOf('売れた') >= 0) ? G : (s.state.indexOf('⚠️') >= 0 ? '#b3261e' : '#1a1a1a');
      h.push('<tr><td style="' + td + 'white-space:nowrap;color:' + SUB + ';font-size:12px;">' + dsd_esc_(s.at ? dsd_stamp_(s.at) : '') + '</td>' +
             '<td style="' + td + '">' + (ln ? dsd_esc_(ln) : '<span style="color:' + SUB + ';">（不明）</span>') + '</td>' +
             '<td style="' + td + 'font-weight:bold;">' + (on ? dsd_esc_(on) : '<span style="color:' + SUB + ';font-weight:normal;">（購入歴なし）</span>') + '</td>' +
             '<td style="' + td + '">' + (s.items ? dsd_esc_(s.items) : '<span style="color:' + SUB + ';font-size:12px;">（記録なし）</span>') + '</td>' +
             '<td style="' + td + 'white-space:nowrap;">' + dsd_esc_(dsd_yen_(s.value)) + '</td>' +
             '<td style="' + td + 'color:' + color + ';white-space:nowrap;">' + dsd_esc_(s.state) + '</td>' +
             '<td style="' + td + 'color:' + SUB + ';font-size:12px;white-space:nowrap;">' + dsd_esc_(s.opened) + '</td></tr>');
    });
    h.push('</table>');
  }

  h.push('<div style="margin-top:22px;padding-top:12px;border-top:1px solid ' + LINE_ + ';font-size:11px;color:' + SUB + ';line-height:1.7;">');
  h.push('※ LINEに「既読・未読」を取る仕組みはありません（LINE側が出していない）。代わりに配信リンクを押したかどうかを「リンク」列に出しています。押していない＝読んでいない、とは言い切れません。<br>');
  h.push('※「カートに残っている」は、送ったあとに購入もカートからの削除も記録されていない状態です。買ってくださった方はこの表には出しません。<br>');
  h.push('※「カートに入っている商品」は、カゴ落ちの前後48時間にカートへ入れて、そのあと外していない商品です。LINEのIDを全イベントに付け始める前（2026年8月頭より前）の古い送信は取れないので「（記録なし）」になります。<br>');
  h.push('※ この予告は毎朝8時。実際に送るのは 送料半額10時台／感想11時台／初回クーポン18時台、カゴ落ちは毎時。<br>');
  h.push('※ 止めたいときは、その施策のスイッチをOFFにしてください（このメール自体を止めるなら setDigestOff）。');
  h.push('</div></div>');
  return h.join('');
}

/* テキスト版（HTMLを読めない環境向けの控え） */
function dsd_text_(plans, cart, names) {
  var t = [];
  plans.forEach(function (p) {
    t.push('■ ' + p.title + '（' + p.time + '／スイッチ ' + p.sw + '）');
    if (p.note) t.push('  ' + p.note);
    if (!p.rows.length) { t.push('  対象なし'); return; }
    p.rows.forEach(function (x) {
      t.push('  - ' + (dsd_lineName_(names, x.uid, x.email) || '（未連携）') +
             ' / ' + (dsd_orderName_(names, x.uid, x.email, x.name) || '（名前なし）') +
             ' / ' + x.channel + (x.extra ? ' / ' + x.extra : ''));
    });
  });
  t.push('');
  t.push('■ カゴ落ち（これまでの全送信・買ってくださった方と自分は省略）');
  if (cart.hiddenBought || cart.hiddenSelf) t.push('  （省いた分: 買ってくださった ' + (cart.hiddenBought||0) + ' 件 / 自分 ' + (cart.hiddenSelf||0) + ' 件）');
  if (!cart.rows.length) t.push('  送信実績なし');
  cart.rows.forEach(function (s) {
    t.push('  - ' + (s.at ? dsd_stamp_(s.at) : '') + ' / ' + (s.lineName || '（不明）') +
           ' / ' + (s.items || '（カートの中身は記録なし）') +
           ' / ' + dsd_yen_(s.value) + ' / ' + s.state + ' / リンク ' + s.opened);
  });
  return t.join('\n');
}
