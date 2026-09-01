/* ============================================================
   🧹 顧客の重複2組を1行にまとめる「一回きり」の処理 (2026-08-31 / 田崎さん承認済み)
   ============================================================
   下見(1行も書かない):  ?action=merge_dup_customers&token=<staff>&dry=1
   実行:                 ?action=merge_dup_customers&token=<staff>&run=1

   ・実行前に customers を customers_backup_0831 として丸ごと複製する(既にあれば作らない)
   ・まとめる組は下の MERGES に customer_id で直書き。ここに書いた行以外には一切触らない
   ・冪等: 消す側の行が既に無ければ「済み」を返して何もしない
   ・購入額/購入回数は「足し算」、初回注文は早い方、最終注文は遅い方を残す
   ・それ以外の列は「残す側が空のときだけ」消す側の値を引き継ぐ (source='ブロック' もここで移る)
*/
var MERGES = [
  { keep: 'C-0e6580a1', drop: 'C-75741a52',
    why: '山田崇誠さん: line_uid・電話が同一、メールだけ別(gmail / softbank)' },
  { keep: 'C-04c048bc', drop: '2f3b3710-1cc3-49f2-8786-0ca559f77b1b',
    why: '津田穂乃花さん: 電話 08088277973 が一致。LINE側の行「ほのか」を寄せる' }
];

/* 注文番号 EDA-YYYYMMDD-XXXX から日付だけ取り出す (比較用) */
function mergeOrderDate_(v) {
  var m = String(v == null ? '' : v).match(/(\d{8})/);
  return m ? m[1] : '';
}

function mergeDupCustomers(params) {
  var dry = String(params.dry || '') === '1';
  var run = String(params.run || '') === '1';
  if (!dry && !run) {
    return jsonResponse({ ok: false, error: 'dry=1 (下見) か run=1 (実行) を付けてください' });
  }

  var sh = ss().getSheetByName('customers');
  if (!sh) return jsonResponse({ ok: false, error: 'customers タブがありません' });

  var headers = sh.getDataRange().getValues()[0];
  var iId = headers.indexOf('customer_id');
  if (iId < 0) return jsonResponse({ ok: false, error: 'customer_id 列がありません' });
  var iSpent = headers.indexOf('total_spent');
  var iCount = headers.indexOf('order_count');
  var iFirst = headers.indexOf('first_order');
  var iLast  = headers.indexOf('last_order');
  var iMail  = headers.indexOf('email');

  /* ---- バックアップ (実行時のみ・1回だけ) ---- */
  var backup = 'customers_backup_0831';
  var backupNote;
  if (run) {
    if (ss().getSheetByName(backup)) {
      backupNote = backup + ' は既にあるので作り直しません';
    } else {
      sh.copyTo(ss()).setName(backup);
      backupNote = backup + ' を作成しました';
    }
  } else {
    backupNote = '(下見なので作りません)';
  }

  var report = [];
  for (var m = 0; m < MERGES.length; m++) {
    var spec = MERGES[m];
    /* 毎回読み直す: 前の組で行を消すと行番号がずれるため */
    var data = sh.getDataRange().getValues();
    var kRow = -1, dRow = -1;
    for (var r = 1; r < data.length; r++) {
      var id = String(data[r][iId] || '').trim();
      if (id === spec.keep) kRow = r;
      if (id === spec.drop) dRow = r;
    }
    if (kRow === -1) { report.push({ why: spec.why, 結果: '中止: 残す側 ' + spec.keep + ' が見つかりません' }); continue; }
    if (dRow === -1) { report.push({ why: spec.why, 結果: '済み: 消す側 ' + spec.drop + ' は既にありません (何もしません)' }); continue; }

    var K = data[kRow], D = data[dRow];
    var changes = [];

    /* 購入額・購入回数は足す */
    var newSpent = (Number(K[iSpent]) || 0) + (Number(D[iSpent]) || 0);
    var newCount = (Number(K[iCount]) || 0) + (Number(D[iCount]) || 0);
    changes.push({ 列: 'total_spent', 前: K[iSpent], 後: newSpent });
    changes.push({ 列: 'order_count', 前: K[iCount], 後: newCount });

    /* 初回=早い方 / 最終=遅い方 */
    var newFirst = K[iFirst], newLast = K[iLast];
    if (mergeOrderDate_(D[iFirst]) && (!mergeOrderDate_(K[iFirst]) || mergeOrderDate_(D[iFirst]) < mergeOrderDate_(K[iFirst]))) newFirst = D[iFirst];
    if (mergeOrderDate_(D[iLast])  && (!mergeOrderDate_(K[iLast])  || mergeOrderDate_(D[iLast])  > mergeOrderDate_(K[iLast])))  newLast  = D[iLast];
    if (newFirst !== K[iFirst]) changes.push({ 列: 'first_order', 前: K[iFirst], 後: newFirst });
    if (newLast  !== K[iLast])  changes.push({ 列: 'last_order',  前: K[iLast],  後: newLast });

    /* 残す側が空の列だけ、消す側の値を引き継ぐ (customer_id と email は残す側を維持) */
    var carry = [];
    for (var c = 0; c < headers.length; c++) {
      if (c === iId || c === iMail || c === iSpent || c === iCount || c === iFirst || c === iLast) continue;
      var kv = String(K[c] == null ? '' : K[c]).trim();
      var dv = D[c];
      if (!kv && String(dv == null ? '' : dv).trim()) carry.push({ 列: headers[c], 引き継ぐ値: dv, _c: c });
    }

    report.push({
      why: spec.why,
      残す行: (kRow + 1) + ' (' + spec.keep + ' / ' + K[iMail] + ')',
      消す行: (dRow + 1) + ' (' + spec.drop + ' / ' + (D[iMail] || 'メール空') + ')',
      更新: changes,
      引き継ぎ: carry.map(function (x) { return { 列: x.列, 値: x.引き継ぐ値 }; }),
      失うもの: String(D[iMail] || '').trim() ? ('消す行のメール ' + D[iMail] + ' は customers から無くなります(注文データ側には残ります)') : 'なし',
      結果: dry ? '下見のみ・未実行' : '実行しました'
    });

    if (run) {
      sh.getRange(kRow + 1, iSpent + 1).setValue(newSpent);
      sh.getRange(kRow + 1, iCount + 1).setValue(newCount);
      sh.getRange(kRow + 1, iFirst + 1).setValue(newFirst);
      sh.getRange(kRow + 1, iLast + 1).setValue(newLast);
      for (var q = 0; q < carry.length; q++) sh.getRange(kRow + 1, carry[q]._c + 1).setValue(carry[q].引き継ぐ値);
      sh.deleteRow(dRow + 1);
      log('merge_dup_customers', { keep: spec.keep, drop: spec.drop });
    }
  }

  return jsonResponse({
    ok: true,
    モード: dry ? '下見 (1行も書いていません)' : '実行',
    バックアップ: backupNote,
    残り行数: sh.getLastRow() - 1,
    明細: report
  });
}
