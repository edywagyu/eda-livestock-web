/* ============================================================
   📊 LINE Insights → SNS運用管理スプレッド 自動書き出し
   ------------------------------------------------------------
   公式LINEの数値(友だち数/配信実績/属性)を Messaging API Insight から取得し、
   既存の「SNS運用管理シート」へ日次で書き出す。
   本番注文DBには一切書かない（別ブックへ書き込む）。

   書き込み先タブ（2026-08-21 変更）:
     ・「友達推移」    … 既存タブに直接書く。新規タブは作らない。
                        手入力で運用していた 友達数(累計)/ターゲットリーチ/ブロック数 を
                        API の値で埋める。当日純増・ブロック率・月 は既存の数式のまま。
     ・「LINE属性」    … 新規タブ（既存に相当タブが無い）。性別/年代/地域/OS/登録期間。
     ・「LINE配信実績_日別API」… 新規タブ。**手管理の「LINE配信ログ」とは別物**なので
                        名前で区別する。あちらは 1配信=1行（本文・狙い・開封率つき）、
                        こちらは LINE API が返す「その日に何通送ったか」の日別カウント。

   ⚠️ 「友達推移」は384行の履歴を手で育ててきた実データ。壊さないための約束:
        1. 自分が持つ列（日付・友達数(累計)・ターゲットリーチ・ブロック数）だけを書く。
           当日純増/ブロック率/月 など数式の列には触れない。
        2. 行の一括クリア・並べ替えはしない。
        3. 新しい日付は「一番上（ヘッダーの直下）」に行を挿入する（この表は降順）。
           挿入した行の数式列は、直下の行から copyTo(FORMULA) で引き継ぐ。
        4. ヘッダー行の位置と列順は決め打ちせず、実行時に '日付' を探して特定する。
           列を足したり並べ替えても壊れない。

   書き込み先ブック:
     Script Property LINE_INSIGHTS_SHEET_ID があればそれ、無ければ下記デフォルト
     （= SNS運用管理シート）。将来別ブックに移すならプロパティを設定するだけ。
   ⚠️ 前提: GAS を実行するアカウント(トリガー作成者/デプロイ所有者)が、この
      スプレッドの「編集者」である必要があります（未共有だと書き込み権限エラー）。

   セットアップ(反映後1回だけ実行):
     setupLineInsights()  → 日次7時トリガー設置＋初回書出。返り値=対象スプシURL。
   下見(書き込まない):
     dryRunLineInsights() → API から取れる値と、書き込み先の行・列を返すだけ。
                            本番シートに触る前にこれで確認する。
   手動更新(いつでも):
     GET ?action=line_insights_now&token=... (STAFF_PROTECTED)
   自動更新:
     日次トリガー writeLineInsights が毎朝7時(JST)。

   注意: LINE の日別データは確定に1〜3日ラグ → 過去 BACKFILL 日分を毎回 upsert。
   トークンは cfg('LINE_CHANNEL_TOKEN') を参照(再発行不要・既存を共用)。
   ============================================================ */

// SNS運用管理シート（既存・ユーザー管理）。プロパティ未設定時の既定の書き込み先。
var LINE_INSIGHTS_SHEET_ID_DEFAULT = '1KKCIYgWr2rvESSXTcsuqlAFDs0WlRX0j9A79l2iZut4';

var LINE_INSIGHTS_TZ = 'Asia/Tokyo';
var LINE_INSIGHTS_BACKFILL = 4;   // 何日前まで遡って埋め直すか

/* 既存タブ。名前を変えない＝ここを間違えると別タブを汚す。 */
var LINE_INSIGHTS_TAB_FOLLOWERS = '友達推移';
/* 新規タブ（既存に相当なし）。配信実績は手管理の「LINE配信ログ」と紛れないよう別名。 */
var LINE_INSIGHTS_TAB_DELIVERY  = 'LINE配信実績_日別API';
var LINE_INSIGHTS_TAB_DEMO      = 'LINE属性';

/* 「友達推移」でこのスクリプトが書いてよい列。ヘッダー文字列で引く。
   ここに無い列（当日純増・ブロック率・月）は既存の数式なので触らない。 */
var LINE_FOLLOWERS_COLS = [
  { header: 'ターゲットリーチ(アクティブ)', key: 'targetedReaches' },
  { header: '友達数(累計)',                 key: 'followers' },
  { header: 'ブロック数',                   key: 'blocks' }
];

/* 書き込み先ブックのID（プロパティ優先・無ければSNS運用管理シート）。 */
function lineInsightsBookId_() {
  return PROPS.getProperty('LINE_INSIGHTS_SHEET_ID') || LINE_INSIGHTS_SHEET_ID_DEFAULT;
}

/* 日次トリガーの本体。対象スプシへ最新の数値を書き込む。返り値=結果サマリ文字列。 */
function writeLineInsights() {
  try {
    if (!cfg('LINE_CHANNEL_TOKEN')) return 'no_token';
    var book = SpreadsheetApp.openById(lineInsightsBookId_());

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

/* 初回セットアップ(冪等)。日次トリガー設置→初回書出。返り値=対象スプシURL。
   ※書き込み先は既存のSNS運用管理シート（新規作成はしない）。 */
function setupLineInsights() {
  var book = SpreadsheetApp.openById(lineInsightsBookId_());   // 権限が無ければここで例外＝共有漏れを検知
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'writeLineInsights';
  });
  if (!has) {
    ScriptApp.newTrigger('writeLineInsights').timeBased().everyDays(1).atHour(7).inTimezone(LINE_INSIGHTS_TZ).create();
  }
  writeLineInsights();
  return book.getUrl();
}

/* 下見。**一切書き込まない**。本番の「友達推移」に触る前にこれで確認する。
   ・API から実際に返ってくる値
   ・「友達推移」のヘッダー行が何行目で、どの列に書くつもりか
   ・その日付が既存行の上書きになるのか、新規挿入になるのか */
function dryRunLineInsights() {
  var out = { book: lineInsightsBookId_(), token: !!cfg('LINE_CHANNEL_TOKEN'), days: [] };
  if (!out.token) { out.error = 'LINE_CHANNEL_TOKEN 未設定'; return out; }

  var book = SpreadsheetApp.openById(lineInsightsBookId_());
  var sh = book.getSheetByName(LINE_INSIGHTS_TAB_FOLLOWERS);
  if (!sh) { out.error = '「' + LINE_INSIGHTS_TAB_FOLLOWERS + '」タブが見つからない'; return out; }

  var L = followersLayout_(sh);
  out.layout = {
    tab: LINE_INSIGHTS_TAB_FOLLOWERS,
    headerRow: L.headerRow,
    dateCol: L.dateCol,
    writeCols: L.cols.map(function (c) { return c.header + '=' + c.col; }),
    skipped: L.missing
  };

  var today = new Date();
  for (var i = LINE_INSIGHTS_BACKFILL; i >= 1; i--) {
    var d = new Date(today.getTime() - i * 86400000);
    var ymd = Utilities.formatDate(d, LINE_INSIGHTS_TZ, 'yyyyMMdd');
    var res = lineInsightFetch_('/v2/bot/insight/followers?date=' + ymd);
    var key = followersDateKey_(sh, L, d);
    out.days.push({
      date: key,
      status: res ? res.status : 'fetch_failed',
      followers: res && res.followers,
      targetedReaches: res && res.targetedReaches,
      blocks: res && res.blocks,
      action: (!res || res.status !== 'ready') ? 'skip(未確定)'
            : (findDateRow_(sh, L, key) > 0 ? '既存行を上書き(row ' + findDateRow_(sh, L, key) + ')'
                                            : '新規行を挿入(降順の正しい位置。日付順で決まる)')
    });
  }
  return out;
}

/* GET ?action=line_insights_now — その場で最新取得(手動更新ボタン用)。 */
function lineInsightsNow() {
  var r = writeLineInsights();
  var url = SpreadsheetApp.openById(lineInsightsBookId_()).getUrl();
  return jsonResponse({ ok: r.indexOf('ok') === 0, result: r, url: url });
}

/* ---------- 「友達推移」への書き込み ---------- */

/* ヘッダー行・列位置を実行時に特定する。決め打ちしない＝列を足されても壊れない。
   ヘッダー行 = 先頭10行のうち '日付' を含む最初の行。 */
function followersLayout_(sh) {
  var probe = sh.getRange(1, 1, Math.min(10, sh.getLastRow()), sh.getLastColumn()).getDisplayValues();
  var headerRow = -1, dateCol = -1;
  for (var r = 0; r < probe.length && headerRow < 0; r++) {
    for (var c = 0; c < probe[r].length; c++) {
      if (String(probe[r][c]).trim() === '日付') { headerRow = r + 1; dateCol = c + 1; break; }
    }
  }
  if (headerRow < 0) throw new Error('「' + LINE_INSIGHTS_TAB_FOLLOWERS + '」に「日付」列が見つからない（レイアウト変更?）');

  var headers = probe[headerRow - 1];
  var cols = [], missing = [];
  LINE_FOLLOWERS_COLS.forEach(function (spec) {
    var idx = -1;
    for (var c = 0; c < headers.length; c++) {
      if (normHeader_(headers[c]) === normHeader_(spec.header)) { idx = c + 1; break; }
    }
    if (idx > 0) cols.push({ header: spec.header, key: spec.key, col: idx });
    else missing.push(spec.header);   // 見つからない列は黙って飛ばす（勝手に作らない）
  });
  return { headerRow: headerRow, dateCol: dateCol, cols: cols, missing: missing };
}

/* ヘッダー照合用の正規化。全角/半角のカッコ差・空白・改行を吸収する
   （「ターゲットリーチ(アクティブ)」が全角カッコで書き直されても拾えるように）。 */
function normHeader_(s) {
  return String(s == null ? '' : s)
    .replace(/[（）]/g, function (m) { return m === '（' ? '(' : ')'; })
    .replace(/\s+/g, '')
    .trim();
}

/* 既存行の日付表記に合わせたキー文字列を作る（この表は 2026/08/19 形式）。
   1行目のデータの見た目から書式を推定し、合わなければ yyyy/MM/dd を使う。 */
function followersDateKey_(sh, L, dateObj) {
  var fmt = 'yyyy/MM/dd';
  if (sh.getLastRow() > L.headerRow) {
    var sample = String(sh.getRange(L.headerRow + 1, L.dateCol).getDisplayValue()).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) fmt = 'yyyy-MM-dd';
  }
  return Utilities.formatDate(dateObj, LINE_INSIGHTS_TZ, fmt);
}

/* 同じ日付の行番号。無ければ 0。 */
function findDateRow_(sh, L, dateKey) {
  var last = sh.getLastRow();
  if (last <= L.headerRow) return 0;
  var vals = sh.getRange(L.headerRow + 1, L.dateCol, last - L.headerRow, 1).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === dateKey) return L.headerRow + 1 + i;
  }
  return 0;
}

/* 友だち数(日別) GET /v2/bot/insight/followers?date=yyyyMMdd
   → 既存「友達推移」に upsert。自分の列だけを書き、数式列は触らない。 */
function upsertLineFollowers_(book, ymd) {
  var res = lineInsightFetch_('/v2/bot/insight/followers?date=' + ymd);
  if (!res || res.status !== 'ready') return false;    // 未確定の日はスキップ

  var sh = book.getSheetByName(LINE_INSIGHTS_TAB_FOLLOWERS);
  if (!sh) { log('line_insights_no_tab', { tab: LINE_INSIGHTS_TAB_FOLLOWERS }); return false; }

  var L = followersLayout_(sh);
  var d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
  var key = followersDateKey_(sh, L, d);

  var row = findDateRow_(sh, L, key);
  if (!row) row = insertRowForDate_(sh, L, d);

  /* API が持つ列だけを上書き。1セルずつ書く＝間の数式列を巻き込まない。 */
  L.cols.forEach(function (c) {
    var v = res[c.key];
    if (typeof v === 'number') sh.getRange(row, c.col).setValue(v);
  });
  return true;
}

/* 新しい日付の行を「降順の正しい位置」に差し込み、その行番号を返す。

   ⚠️ ヘッダー直下に固定で挿すのは間違い。BACKFILL で数日分を遡って埋めるため、
   埋めようとしている日付が「今の最新より古い」ことがある（実際 2026-08-20 が
   手入力から抜けており、固定挿入だと 08/20 が 08/21 の上に来て降順が壊れた）。
   既存の日付を上から見て、最初に「自分より古い日付」が現れた行の前に入れる。
   どれより古ければ最下部へ。

   数式の列（当日純増・ブロック率・月）は自分では書かないので、隣接するデータ行から
   copyTo(PASTE_FORMULA) で引き継ぐ。相対参照なので行がずれても正しく効く。 */
function insertRowForDate_(sh, L, d) {
  var last = sh.getLastRow();
  var target = last + 1;                 // 既定＝最下部（どの既存行より古い）
  if (last > L.headerRow) {
    var vals = sh.getRange(L.headerRow + 1, L.dateCol, last - L.headerRow, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      var t = toTime_(vals[i][0]);
      if (t !== null && t < d.getTime()) { target = L.headerRow + 1 + i; break; }
    }
  }
  sh.insertRowBefore(target);

  /* 数式の引き継ぎ元は隣接するデータ行。上に行が無い（=先頭に挿した）なら下から、
     下に行が無い（=最下部に足した）なら上から。 */
  var src = 0;
  if (target + 1 <= sh.getLastRow()) src = target + 1;
  else if (target - 1 > L.headerRow) src = target - 1;
  if (src) {
    sh.getRange(src, 1, 1, sh.getLastColumn())
      .copyTo(sh.getRange(target, 1, 1, sh.getLastColumn()), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  }
  sh.getRange(target, L.dateCol).setValue(d).setNumberFormat('yyyy/mm/dd');
  return target;
}

/* セルの日付を時刻(ms)に。Date でも '2026/08/21' でも '2026-08-21' でも読む。読めなければ null。 */
function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  var t = new Date(String(v == null ? '' : v).trim().replace(/-/g, '/')).getTime();
  return isNaN(t) ? null : t;
}

/* ---------- 新規タブ（既存に相当なし） ---------- */

/* 配信実績(日別) GET /v2/bot/insight/message/delivery?date=yyyyMMdd
   ※手管理の「LINE配信ログ」(1配信=1行)とは別物。日別の送信通数カウント。 */
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

/* 新規タブ専用。既存タブ（友達推移）にはこれを使わない＝勝手にヘッダーを書かないため。 */
function getInsightSheet_(book, name, headers) {
  var sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* 同じ日付の行があれば上書き、無ければ追記(日別データが後日確定するため)。
   新規タブ用（1行目がヘッダー・昇順追記）。 */
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
