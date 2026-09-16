/**
 * ============================================================
 *  🔁 定期便のお客様に印をつける（顧客シート・注文シート）
 *  2026-09-07 田崎さん指示「定期便の人たちは、わかるようにしてね。シートでも注文画面でも」
 * ------------------------------------------------------------
 *  何をするか（毎朝7時・冪等）:
 *   ・customers タブに「定期便」列を作り、定期便のお客様の行に「定期便」と書く。
 *   ・orders タブに「定期便のお客様」列を作り、そのご注文の方が定期便契約者なら書く。
 *     🔴 これは「そのご注文が定期便かどうか(mode)」とは別物。
 *        定期便のお客様が“単品で”買ってくださったご注文にも印が付く。
 *        梱包のときに「この方は定期便の方だ」と分かるようにするのが目的。
 *
 *  判定は subscriberIndex_() / isSubscriber_()（Code.gs）ただ1つ。
 *  誕生日メッセージの文面の出し分けも、管理画面のバッジも、同じ判定を使う。
 *
 *  安全設計:
 *   - 書くのは新しく作る1列だけ。既存の列には触らない。
 *   - 値が変わらない行には書き込まない（毎朝まるごと上書きしない）。
 *   - 列はシートの一番右に作る。既にあればその列を使う（何度走らせても増えない）。
 *   - markSubscribersDry() は1文字も書かずに、何件付くかだけ返す。
 * ============================================================ */

var MS_CUST_COL  = '定期便';            /* customers に作る列 */
var MS_ORDER_COL = '定期便のお客様';    /* orders に作る列 */
var MS_MARK      = '定期便';            /* 書く文字 */

function runMarkSubscribers()    { return markSubscribers_('live'); }
function markSubscribersDry()    { return markSubscribers_('dry');  }

function installMarkSubscribersTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runMarkSubscribers'; });
  if (!has) ScriptApp.newTrigger('runMarkSubscribers').timeBased().everyDays(1).atHour(7).create();
  return { ok: true, created: !has };
}

/* 見出しの列番号を返す。無ければ一番右に作る（0始まり）。
   🔴 dry のときは見出しも作らない。「1文字も書いていません」と言う以上、本当に書かない。 */
function ms_colIndex_(sh, headers, name, live) {
  var i = headers.indexOf(name);
  if (i !== -1) return i;
  i = headers.length;
  if (live) sh.getRange(1, i + 1).setValue(name);
  headers.push(name);
  return i;
}

/* 1列ぶんを、変わった行だけ書き戻す。戻り値＝実際に書き換えた行数 */
function ms_writeColumn_(sh, colIdx, wants, live) {
  var n = wants.length;
  if (!n) return 0;
  var range = sh.getRange(2, colIdx + 1, n, 1);
  var cur = range.getValues();
  var changed = 0;
  for (var i = 0; i < n; i++) {
    var now = String(cur[i][0] == null ? '' : cur[i][0]);
    if (now !== wants[i]) { cur[i][0] = wants[i]; changed++; }
  }
  if (changed && live) range.setValues(cur);
  return changed;
}

function markSubscribers_(mode) {
  var live = (mode === 'live');
  var idx = subscriberIndex_();
  var res = { ok: true, mode: mode };

  /* ── ① 顧客シート ───────────────────────────────── */
  try {
    var cs = sheet('customers');
    var cv = cs.getDataRange().getValues();
    if (cv.length >= 2) {
      var ch = cv[0];
      var cCol = ms_colIndex_(cs, ch, MS_CUST_COL, live);
      var iMail = ch.indexOf('email'), iUid = ch.indexOf('line_uid'), iName = ch.indexOf('name');
      var cw = [], cHit = 0;
      for (var r = 1; r < cv.length; r++) {
        var p = {
          email: iMail >= 0 ? String(cv[r][iMail] || '').trim().toLowerCase() : '',
          uid:   iUid  >= 0 ? String(cv[r][iUid]  || '').trim() : '',
          name:  iName >= 0 ? String(cv[r][iName] || '').trim() : ''
        };
        var hit = isSubscriber_(idx, p);
        if (hit) cHit++;
        cw.push(hit ? MS_MARK : '');
      }
      res.customers = { rows: cv.length - 1, subscribers: cHit, changed: ms_writeColumn_(cs, cCol, cw, live) };
    } else {
      res.customers = { rows: 0, subscribers: 0, changed: 0 };
    }
  } catch (e) {
    res.customers = { error: e.message };
  }

  /* ── ② 注文シート ───────────────────────────────── */
  try {
    var os = sheet('orders');
    var ov = os.getDataRange().getValues();
    if (ov.length >= 2) {
      var oh = ov[0];
      var oCol = ms_colIndex_(os, oh, MS_ORDER_COL, live);
      var jMail = oh.indexOf('customer_email'), jUid = oh.indexOf('line_uid'), jName = oh.indexOf('customer_name');
      var ow = [], oHit = 0;
      for (var r2 = 1; r2 < ov.length; r2++) {
        var q = {
          email: jMail >= 0 ? String(ov[r2][jMail] || '').trim().toLowerCase() : '',
          uid:   jUid  >= 0 ? String(ov[r2][jUid]  || '').trim() : '',
          name:  jName >= 0 ? String(ov[r2][jName] || '').trim() : ''
        };
        var hit2 = isSubscriber_(idx, q);
        if (hit2) oHit++;
        ow.push(hit2 ? MS_MARK : '');
      }
      res.orders = { rows: ov.length - 1, subscribers: oHit, changed: ms_writeColumn_(os, oCol, ow, live) };
    } else {
      res.orders = { rows: 0, subscribers: 0, changed: 0 };
    }
  } catch (e) {
    res.orders = { error: e.message };
  }

  if (!live) res.note = '1文字も書いていません（dry）。live で実行すると上の changed 件だけ書き換えます';
  log('mark_subscribers', res);
  return res;
}
