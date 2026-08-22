/* ============================================================
   クリック計測ダッシュボード生成 (2026-07-27)
   ------------------------------------------------------------
   events タブの msg_click(配信) / src_click(リッチメニュー等) を集計し、
   customers タブの line_uid→line_name で「誰が」を解決して、
   管理用の2タブを生成/更新する:
     ・「クリック_明細」… 1クリック=1行 (日時/種別/リンク/LINE名/曜日/時刻…)
     ・「クリック_サマリ」… 人別・リンク別・曜日別・時間帯別の集計
   実行: メニュー「📊 クリック集計」→「今すぐ更新」 (or buildClickDashboard を直接実行)
   自動更新したい場合は installClickDashboardTrigger() を1回実行 (1時間毎)。
   読むだけ・既存データは変更しない。GAS Webアプリ本体とは独立。
   ============================================================ */

var CLICK_SS_ID   = '1k98VW296Quw7F9-HqFNwtGKxfySGjdAA-FE1vobX3Nk'; // 本番EC DB
var CLICK_DOW_JP  = ['日', '月', '火', '水', '木', '金', '土'];
var CLICK_DETAIL  = 'クリック_明細';
var CLICK_SUMMARY = 'クリック_サマリ';

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('📊 クリック集計')
      .addItem('今すぐ更新', 'buildClickDashboard')
      .addItem('自動更新をON (1時間毎)', 'installClickDashboardTrigger')
      .addToUi();
  } catch (e) {}
}

function _clickSS() { return SpreadsheetApp.openById(CLICK_SS_ID); }

/* customers: line_uid → line_name のマップ */
function _lineNameMap(ss) {
  var map = {};
  var sh = ss.getSheetByName('customers');
  if (!sh) return map;
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return map;
  var h = data[0];
  var iUid = h.indexOf('line_uid'), iName = h.indexOf('line_name');
  if (iUid < 0) return map;
  for (var r = 1; r < data.length; r++) {
    var uid = String(data[r][iUid] || '').trim();
    if (!uid) continue;
    var name = iName >= 0 ? String(data[r][iName] || '').trim() : '';
    if (name || !map[uid]) map[uid] = name;
  }
  return map;
}

function _parseMeta(s) {
  try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; }
}

function buildClickDashboard() {
  var ss = _clickSS();
  var ev = ss.getSheetByName('events');
  if (!ev) throw new Error('events タブが見つかりません');
  var data = ev.getDataRange().getValues();
  var h = data[0] || [];
  var iTs   = h.indexOf('ts');        if (iTs   < 0) iTs = 0;
  var iType = h.indexOf('event_type'); if (iType < 0) iType = 1;
  var iSid  = h.indexOf('session_id'); if (iSid  < 0) iSid = 2;
  var iPage = h.indexOf('page');       if (iPage < 0) iPage = 3;
  var iPid  = h.indexOf('product_id'); if (iPid  < 0) iPid = 4;
  var iMeta = h.indexOf('meta_json');  if (iMeta < 0) iMeta = 8;

  var nameMap = _lineNameMap(ss);

  var rows = [];            // 明細
  var byUid = {};           // 人別集計
  var byLink = {};          // リンク別集計
  var byDow = [0,0,0,0,0,0,0];
  var byHour = new Array(24).fill(0);

  for (var r = 1; r < data.length; r++) {
    var type = String(data[r][iType] || '');
    if (type !== 'msg_click' && type !== 'src_click') continue;

    var ts = new Date(data[r][iTs]);
    if (isNaN(ts.getTime())) continue;
    var meta = _parseMeta(data[r][iMeta]);
    var sid = String(data[r][iSid] || '');

    // dev/テスト行は除外
    if (meta.src === 'trial-curl' || meta.src === 'browser-trial' || sid.indexOf('trial') === 0) continue;

    var kind = (type === 'msg_click') ? '配信' : 'メニュー';
    var campaign = (type === 'msg_click') ? (meta.msg || data[r][iPage] || '') : (meta.src || '');
    var link = meta.l || data[r][iPid] || '';
    /* uid のキーは経路で違う。c.html(msg_click) は meta.uid、
       analytics.js(src_click) は send() が自動添付する meta.line_uid。両方見る。 */
    var uid = meta.line_uid || meta.uid || '';
    var name = uid ? (nameMap[uid] || '(名前未取得)') : '(未連携)';
    var dow = ts.getDay();
    var hour = ts.getHours();
    var dest = meta.to || String(data[r][iPage] || '');

    rows.push([ts, kind, campaign, link, name, CLICK_DOW_JP[dow], hour, dest, uid, sid]);

    byDow[dow]++;
    byHour[hour]++;
    if (link) {
      if (!byLink[link]) byLink[link] = { clicks: 0, users: {} };
      byLink[link].clicks++;
      if (uid) byLink[link].users[uid] = true;
    }
    var key = uid || ('(未連携)#' + sid);
    if (!byUid[key]) byUid[key] = { name: name, uid: uid, clicks: 0, last: ts, dow: [0,0,0,0,0,0,0], hour: new Array(24).fill(0) };
    var b = byUid[key];
    b.clicks++;
    if (ts > b.last) b.last = ts;
    b.dow[dow]++; b.hour[hour]++;
  }

  // 新しい順
  rows.sort(function (a, b) { return b[0] - a[0]; });

  /* ---- 明細タブ ---- */
  var det = ss.getSheetByName(CLICK_DETAIL) || ss.insertSheet(CLICK_DETAIL);
  det.clear();
  var detHeader = ['日時', '種別', '配信/メニュー', 'リンク', 'LINE名', '曜日', '時刻', '転送先', 'uid', 'session'];
  det.getRange(1, 1, 1, detHeader.length).setValues([detHeader]).setFontWeight('bold').setBackground('#0F3D2E').setFontColor('#ffffff');
  if (rows.length) det.getRange(2, 1, rows.length, detHeader.length).setValues(rows);
  det.getRange(2, 1, Math.max(rows.length, 1), 1).setNumberFormat('yyyy/MM/dd HH:mm');
  det.setFrozenRows(1);
  det.autoResizeColumns(1, detHeader.length);

  /* ---- サマリタブ ---- */
  var sum = ss.getSheetByName(CLICK_SUMMARY) || ss.insertSheet(CLICK_SUMMARY);
  sum.clear();
  var out = [];
  out.push(['📊 クリック集計サマリ', '', '', '', '']);
  out.push(['更新: ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') + ' / 総クリック ' + rows.length + '件', '', '', '', '']);
  out.push(['', '', '', '', '']);

  // 人別
  out.push(['■ 人別 (クリックが多い順)', '', '', '', '']);
  out.push(['LINE名', 'クリック数', '最終クリック', 'よく押す曜日', 'よく押す時間帯']);
  var people = Object.keys(byUid).map(function (k) { return byUid[k]; });
  people.sort(function (a, b) { return b.clicks - a.clicks; });
  people.forEach(function (p) {
    var topDow = p.dow.indexOf(Math.max.apply(null, p.dow));
    var topHour = p.hour.indexOf(Math.max.apply(null, p.hour));
    out.push([
      p.name, p.clicks,
      Utilities.formatDate(p.last, 'Asia/Tokyo', 'MM/dd HH:mm'),
      CLICK_DOW_JP[topDow] + '曜',
      topHour + '時台'
    ]);
  });
  out.push(['', '', '', '', '']);

  // リンク別
  out.push(['■ リンク別', '', '', '', '']);
  out.push(['リンク', 'クリック数', 'ユニーク人数', '', '']);
  Object.keys(byLink).sort(function (a, b) { return byLink[b].clicks - byLink[a].clicks; }).forEach(function (l) {
    out.push([l, byLink[l].clicks, Object.keys(byLink[l].users).length, '', '']);
  });
  out.push(['', '', '', '', '']);

  // 曜日別
  out.push(['■ 曜日別', '', '', '', '']);
  out.push(['曜日', 'クリック数', '', '', '']);
  for (var d = 0; d < 7; d++) out.push([CLICK_DOW_JP[d] + '曜', byDow[d], '', '', '']);
  out.push(['', '', '', '', '']);

  // 時間帯別
  out.push(['■ 時間帯別', '', '', '', '']);
  out.push(['時刻', 'クリック数', '', '', '']);
  for (var hh = 0; hh < 24; hh++) { if (byHour[hh]) out.push([hh + '時台', byHour[hh], '', '', '']); }

  sum.getRange(1, 1, out.length, 5).setValues(out);
  sum.getRange(1, 1, 1, 5).merge().setFontWeight('bold').setFontSize(13).setBackground('#0F3D2E').setFontColor('#ffffff');
  sum.setColumnWidth(1, 200);
  sum.setColumnWidth(3, 130);

  SpreadsheetApp.flush();
  return '明細 ' + rows.length + '行 / 人別 ' + people.length + '名 を更新しました';
}

/* 1時間毎に自動更新するトリガーを1回だけ設定 */
function installClickDashboardTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'buildClickDashboard'; });
  if (exists) { try { SpreadsheetApp.getUi().alert('自動更新は既にONです'); } catch (e) {} return 'already'; }
  ScriptApp.newTrigger('buildClickDashboard').timeBased().everyHours(1).create();
  try { SpreadsheetApp.getUi().alert('自動更新をONにしました (1時間毎)'); } catch (e) {}
  return 'installed';
}
