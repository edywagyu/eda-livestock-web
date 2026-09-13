/**
 * ============================================================
 *  毎晩21時「今日やったこと」レポート
 *  2026-09-07 田崎さん指示 / 既存関数(cfg, ss, sheet, log, BRAND_MAIL) を流用
 * ------------------------------------------------------------
 *  1通を上下2段に分ける（田崎さん指示「両方を上下に並べる」）:
 *   ① 上段＝お店と公式LINEで起きたこと … システムが記録している事実だけを自動で集計する。
 *      注文・売上・カート・決済でつまずいた件数・問い合わせ／自動配信の送信数・
 *      配信リンクのクリック・LINE連携した人数。人が何もしなくても毎日必ず埋まる。
 *   ② 下段＝クロードの作業ログ … 本番EC注文DBの「作業ログ」タブに書いた行を、その日ぶん出す。
 *      ここは自動では埋まらない。作業した日にクロードが1行ずつ書く（列＝日付/時刻/区分/
 *      やったこと/詳細・リンク/記録者）。行が無い日は「記録なし」と出る。
 *
 *  ③ 自動配信の名簿 … 2026-09-09 田崎さん指示「夜の2通を1つにまとめて」。
 *     20時に別便で出していた DailySendDigest.gs の中身（今日誰に何が飛んだか／カゴ落ちのその後）を
 *     dsd_collect_() + dsd_sectionsHtml_() でそのまま取り込み、この1通の下段に置いた。
 *     20時のトリガーは残っているが DIGEST_MERGED=true の間は何も送らない（戻すなら setDigestMergedOff）。
 *  ⚠️ 売上は税込・定期便を除く単品/ギフトのみ（管理画面の「今月のまとめ」と同じ基準）。
 *     社内(@eda-livestock.com)とお届け先の無い注文は数えない。
 *
 *  Script Properties（任意）:
 *   WORKREPORT_TO       宛先（既定 DIGEST_TO ／さらに既定 r.tasaki@eda-livestock.com）
 *   WORKREPORT_ENABLED  'false' で送信停止（既定 送る）
 * ============================================================ */

var DWR_LOG_SHEET = '作業ログ';
var DWR_HEADERS   = ['日付', '時刻', '区分', 'やったこと', '詳細・リンク', '記録者'];
var DWR_HOUR      = 21;

function dwr_to_()      { return String(cfg('WORKREPORT_TO', '') || cfg('DIGEST_TO', '') || DSD_TO_DEFAULT); }
function dwr_enabled_() { return String(cfg('WORKREPORT_ENABLED', 'true')) !== 'false'; }
function dwr_ymd_(d)    { return Utilities.formatDate(d, DSD_TZ, 'yyyy-MM-dd'); }

/* ---- 入口：これ1本でタブ作成＋トリガー設置＋いまの中身を1通送って確かめる ---- */
function setupWorkReport() {
  ensureWorkLogSheet();
  var t = installWorkReportTrigger();
  var m = runDailyWorkReport();
  return { trigger: t, mail: m };
}
function installWorkReportTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyWorkReport') { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('runDailyWorkReport').timeBased().everyDays(1).atHour(DWR_HOUR).inTimezone(DSD_TZ).create();
  return { ok: true, hour: DWR_HOUR, removed: removed };
}
function ensureWorkLogSheet() {
  var sh = sheet(DWR_LOG_SHEET, DWR_HEADERS);
  return { ok: true, sheet: DWR_LOG_SHEET, rows: sh.getLastRow() };
}
function setWorkReportOff() { PropertiesService.getScriptProperties().setProperty('WORKREPORT_ENABLED', 'false'); return 'WORKREPORT_ENABLED=false'; }
function setWorkReportOn()  { PropertiesService.getScriptProperties().setProperty('WORKREPORT_ENABLED', 'true');  return 'WORKREPORT_ENABLED=true'; }

/* ============================================================
   ① お店で起きたこと（orders / events / 問い合わせ）
   orders の列は固定: 0=注文番号 1=placed_at 4=email 6=mode 7=total
                      9=payment_status 11=destinations_json
   ============================================================ */
function dwr_ecStats_(ymd) {
  var out = { orders: 0, revenue: 0, firstTime: 0, repeat: 0, names: [],
              addToCart: 0, beginCheckout: 0, blocked: 0, viewItem: 0, inquiries: 0 };
  var sh = ss().getSheetByName('orders');
  if (sh) {
    var d = sh.getDataRange().getValues();
    var seen = {}, beforeByEmail = {};
    /* まず「その日より前に買ったことがあるか」を作る（初めての方かの判定用） */
    for (var r = 1; r < d.length; r++) {
      var em0 = String(d[r][4] || '').trim().toLowerCase(); if (!em0) continue;
      var pa0 = d[r][1] instanceof Date ? d[r][1] : new Date(d[r][1]);
      if (isNaN(pa0.getTime())) continue;
      if (dwr_ymd_(pa0) < ymd) beforeByEmail[em0] = 1;
    }
    for (var i = 1; i < d.length; i++) {
      var onum = d[i][0];
      if (onum && seen[onum]) continue;
      if (onum) seen[onum] = true;
      var hasDest = false;
      try { var dj = JSON.parse(d[i][11] || '[]'); hasDest = Array.isArray(dj) && dj.length > 0; } catch (e) {}
      if (!hasDest) continue;
      var em = String(d[i][4] || '').trim().toLowerCase();
      if (em.indexOf('@eda-livestock.com') >= 0) continue;
      var mode = String(d[i][6] || '').toLowerCase();
      if (mode !== 'single' && mode !== 'gift') continue;
      var ps = String(d[i][9] || '').toLowerCase();
      if (ps !== 'paid' && ps !== 'shipped' && ps !== 'delivered') continue;
      var pa = d[i][1] instanceof Date ? d[i][1] : new Date(d[i][1]);
      if (isNaN(pa.getTime()) || dwr_ymd_(pa) !== ymd) continue;

      out.orders++;
      out.revenue += Number(d[i][7]) || 0;
      if (beforeByEmail[em]) out.repeat++; else out.firstTime++;
      var nm = '';
      try { var dd = JSON.parse(d[i][11] || '[]'); nm = (dd[0] && (dd[0].name || dd[0].recipient)) || ''; } catch (e) {}
      if (nm) out.names.push(String(nm));
    }
  }

  var ev = dwr_events_(ymd);
  out.addToCart = ev.addToCartSessions;
  out.beginCheckout = ev.beginCheckoutSessions;
  out.blocked = ev.blocked;
  out.viewItem = ev.viewItem;
  out.msgClick = ev.msgClick;

  var q = ss().getSheetByName('問い合わせ') || ss().getSheetByName('Inquiries');
  if (q) {
    var qd = q.getDataRange().getValues();
    for (var k = 1; k < qd.length; k++) {
      var t = qd[k][0] instanceof Date ? qd[k][0] : new Date(qd[k][0]);
      if (!isNaN(t.getTime()) && dwr_ymd_(t) === ymd) out.inquiries++;
    }
  }
  return out;
}

/* events をその日ぶんだけ末尾から読む */
function dwr_events_(ymd) {
  var out = { addToCartSessions: 0, beginCheckoutSessions: 0, blocked: 0, viewItem: 0, msgClick: 0 };
  var sh = ss().getSheetByName('events'); if (!sh) return out;
  var last = sh.getLastRow(); if (last < 2) return out;
  var cols = sh.getLastColumn();
  var H = sh.getRange(1, 1, 1, cols).getValues()[0].map(function (v) { return String(v || ''); });
  var iTs = H.indexOf('ts'), iType = H.indexOf('event_type'), iSid = H.indexOf('session_id');
  if (iTs < 0 || iType < 0) return out;
  var want = Math.min(dsd_evRows_(), last - 1);
  var vals = sh.getRange(last - want + 1, 1, want, cols).getValues();
  var a = {}, b = {};
  for (var r = vals.length - 1; r >= 0; r--) {
    var ts = dsd_parse_(vals[r][iTs]); if (!ts) continue;
    var day = dwr_ymd_(ts);
    if (day < ymd) break;
    if (day !== ymd) continue;
    var type = String(vals[r][iType] || '');
    var sid = iSid >= 0 ? String(vals[r][iSid] || '') : '';
    if (type === 'add_to_cart')          { if (sid) a[sid] = 1; }
    else if (type === 'begin_checkout')  { if (sid) b[sid] = 1; }
    else if (type === 'checkout_blocked') out.blocked++;
    else if (type === 'view_item')        out.viewItem++;
    else if (type === 'msg_click')        out.msgClick++;
  }
  out.addToCartSessions = Object.keys(a).length;
  out.beginCheckoutSessions = Object.keys(b).length;
  return out;
}

/* ============================================================
   ① 公式LINEで起きたこと（各送信ログの当日行数 / LINE連携）
   ============================================================ */
function dwr_countLogRows_(sheetName, dateCol, ymd) {
  var sh = ss().getSheetByName(sheetName); if (!sh) return 0;
  var d = sh.getDataRange().getValues(); if (d.length < 2) return 0;
  var n = 0;
  for (var r = 1; r < d.length; r++) {
    var t = dsd_parse_(d[r][dateCol]);
    if (t && dwr_ymd_(t) === ymd) n++;
  }
  return n;
}
function dwr_lineStats_(ymd) {
  var out = {};
  out.repeatShip   = dwr_countLogRows_(RSR_LOG_SHEET, 0, ymd);       /* 送料半額_通知ログ */
  out.firstFollow  = dwr_countLogRows_(FDF_LOG_SHEET, 0, ymd);       /* 初回フォロー_送信ログ */
  out.couponRemind = dwr_countLogRows_(FCR_LOG_SHEET, 0, ymd);       /* 初回クーポン_通知ログ */
  out.couponSend   = dwr_countLogRows_(FCR_SEND_SHEET, 0, ymd);      /* 初回クーポン_配布ログ */
  out.cart         = dwr_countLogRows_(CART_SENT_SHEET, 0, ymd);     /* カゴ落ち_送信ログ */
  out.total = out.repeatShip + out.firstFollow + out.couponRemind + out.couponSend + out.cart;

  out.linked = 0;
  var cs = ss().getSheetByName('customers');
  if (cs) {
    var d = cs.getDataRange().getValues();
    var iLink = d[0].map(String).indexOf('linked_at');
    if (iLink >= 0) {
      for (var r = 1; r < d.length; r++) {
        var t = dsd_parse_(d[r][iLink]);
        if (t && dwr_ymd_(t) === ymd) out.linked++;
      }
    }
  }
  return out;
}

/* ============================================================
   ② クロードの作業ログ（作業ログタブ）
   ============================================================ */
function dwr_workLogs_(ymd) {
  var sh = ss().getSheetByName(DWR_LOG_SHEET); if (!sh) return [];
  var d = sh.getDataRange().getValues(); if (d.length < 2) return [];
  var H = d[0].map(function (v) { return String(v || ''); });
  var iD = H.indexOf('日付'), iT = H.indexOf('時刻'), iK = H.indexOf('区分'),
      iW = H.indexOf('やったこと'), iL = H.indexOf('詳細・リンク'), iBy = H.indexOf('記録者');
  var rows = [];
  for (var r = 1; r < d.length; r++) {
    var raw = d[r][iD];
    var day = (raw instanceof Date) ? dwr_ymd_(raw) : String(raw || '').trim().replace(/\//g, '-');
    if (day !== ymd) continue;
    /* 時刻セルは「11:03」と書いても Sheets が時刻値(Date)にすることがある。
       そのまま文字列にすると 1899年の日付が出るので、必ず HH:mm に整える。 */
    var tv = iT >= 0 ? d[r][iT] : '';
    var timeStr = (tv instanceof Date) ? Utilities.formatDate(tv, DSD_TZ, 'HH:mm') : String(tv || '');
    rows.push({
      time: timeStr,
      kind: iK >= 0 ? String(d[r][iK] || '') : '',
      what: iW >= 0 ? String(d[r][iW] || '') : '',
      detail: iL >= 0 ? String(d[r][iL] || '') : '',
      by: iBy >= 0 ? String(d[r][iBy] || '') : ''
    });
  }
  rows.sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
  return rows;
}

/* ============================================================
   本体
   ============================================================ */
function runDailyWorkReport() {
  var now = new Date();
  var ymd = dwr_ymd_(now);
  var ec = {}, line = {}, logs = [], dg = null;
  try { ec = dwr_ecStats_(ymd); }   catch (e) { ec = { error: e.message }; }
  try { line = dwr_lineStats_(ymd); } catch (e) { line = { error: e.message }; }
  try { logs = dwr_workLogs_(ymd); }  catch (e) { logs = []; }
  /* 2026-09-09 田崎さん指示「夜の2通を1つに」＝20時のダイジェストをここに合流させた */
  try { dg = dsd_collect_(); } catch (e) { dg = { error: e.message }; }

  var subject = '【今日やったこと】' + Utilities.formatDate(now, DSD_TZ, 'M月d日') +
                '(' + DSD_WD[Number(Utilities.formatDate(now, DSD_TZ, 'u')) % 7] + ')' +
                ' ご注文 ' + (ec.orders || 0) + '件 ／ 自動配信 ' + (line.total || 0) + '通 ／ 作業 ' + logs.length + '件';
  var html = dwr_html_(now, ec, line, logs, dg);

  if (!dwr_enabled_()) {
    log('workreport_skipped', { reason: 'WORKREPORT_ENABLED=false' });
    return { ok: true, sent: false, note: 'WORKREPORT_ENABLED=false なので送っていません' };
  }
  MailApp.sendEmail({ to: dwr_to_(), name: BRAND_MAIL.sender, subject: subject, htmlBody: html, body: dwr_text_(ec, line, logs, dg) });
  log('workreport_sent', { to: dwr_to_(), orders: ec.orders || 0, line: line.total || 0, logs: logs.length,
                           digest: (dg && dg.cart) ? dg.cart.rows.length : -1 });
  return { ok: true, sent: true, orders: ec.orders || 0, lineSends: line.total || 0, logs: logs.length };
}

function dwr_html_(now, ec, line, logs, dg) {
  var G = '#0F3D2E', LINE_ = '#ece8dc', SUB = '#7c8a83';
  var th = 'padding:8px 10px;background:' + G + ';color:#fff;font-size:12px;text-align:left;white-space:nowrap;';
  var td = 'padding:8px 10px;border-bottom:1px solid ' + LINE_ + ';font-size:13px;vertical-align:top;';
  var tdN = td + 'text-align:right;white-space:nowrap;font-weight:bold;';
  var h = [];

  h.push('<div style="font-family:sans-serif;max-width:860px;margin:0 auto;padding:16px;color:#1a1a1a;">');
  h.push('<div style="font-size:12px;color:' + SUB + ';">' + dsd_esc_(Utilities.formatDate(now, DSD_TZ, 'yyyy年M月d日')) +
         '(' + DSD_WD[Number(Utilities.formatDate(now, DSD_TZ, 'u')) % 7] + ') ' +
         Utilities.formatDate(now, DSD_TZ, 'HH:mm') + ' 時点</div>');
  h.push('<h2 style="margin:6px 0 16px;font-size:19px;">今日やったこと</h2>');

  /* --- ① EC --- */
  h.push('<div style="margin:0 0 6px;font-size:15px;font-weight:bold;">EC（ネットショップ）で起きたこと</div>');
  h.push('<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">');
  h.push('<tr><th style="' + th + '">項目</th><th style="' + th + 'text-align:right;">今日</th><th style="' + th + '">中身</th></tr>');
  var nameList = (ec.names && ec.names.length) ? ec.names.slice(0, 8).join('・') + (ec.names.length > 8 ? ' ほか' : '') : '—';
  h.push('<tr><td style="' + td + '">ご注文</td><td style="' + tdN + '">' + (ec.orders || 0) + ' 件</td><td style="' + td + 'color:' + SUB + ';font-size:12px;">' + dsd_esc_(nameList) + '</td></tr>');
  h.push('<tr><td style="' + td + '">売上（税込・単品とギフト）</td><td style="' + tdN + '">' + dsd_esc_(dsd_yen_(ec.revenue || 0)) + '</td><td style="' + td + 'color:' + SUB + ';font-size:12px;">定期便は含みません</td></tr>');
  h.push('<tr><td style="' + td + '">はじめての方 / 2回目以降</td><td style="' + tdN + '">' + (ec.firstTime || 0) + ' / ' + (ec.repeat || 0) + ' 人</td><td style="' + td + 'color:' + SUB + ';font-size:12px;">同じメールアドレスでの過去のご注文で判定</td></tr>');
  h.push('<tr><td style="' + td + '">商品ページを見た回数</td><td style="' + tdN + '">' + (ec.viewItem || 0) + '</td><td style="' + td + '"></td></tr>');
  h.push('<tr><td style="' + td + '">カートに入れた人</td><td style="' + tdN + '">' + (ec.addToCart || 0) + ' 人</td><td style="' + td + 'color:' + SUB + ';font-size:12px;">決済まで進んだ人 ' + (ec.beginCheckout || 0) + ' 人</td></tr>');
  h.push('<tr><td style="' + td + '">決済でつまずいた回数</td><td style="' + tdN + '">' + (ec.blocked || 0) + '</td><td style="' + td + 'color:' + SUB + ';font-size:12px;">未入力・在庫切れ・規約未同意など</td></tr>');
  h.push('<tr><td style="' + td + '">お問い合わせ</td><td style="' + tdN + '">' + (ec.inquiries || 0) + ' 件</td><td style="' + td + '"></td></tr>');
  h.push('</table>');

  /* --- ① 公式LINE --- */
  h.push('<div style="margin:0 0 6px;font-size:15px;font-weight:bold;">公式LINEで起きたこと</div>');
  h.push('<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">');
  h.push('<tr><th style="' + th + '">項目</th><th style="' + th + 'text-align:right;">今日</th><th style="' + th + '">中身</th></tr>');
  h.push('<tr><td style="' + td + '">自動でお送りしたメッセージ</td><td style="' + tdN + '">' + (line.total || 0) + ' 通</td>' +
         '<td style="' + td + 'color:' + SUB + ';font-size:12px;">送料半額 ' + (line.repeatShip || 0) + '／ご感想 ' + (line.firstFollow || 0) +
         '／初回クーポン ' + ((line.couponRemind || 0) + (line.couponSend || 0)) + '／カゴ落ち ' + (line.cart || 0) + '</td></tr>');
  h.push('<tr><td style="' + td + '">配信リンクが押された回数</td><td style="' + tdN + '">' + (ec.msgClick || 0) + '</td><td style="' + td + '"></td></tr>');
  h.push('<tr><td style="' + td + '">LINEとお店をつないだ人</td><td style="' + tdN + '">' + (line.linked || 0) + ' 人</td><td style="' + td + 'color:' + SUB + ';font-size:12px;">連携するとお名前と購入履歴がつながります</td></tr>');
  h.push('</table>');

  /* --- ② 作業ログ --- */
  h.push('<div style="margin:24px 0 6px;font-size:15px;font-weight:bold;">クロードがやった作業</div>');
  if (!logs.length) {
    h.push('<div style="font-size:13px;color:' + SUB + ';">今日は記録がありません（作業がなかった日か、まだ書けていない日です）</div>');
  } else {
    h.push('<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">');
    h.push('<tr><th style="' + th + '">時刻</th><th style="' + th + '">区分</th><th style="' + th + '">やったこと</th><th style="' + th + '">詳細</th></tr>');
    logs.forEach(function (x) {
      h.push('<tr><td style="' + td + 'white-space:nowrap;color:' + SUB + ';font-size:12px;">' + dsd_esc_(x.time) + '</td>' +
             '<td style="' + td + 'white-space:nowrap;">' + dsd_esc_(x.kind) + '</td>' +
             '<td style="' + td + '">' + dsd_esc_(x.what) + '</td>' +
             '<td style="' + td + 'color:' + SUB + ';font-size:12px;">' + dsd_esc_(x.detail) + '</td></tr>');
    });
    h.push('</table>');
  }

  /* --- ③ 自動配信の名簿（旧・20時のメール。2026-09-09にここへ統合）--- */
  h.push('<div style="margin:28px 0 2px;padding-top:18px;border-top:2px solid ' + G + ';font-size:15px;font-weight:bold;">公式LINE（自動）で誰に何が飛んだか</div>');
  h.push('<div style="font-size:12px;color:' + SUB + ';margin-bottom:16px;">判定は実際に送るプログラムと同じものを通しています。止めたい場合はスイッチをOFFにしてください。</div>');
  if (!dg || dg.error) {
    h.push('<div style="font-size:13px;color:#b3261e;">名簿を作れませんでした' + (dg && dg.error ? '（' + dsd_esc_(dg.error) + '）' : '') + '</div>');
  } else {
    h.push(dsd_sectionsHtml_(dg.plans, dg.cart, dg.names));
  }

  h.push('<div style="margin-top:22px;padding-top:12px;border-top:1px solid ' + LINE_ + ';font-size:11px;color:' + SUB + ';line-height:1.7;">');
  h.push('※ 上の2つの表は、システムが記録している事実をそのまま数えたものです（人の手は入りません）。<br>');
  h.push('※ 売上は税込・単品とギフトのみ。定期便と社内の注文は入れていません。<br>');
  h.push('※「クロードがやった作業」は、本番EC注文DBの「作業ログ」タブに書いた行です。EC・公式LINEに限らず、ふるさと納税・牛舎・営業・経理など、その日にやったことは区分を付けてすべてここに出ます。<br>');
  h.push('※ LINEに「既読・未読」を取る仕組みはありません（LINE側が出していない）。代わりに配信リンクを押したかどうかを「リンク」列に出しています。<br>');
  h.push('※「カートに残っている」は、送ったあとに購入もカートからの削除も記録されていない状態です。買ってくださった方はこの表には出しません。<br>');
  h.push('※ このメールは毎晩21時の1通だけです。2026年9月9日から、20時に別便で届いていた「自動配信の名簿」をこのメールに統合しました（元に戻すなら setDigestMergedOff）。');
  h.push('</div></div>');
  return h.join('');
}

function dwr_text_(ec, line, logs, dg) {
  var t = [];
  t.push('■ EC（ネットショップ）');
  t.push('  ご注文 ' + (ec.orders || 0) + '件 / 売上 ' + dsd_yen_(ec.revenue || 0) +
         ' / はじめての方 ' + (ec.firstTime || 0) + '・2回目以降 ' + (ec.repeat || 0));
  t.push('  カートに入れた人 ' + (ec.addToCart || 0) + ' / 決済まで進んだ人 ' + (ec.beginCheckout || 0) +
         ' / 決済でつまずいた回数 ' + (ec.blocked || 0) + ' / お問い合わせ ' + (ec.inquiries || 0));
  t.push('■ 公式LINE');
  t.push('  自動送信 ' + (line.total || 0) + '通（送料半額 ' + (line.repeatShip || 0) + '／ご感想 ' + (line.firstFollow || 0) +
         '／初回クーポン ' + ((line.couponRemind || 0) + (line.couponSend || 0)) + '／カゴ落ち ' + (line.cart || 0) + '）');
  t.push('  リンククリック ' + (ec.msgClick || 0) + ' / LINE連携 ' + (line.linked || 0) + '人');
  t.push('■ クロードがやった作業');
  if (!logs.length) t.push('  記録なし');
  logs.forEach(function (x) { t.push('  - ' + x.time + ' [' + x.kind + '] ' + x.what + (x.detail ? ' / ' + x.detail : '')); });
  t.push('');
  t.push('===== 公式LINE（自動）で誰に何が飛んだか =====');
  if (!dg || dg.error) t.push('  名簿を作れませんでした' + (dg && dg.error ? '（' + dg.error + '）' : ''));
  else t.push(dsd_text_(dg.plans, dg.cart, dg.names));
  return t.join('\n');
}
