/**
 * ============================================================
 *  🎂 誕生日プレゼントを「この方に次の1回だけ」手で渡す
 *  2026-09-09 田崎さん指示
 * ------------------------------------------------------------
 *  なぜ要るか:
 *   誕生日プレゼントの判定は「ご注文した月＝誕生日の月」の1本だけ。
 *   ところが「お誕生月は過ぎてしまったが、日ごろのお礼に次のご注文で渡したい」
 *   というときに、その式では絶対に当たらない。
 *   誕生日の日付を書き換えて当てにいくのは（実際と違う値を入れることになるので）やらない。
 *   → 別の名簿を1枚だけ持ち、そこに載っている方は次のご注文で対象にする。
 *
 *  使い方（田崎さん）:
 *   本番EC注文DBの「誕生日特典_手動付与」タブに1行足すだけ。
 *     email … その方のメール（line_uid だけの方は line_uid 欄に入れる）
 *     状態  … 空のまま。渡し終えると自動で「済」になる
 *   これで、その方の次のご注文の発送画面に 🎂 のバナーとお手紙ボタンが出る。
 *
 *  渡したあと:
 *   発送を記録した時点で「誕生日特典_付与ログ」に1行入り、この名簿の状態が「済」になる。
 *   ＝1回きり。2件目以降のご注文には出ない。
 *
 *  ⚠️ 誕生日の月のご注文（自動の判定）と、この名簿の両方に当たっても
 *     「お一人その月に1つ」は付与ログ側で押さえているので二重にはならない。
 * ============================================================ */

var BGM_SHEET   = '誕生日特典_手動付与';
var BGM_HEADERS = ['追加日', 'email', 'line_uid', '名前', '状態', 'メモ'];

/* まだ渡していない方の一覧。personKey → その行番号 */
function birthdayManualIndex_() {
  var out = {};
  try {
    var sh = sheet(BGM_SHEET, BGM_HEADERS);
    var rows = sh.getDataRange().getValues();
    for (var r = 1; r < rows.length; r++) {
      var state = String(rows[r][4] || '').trim();
      if (state) continue;                       /* 「済」など何か入っていたら対象外 */
      var key = bggPersonKey_(rows[r][1], rows[r][2]);
      if (!key) continue;
      if (!out[key]) out[key] = r + 1;           /* 先に入った1行が正 */
    }
  } catch (e) { /* 名簿が無くても発送は止めない */ }
  return out;
}

/* この方は手動付与の対象か */
function birthdayManualPending_(idx, email, uid) {
  var key = bggPersonKey_(email, uid);
  return !!(key && idx[key]);
}

/* 渡し終えたので「済」にする。行が見つからなければ何もしない */
function birthdayManualMarkDone_(email, uid, orderNumber) {
  try {
    var idx = birthdayManualIndex_();
    var key = bggPersonKey_(email, uid);
    var row = idx[key];
    if (!row) return false;
    var sh = sheet(BGM_SHEET, BGM_HEADERS);
    sh.getRange(row, 5).setValue('済');
    var memo = String(sh.getRange(row, 6).getValue() || '');
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd') +
                ' ' + String(orderNumber || '') + ' で同梱';
    sh.getRange(row, 6).setValue(memo ? (memo + ' / ' + stamp) : stamp);
    log('birthday_manual_done', { key: key, order: orderNumber });
    return true;
  } catch (e) {
    log('birthday_manual_done_error', { error: e.message });
    return false;
  }
}
