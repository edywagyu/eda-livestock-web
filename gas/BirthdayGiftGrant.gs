/**
 * ============================================================
 *  🎂 誕生日プレゼント（赤身ステーキ）は お一人 その月に1回だけ
 *  2026-09-07 田崎さん決定「早い方で渡す」
 * ------------------------------------------------------------
 *  なぜ要るか:
 *   定期便のお客様が、誕生日の月に単品でも買ってくださると、
 *   定期便のお届けと単品のご注文の両方に入って2つ渡ってしまう。
 *   → お一人その月に1つ。**先に発送した方**に入れる。
 *
 *  どうやるか:
 *   ・記録の起点は「発送」。staffShip が発送を記録したとき、
 *     その注文が誕生日プレゼントの対象なら「誕生日特典_付与ログ」に1行残す。
 *     ＝実際に箱が出た方が「早い方」なので、これがいちばん素直。
 *   ・管理画面は staffOrders が返す birthday_given_by（先に渡した注文番号）を見て、
 *     2件目以降の発送画面には「今月はお渡し済み」と出す。
 *
 *  冪等:
 *   鍵は「その方 × その年月」。同じ注文を再発送しても、別の注文を後から発送しても
 *   行は増えない。先に入った1行が残る。
 *
 *  ⚠️ この仕組みは「渡した/渡していない」を発送の記録から自動で判断するだけで、
 *     箱に実際に入れたかどうかまでは分からない。入れ忘れの検知はしていない。
 * ============================================================ */

var BGG_SHEET   = '誕生日特典_付与ログ';
var BGG_HEADERS = ['given_at', 'year_month', 'email', 'line_uid', 'name', 'order_number'];

/* その方を表す鍵。line_uid を優先し、無ければメール（[[顧客の二重登録]] と同じ優先順） */
function bggPersonKey_(email, uid) {
  var e = custEmailKey_(email);
  var u = String(uid || '').trim();
  return e || (u ? 'uid:' + u : '');
}

/* 「その方 × その年月」→ 先に渡した注文番号 の対応表 */
function birthdayGrantIndex_() {
  var out = {};
  try {
    var sh = sheet(BGG_SHEET, BGG_HEADERS);
    var rows = sh.getDataRange().getValues();
    for (var r = 1; r < rows.length; r++) {
      var ym = String(rows[r][1] || '').trim();
      var key = bggPersonKey_(rows[r][2], rows[r][3]);
      if (!ym || !key) continue;
      var k = key + '|' + ym;
      if (!out[k]) out[k] = String(rows[r][5] || '');   /* 先に入った1行が正 */
    }
  } catch (e) { /* ログが読めなくても発送は止めない */ }
  return out;
}

/* 'YYYY-MM' を返す。placed_at が Date でも文字列でも拾う */
function bggYearMonth_(placedAt) {
  if (!placedAt) return '';
  if (Object.prototype.toString.call(placedAt) === '[object Date]') {
    if (isNaN(placedAt.getTime())) return '';
    return Utilities.formatDate(placedAt, 'Asia/Tokyo', 'yyyy-MM');
  }
  var m = String(placedAt).match(/^(\d{4})-(\d{2})/);
  return m ? (m[1] + '-' + m[2]) : '';
}

/**
 * 発送したご注文が誕生日プレゼントの対象なら、付与を1行記録する。
 * 対象でない／今月すでに渡している場合は何もしない。
 * 戻り値: { recorded:true, ... } / { recorded:false, reason:... }
 */
function recordBirthdayGiftIfDue_(o) {
  var key = bggPersonKey_(o.email, o.line_uid);
  if (!key) return { recorded: false, reason: '連絡先が無い' };

  /* その方の誕生日 */
  var bdIdx = birthdayIndex_();
  var bd = bdIdx.byUid[String(o.line_uid || '').trim()] || bdIdx.byEmail[custEmailKey_(o.email)] || '';

  /* 🎂 手動の名簿（gas/BirthdayGiftManual.gs）に載っている方は、誕生日の月でなくても対象 */
  var manual = birthdayManualPending_(birthdayManualIndex_(), o.email, o.line_uid);
  if (!bd && !manual) return { recorded: false, reason: '誕生日が未登録' };

  /* ご注文の月＝誕生日の月か */
  var ym = bggYearMonth_(o.placed_at);
  if (!ym) return { recorded: false, reason: 'ご注文日が読めない' };
  if (!manual && ym.slice(5, 7) !== bd.slice(0, 2)) return { recorded: false, reason: '誕生日の月ではない' };

  /* 今月すでに渡していないか */
  var granted = birthdayGrantIndex_();
  var k = key + '|' + ym;
  if (granted[k]) return { recorded: false, reason: '今月は渡し済み', by: granted[k] };

  sheet(BGG_SHEET, BGG_HEADERS).appendRow([
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    ym,
    custEmailKey_(o.email),
    String(o.line_uid || '').trim(),
    String(o.name || '').trim(),
    String(o.order_number || '')
  ]);
  log('birthday_gift_granted', { order: o.order_number, ym: ym, key: key, manual: manual });
  if (manual) birthdayManualMarkDone_(o.email, o.line_uid, o.order_number);
  return { recorded: true, ym: ym, order: o.order_number, manual: manual };
}
