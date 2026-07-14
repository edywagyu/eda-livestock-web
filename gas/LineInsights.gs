/* ============================================================
   📊 LINE Insights → 専用スプレッド 自動書き出し
   ------------------------------------------------------------
   公式LINEの数値(友だち数/配信実績/属性)を Messaging API Insight から取得し、
   専用スプレッド(Script Property LINE_INSIGHTS_SHEET_ID)へ日次で書き出す。
   SHIPPING_SHEET_ID と同じ「別スプシ＋時刻トリガー」パターン。本番注文DBには書かない。

   セットアップ(1回だけ GAS エディタで実行):
     setupLineInsights()  → 専用スプシ作成・ID保存・田崎/Tom共有・日次7時トリガー設置・初回書出。返り値=URL。
   手動更新(いつでも):
     GET ?action=line_insights_now&token=... (STAFF_PROTECTED) → その場で最新取得
   自動更新:
     日次トリガー writeLineInsights が毎朝7時(JST)に実行。

   注意: LINE の日別データは確定に1〜3日ラグ → 過去 BACKFILL 日分を毎回取り直して upsert。
   トークンは cfg('LINE_CHANNEL_TOKEN') を参照(再発行不要・既存を共用)。
   ============================================================ */

var LINE_INSIGHTS_TZ = 'Asia/Tokyo';
var LINE_INSIGHTS_BACKFILL = 4;   // 何日前まで遡って埋め直すか
var LINE_INSIGHTS_TAB_FOLLOWERS = '友だち推移';
var LINE_INSIGHTS_TAB_DELIVERY  = '配信実績';
var LINE_INSIGHTS_TAB_DEMO      = '属性';

/* 日次トリガーの本体。専用スプシへ最新の数値を書き込む。返り値=結果サマリ文字列。 */
function writeLineInsights() {
  try {
    var id = PROPS.getProperty('LINE_INSIGHTS_SHEET_ID');
    if (!id) return 'no_sheet_id';           // 先に setupLineInsights() を実行
    if (!cfg('LINE_CHANNEL_TOKEN')) return 'no_token';
    var book = SpreadsheetApp.openById(id);

    var days = 0;
    var today = new Date();
    for (var i = LINE_INSIGHTS_BACKFILL; i >= 1; i--) {
      var d = new Date(today.getTime() - i * 86400000);
      var ymd = Utilities.formatDate(d, LINE_INSIGHTS_TZ, 'yyyyMMdd');
      if (upsertLineFollowers_(book, ymd)) days++;
      upsertLineDelivery_(book, ymd);
    }
    snapshotLineDemographic_(book);
    return 'ok:' + days + '_days';
  } catch (e) {
    log('line_insights_error', { error: e.message });
    return 'error:' + e.message;
  }
}

/* 初回セットアップ(冪等)。専用スプシを作成→ID保存→編集者共有→日次トリガー設置→初回書出。返り値=URL。 */
function setupLineInsights() {
  var id = PROPS.getProperty('LINE_INSIGHTS_SHEET_ID');
  var book;
  if (id) {
    book = SpreadsheetApp.openById(id);
  } else {
    book = SpreadsheetApp.create('★公式LINE数値（自動更新）');
    PROPS.setProperty('LINE_INSIGHTS_SHEET_ID', book.getId());
    ['tomoki@eda-livestock.com', 'r.tasaki@eda-livestock.com'].forEach(function (mail) {
      try { DriveApp.getFileById(book.getId()).addEditor(mail); } catch (e) {}
    });
  }
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'writeLineInsights';
  });
  if (!has) {
    ScriptApp.newTrigger('writeLineInsights').timeBased().everyDays(1).atHour(7).inTimezone(LINE_INSIGHTS_TZ).create();
  }
  writeLineInsights();
  return book.getUrl();
}

/* GET ?action=line_insights_now — その場で最新取得(手動更新ボタン用)。 */
function lineInsightsNow() {
  var r = writeLineInsights();
  var id = PROPS.getProperty('LINE_INSIGHTS_SHEET_ID');
  var url = id ? SpreadsheetApp.openById(id).getUrl() : null;
  return jsonResponse({ ok: r.indexOf('ok') === 0, result: r, url: url });
}

/* ---------- 各数値の書き込み ---------- */

/* 友だち数(日別) GET /v2/bot/insight/followers?date=yyyyMMdd */
function upsertLineFollowers_(book, ymd) {
  var res = lineInsightFetch_('/v2/bot/insight/followers?date=' + ymd);
  if (!res || res.status !== 'ready') return false;    // 未確定の日はスキップ
  var sh = getInsightSheet_(book, LINE_INSIGHTS_TAB_FOLLOWERS,
    ['日付', '友だち数(targetedReaches)', '累計(followers)', 'ブロック(blocks)', '更新']);
  upsertByDate_(sh, fmtYmd_(ymd), [
    fmtYmd_(ymd), num_(res.targetedReaches), num_(res.followers), num_(res.blocks), nowStamp_()
  ]);
  return true;
}

/* 配信実績(日別) GET /v2/bot/insight/message/delivery?date=yyyyMMdd */
function upsertLineDelivery_(book, ymd) {
  var res = lineInsightFetch_('/v2/bot/insight/message/delivery?date=' + ymd);
  if (!res || res.status !== 'ready') return false;
  var sh = getInsightSheet_(book, LINE_INSIGHTS_TAB_DELIVERY,
    ['日付', 'ブロードキャスト', 'ターゲティング', '自動応答', 'あいさつ',
     'API push', 'API multicast', 'API narrowcast', 'API broadcast', '更新']);
  upsertByDate_(sh, fmtYmd_(ymd), [
    fmtYmd_(ymd), num_(res.broadcast), num_(res.targeting), num_(res.autoResponse), num_(res.welcomeResponse),
    num_(res.apiPush), num_(res.apiMulticast), num_(res.apiNarrowcast), num_(res.apiBroadcast), nowStamp_()
  ]);
  return true;
}

/* 属性(実行時点スナップショット) GET /v2/bot/insight/demographic */
function snapshotLineDemographic_(book) {
  var res = lineInsightFetch_('/v2/bot/insight/demographic');
  if (!res || res.available !== true) return false;    // 対象20人未満などで非公開のことがある
  var sh = getInsightSheet_(book, LINE_INSIGHTS_TAB_DEMO, ['取得日', '区分', '項目', '割合(%)']);
  var stamp = Utilities.formatDate(new Date(), LINE_INSIGHTS_TZ, 'yyyy-MM-dd');
  var rows = [];
  pushDemo_(rows, stamp, '性別', res.genders, 'gender');
  pushDemo_(rows, stamp, '年代', res.ages, 'age');
  pushDemo_(rows, stamp, '地域', res.areas, 'area');
  pushDemo_(rows, stamp, '利用OS', res.appTypes, 'appType');
  pushDemo_(rows, stamp, '登録期間', res.subscriptionPeriods, 'subscriptionPeriod');
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  return true;
}

function pushDemo_(rows, stamp, label, arr, key) {
  if (!arr) return;
  for (var i = 0; i < arr.length; i++) {
    rows.push([stamp, label, String(arr[i][key]), Math.round((arr[i].percentage || 0) * 10) / 10]);
  }
}

/* ---------- ヘルパー ---------- */

/* LINE Insight GET 共通(cfg トークン)。200以外は null。 */
function lineInsightFetch_(path) {
  var token = cfg('LINE_CHANNEL_TOKEN');
  if (!token) return null;
  var res = UrlFetchApp.fetch('https://api.line.me' + path, {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    log('line_insight_http', { path: path, code: res.getResponseCode(), body: res.getContentText().slice(0, 300) });
    return null;
  }
  try { return JSON.parse(res.getContentText() || '{}'); } catch (e) { return null; }
}

/* 専用スプシ内のタブ取得(無ければヘッダー付きで作成)。 */
function getInsightSheet_(book, name, headers) {
  var sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // create() 時の既定「シート1」を掃除(タブが増えたら1回だけ)
    var def = book.getSheetByName('シート1') || book.getSheetByName('Sheet1');
    if (def && book.getSheets().length > 1) { try { book.deleteSheet(def); } catch (e) {} }
  }
  return sh;
}

/* 同じ日付の行があれば上書き、無ければ追記(日別データが後日確定するため)。 */
function upsertByDate_(sh, dateKey, row) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var dates = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (var i = 0; i < dates.length; i++) {
      if (dates[i][0] === dateKey) {
        sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sh.getRange(last + 1, 1, 1, row.length).setValues([row]);
}

function fmtYmd_(ymd) { return ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8); }
function num_(v) { return (typeof v === 'number') ? v : 0; }
function nowStamp_() { return Utilities.formatDate(new Date(), LINE_INSIGHTS_TZ, 'yyyy-MM-dd HH:mm'); }
