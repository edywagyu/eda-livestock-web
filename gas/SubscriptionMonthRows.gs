/* ============================================================
   🔁 定期便損益タブの「翌月分の行」を自動で作る
   ------------------------------------------------------------
   なぜ必要か:
     「定期便損益」タブは1ヶ月分ずつ手で行を足して使っている。
     足し忘れると管理画面ホームの「今月のまとめ」の定期便が丸ごと0になる。

   何をするか（毎月1日 7:00・冪等）:
     ・軒数の“正”＝「定期便マスター」の 状態=有効 の行。
     ・各軒について、直近月の同じ名前の行を **行ごとコピー**して最下部に足し、
       月だけ当月に書き換える。行コピーなので 原価(自動)/販売価格/利益(自動) の
       数式・書式・入力規則がそのまま引き継がれる（数式を推測しなくて済む）。
     ・マスターに居るが直近月に行が無い人（新規）は、同じプランの行を雛形に使い、
       郵便番号/住所/電話をマスターの値で上書き・配送料は空にして「要確認」で返す。
     ・直近月に居るがマスターで有効でない人（解約）は作らない。名前を返す。
     ・中身（和牛1〜7/鶏1〜3）は**直近月のまま**残る＝下書き。
       商品を選び直すのは人間の作業なので、選定前でも原価が0にならないようにしている。
       未選定のまま放置された行は staffMonthSummary が警告として拾う。

   🔴 コピーするのは A〜「利益(自動)」列まで。その右にある
      プラン一覧/税込売価/中身候補/原価per pack/ドロップダウン/エリア表は
      シート右側に置かれた**マスタ表**なので絶対にコピーしない。
   ============================================================ */

var SMR_SHEET     = '定期便損益';
var SMR_MASTER    = '定期便マスター';
var SMR_LAST_COL  = '利益(自動)';   /* ここまでをコピー対象にする */

function smrHeaderIndex_(header) {
  var idx = {};
  header.forEach(function (h, i) { idx[String(h).trim()] = i; });
  return idx;
}

/* 「8月」→8。数字が取れなければ0 */
function smrMonthNum_(v) {
  var m = String(v || '').match(/(\d{1,2})\s*月/);
  return m ? Number(m[1]) : 0;
}

function smrNormName_(v) {
  return String(v || '').replace(/[\s　]/g, '');
}

/* 本体。dryRun=true なら1行も書かずに、何が起きるかだけ返す。 */
function buildSubscriptionMonthRows(targetMonth, dryRun) {
  var sh = ss().getSheetByName(SMR_SHEET);
  var ms = ss().getSheetByName(SMR_MASTER);
  if (!sh) return { ok: false, error: SMR_SHEET + ' タブが見つかりません' };
  if (!ms) return { ok: false, error: SMR_MASTER + ' タブが見つかりません' };

  var month = Number(targetMonth) || (new Date().getMonth() + 1);
  var want  = month + '月';

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  var values  = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var H       = smrHeaderIndex_(values[0]);

  var iMonth = H['月'], iPlan = H['プラン'], iName = H['名前'];
  var iZip   = H['郵便番号'], iAddr = H['住所'], iTel = H['電話番号'];
  var iShip  = H['配送料'], iEnd = H[SMR_LAST_COL];
  if (iMonth == null || iPlan == null || iName == null || iEnd == null) {
    return { ok: false, error: SMR_SHEET + ' のヘッダーが想定と違います' };
  }
  var copyWidth = iEnd + 1;   /* A〜利益(自動) まで */

  /* 既に当月の行があれば何もしない（毎月1日以外に手で叩いても安全） */
  var monthsSeen = {}, maxMonth = 0;
  for (var r = 1; r < values.length; r++) {
    if (!values[r][iName]) continue;
    var mn = smrMonthNum_(values[r][iMonth]);
    if (!mn) continue;
    monthsSeen[mn] = true;
    if (mn > maxMonth) maxMonth = mn;
  }
  if (monthsSeen[month]) {
    return { ok: true, skipped: true, month: want, reason: '既に' + want + 'の行があります' };
  }
  if (!maxMonth) return { ok: false, error: '雛形にできる行が1件もありません' };

  /* 直近月の行を名前・プランで引けるようにする（シートの行番号は1始まり） */
  var srcByName = {}, srcByPlan = {};
  for (var r2 = 1; r2 < values.length; r2++) {
    if (!values[r2][iName]) continue;
    if (smrMonthNum_(values[r2][iMonth]) !== maxMonth) continue;
    var sheetRow = r2 + 1;
    srcByName[smrNormName_(values[r2][iName])] = sheetRow;
    var plan = String(values[r2][iPlan] || '').trim();
    if (plan && !srcByPlan[plan]) srcByPlan[plan] = sheetRow;
  }

  /* マスターの有効行 */
  var mv = ms.getDataRange().getValues();
  var MH = smrHeaderIndex_(mv[0]);
  var active = [];
  for (var r3 = 1; r3 < mv.length; r3++) {
    if (String(mv[r3][MH['状態']] || '').trim() !== '有効') continue;
    if (!mv[r3][MH['名前']]) continue;
    active.push(mv[r3]);
  }
  if (!active.length) return { ok: false, error: SMR_MASTER + ' に 状態=有効 の行がありません' };

  /* 解約＝直近月に居たがマスターで有効でない人 */
  var activeNames = {};
  active.forEach(function (a) { activeNames[smrNormName_(a[MH['名前']])] = true; });
  var dropped = Object.keys(srcByName).filter(function (n) { return !activeNames[n]; });

  var plan_    = [];   /* これから作る行 */
  var needCheck = [];  /* 新規＝プラン雛形から作った人 */
  var unmatched = [];  /* 雛形が見つからずスキップした人 */

  active.forEach(function (a) {
    var name = String(a[MH['名前']] || '').trim();
    var plan = String(a[MH['プラン']] || '').trim();
    var key  = smrNormName_(name);
    var src  = srcByName[key];
    var isNew = false;
    if (!src) { src = srcByPlan[plan]; isNew = true; }
    if (!src) { unmatched.push(name + '（' + plan + '）'); return; }
    plan_.push({ src: src, name: name, plan: plan, isNew: isNew, master: a });
    if (isNew) needCheck.push(name + '（' + plan + '）');
  });

  var result = {
    ok: true,
    month: want,
    sourceMonth: maxMonth + '月',
    willCreate: plan_.length,
    needCheck: needCheck,     /* 新規＝住所と配送料の確認が要る */
    dropped: dropped,         /* マスターで有効でない＝作らなかった */
    unmatched: unmatched,     /* 雛形が無くて作れなかった */
    dryRun: !!dryRun
  };
  if (dryRun) return result;

  /* 書き込み: 1行ずつ最下部にコピーしてから識別情報だけ上書きする */
  var writeRow = sh.getLastRow();
  plan_.forEach(function (p) {
    writeRow++;
    sh.getRange(p.src, 1, 1, copyWidth).copyTo(sh.getRange(writeRow, 1, 1, copyWidth));

    var m = p.master;
    sh.getRange(writeRow, iMonth + 1).setValue(want);
    sh.getRange(writeRow, iPlan  + 1).setValue(p.plan);
    sh.getRange(writeRow, iName  + 1).setValue(p.name);
    if (iZip  != null && MH['郵便番号'] != null) sh.getRange(writeRow, iZip  + 1).setValue(m[MH['郵便番号']]);
    if (iAddr != null && MH['住所']     != null) sh.getRange(writeRow, iAddr + 1).setValue(m[MH['住所']]);
    if (iTel  != null && MH['電話']     != null) sh.getRange(writeRow, iTel  + 1).setValue(m[MH['電話']]);
    /* 新規は前月実績が無い＝配送料を引き継がせない（エリアが違う） */
    if (p.isNew && iShip != null) sh.getRange(writeRow, iShip + 1).clearContent();
  });
  SpreadsheetApp.flush();

  log('subscription_month_rows', result);
  return result;
}

/* 毎月1日 7:00 のトリガーから呼ばれる本体 */
function subscriptionMonthRowsMonthly() {
  var res = buildSubscriptionMonthRows(null, false);
  if (!res.ok || res.skipped || !res.willCreate) return res;

  var lines = [
    '「定期便損益」タブに ' + res.month + ' の行を ' + res.willCreate + ' 件つくりました（' + res.sourceMonth + 'の行をコピー）。',
    '',
    '🔴 中身（和牛/鶏の商品）は ' + res.sourceMonth + ' のままの下書きです。今月の商品を選び直してください。',
    'そのままだと管理画面ホームの「今月のまとめ」の定期便の原価も先月と同じ数字で出ます。',
    ''
  ];
  if (res.needCheck.length) lines.push('◆ 新規（同じプランの行を雛形にしました。住所と配送料の確認をお願いします）\n  ' + res.needCheck.join('\n  '), '');
  if (res.dropped.length)   lines.push('◆ 作りませんでした（定期便マスターで 状態=有効 になっていない）\n  ' + res.dropped.join('\n  '), '');
  if (res.unmatched.length) lines.push('◆ 作れませんでした（同じプランの雛形が無い）\n  ' + res.unmatched.join('\n  '), '');

  try {
    MailApp.sendEmail({
      to: cfg('STAFF_NOTIFICATION_EMAIL') || 'r.tasaki@eda-livestock.com',
      subject: '【江田畜産】定期便損益 ' + res.month + ' の行を作成しました（商品の選定をお願いします）',
      body: lines.join('\n')
    });
  } catch (e) { /* メールが落ちても行の作成自体は成功扱い */ }
  return res;
}

/* 初回だけ実行: 毎月1日 7:00 のトリガーを設置（冪等） */
function setupSubscriptionMonthRowsTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'subscriptionMonthRowsMonthly';
  });
  if (!has) {
    ScriptApp.newTrigger('subscriptionMonthRowsMonthly')
      .timeBased().onMonthDay(1).atHour(7).create();
  }
  return { ok: true, created: !has };
}
