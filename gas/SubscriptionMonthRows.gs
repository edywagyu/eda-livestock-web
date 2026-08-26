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
     ・マスターに居るが雛形月に行が無い人（新規）は、同じプランの行を雛形に使い、
       郵便番号/住所/電話をマスターの値で上書き・配送料は空にして「要確認」で返す。
       同じプランの行も無ければ任意の行を雛形にし、中身も空にして blankRows で返す。
     ・雛形月に居るがマスターで有効でない人（解約）は作らない。名前を返す。
     ・🔴 判定は月まるごとではなく**人単位**。対象月の行を先に何件か手で作ってあっても、
       残りの人はちゃんと作られる。雛形にする月は「対象月より前で一番新しい月」。
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
function buildSubscriptionMonthRows(targetMonth, dryRun, onlyNames) {
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

  /* 雛形にする月 = 対象月より前で一番新しい月。
     🔴「一番新しい月」にしてはいけない。対象月の行を先に何件か手で作ってあると、
        その骨組みだけの行を雛形にしてしまう。 */
  var srcMonth = 0, alreadyInTarget = {};
  for (var r = 1; r < values.length; r++) {
    if (!values[r][iName]) continue;
    var mn = smrMonthNum_(values[r][iMonth]);
    if (!mn) continue;
    if (mn === month) { alreadyInTarget[smrNormName_(values[r][iName])] = true; continue; }
    if (mn < month && mn > srcMonth) srcMonth = mn;
  }
  if (!srcMonth) return { ok: false, error: want + 'より前の月に雛形にできる行がありません' };

  /* 雛形月の行を名前・プランで引けるようにする（シートの行番号は1始まり） */
  var srcByName = {}, srcByPlan = {}, srcAny = 0;
  for (var r2 = 1; r2 < values.length; r2++) {
    if (!values[r2][iName]) continue;
    if (smrMonthNum_(values[r2][iMonth]) !== srcMonth) continue;
    var sheetRow = r2 + 1;
    if (!srcAny) srcAny = sheetRow;
    srcByName[smrNormName_(values[r2][iName])] = sheetRow;
    var plan = String(values[r2][iPlan] || '').trim();
    if (plan && !srcByPlan[plan]) srcByPlan[plan] = sheetRow;
  }

  /* 名前を絞って作りたいとき（例: プロプランの2名だけ先に作る）。カンマ区切り。 */
  var onlySet = null;
  if (onlyNames) {
    onlySet = {};
    String(onlyNames).split(',').forEach(function (n) {
      n = smrNormName_(n);
      if (n) onlySet[n] = true;
    });
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

  /* 解約＝雛形月に居たがマスターで有効でない人 */
  var activeNames = {};
  active.forEach(function (a) { activeNames[smrNormName_(a[MH['名前']])] = true; });
  var dropped = Object.keys(srcByName).filter(function (n) { return !activeNames[n]; });

  var plan_     = [];  /* これから作る行 */
  var needCheck = [];  /* 同じ名前の雛形が無く、プラン雛形/任意の行から起こした人 */
  var blankRows = [];  /* プラン雛形も無く、中身を空で起こした人 */
  var existing  = [];  /* 既に対象月の行がある＝作らない */
  var filtered  = [];  /* onlyNames で外した人 */

  active.forEach(function (a) {
    var name = String(a[MH['名前']] || '').trim();
    var plan = String(a[MH['プラン']] || '').trim();
    var key  = smrNormName_(name);

    /* 🔴 月まるごとではなく人単位で判定する。
       対象月の行を先に何件か手で作ってあっても、残りの人はちゃんと作られる。 */
    if (alreadyInTarget[key]) { existing.push(name); return; }
    if (onlySet && !onlySet[key]) { filtered.push(name); return; }

    var src = srcByName[key], mode = 'same';
    if (!src) { src = srcByPlan[plan]; mode = 'plan'; }
    if (!src) { src = srcAny;          mode = 'blank'; }
    if (!src) return;

    plan_.push({ src: src, name: name, plan: plan, mode: mode, master: a });
    if (mode === 'plan')  needCheck.push(name + '（' + plan + '）');
    if (mode === 'blank') blankRows.push(name + '（' + plan + '）');
  });

  var result = {
    ok: true,
    month: want,
    sourceMonth: srcMonth + '月',
    willCreate: plan_.length,
    needCheck: needCheck,     /* 住所と配送料の確認が要る（中身は同プランの人からコピー） */
    blankRows: blankRows,     /* 同じプランの雛形が無く、中身が空＝商品の選定が必須 */
    existing: existing,       /* 既に対象月の行がある */
    dropped: dropped,         /* マスターで有効でない＝作らなかった */
    filtered: filtered,       /* onlyNames の指定で外した */
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
    /* 同じ名前の実績が無い人は配送料を引き継がせない（エリアが違う） */
    if (p.mode !== 'same' && iShip != null) sh.getRange(writeRow, iShip + 1).clearContent();
    /* プランごと違う人の行を雛形にした場合、中身は他人の献立なので空にする */
    if (p.mode === 'blank') {
      ['和牛1','和牛2','和牛3','和牛4','和牛5','和牛6','和牛7','鶏1','鶏2','鶏3'].forEach(function (k) {
        if (H[k] != null) sh.getRange(writeRow, H[k] + 1).clearContent();
      });
    }
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
  if (res.needCheck.length) lines.push('◆ 新規（同じプランの人の行を雛形にしました。住所と配送料の確認をお願いします）\n  ' + res.needCheck.join('\n  '), '');
  if (res.blankRows.length) lines.push('🔴 中身が空です（同じプランの雛形が無かった人。商品の選定が必須・配送料も未記入）\n  ' + res.blankRows.join('\n  '), '');
  if (res.existing.length)  lines.push('◆ 既に行があったので作りませんでした\n  ' + res.existing.join('\n  '), '');
  if (res.dropped.length)   lines.push('◆ 作りませんでした（定期便マスターで 状態=有効 になっていない）\n  ' + res.dropped.join('\n  '), '');

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
