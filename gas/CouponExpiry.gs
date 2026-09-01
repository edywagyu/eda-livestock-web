/**
 * ============================================================
 *  初回クーポン（LINE10）の有効期限
 *  2026-08-31 追加 / 自己完結・既存関数(cfg, sheet, log, jsonResponse,
 *                    linkCouponCode_, _jstDayNum) を流用
 * ------------------------------------------------------------
 *  ルール（2026-08-31 田崎さん決定）:
 *   有効期限 = max( 連携日 + COUPON_VALID_DAYS , FIRST_COUPON_DEADLINE )
 *
 *   ・これから連携する人 … 連携日から7日
 *   ・すでに連携済みの人 … 連携日+7日はとっくに過ぎているので、
 *     全員共通の下限 FIRST_COUPON_DEADLINE（=2026-09-07）が効く
 *   1本の式で両方を賄うので「今回の人だけ例外」という分岐を持たない。
 *   下限日を過ぎたあとは自動的に「連携日+7日」だけの運用に戻る。
 *
 *  なぜ期限切れでも fail-open にしないか:
 *   期限を過ぎた人に割引を通すと、案内した締切が嘘になる。
 *   ただし**連携日が分からない場合は通す**（データ欠けで払う気の客を止めない）。
 *
 *  どのコードに効かせるか:
 *   既定は LINE10（linkCouponCode_）だけ。エダチク10 は他所でも案内している
 *   可能性があるので触らない。COUPON_EXPIRY_CODES で足せる。
 *
 *  Script Properties（任意・未設定なら既定値）:
 *   COUPON_VALID_DAYS      連携日からの有効日数  （既定 7）
 *   FIRST_COUPON_DEADLINE  全員共通の下限 'yyyy-MM-dd'（未設定なら下限なし）
 *   COUPON_EXPIRY_CODES    期限を効かせるコード（カンマ区切り・既定 LINE10）
 * ============================================================ */

function ce_validDays_() { var v = Number(cfg('COUPON_VALID_DAYS', '7')); return (v > 0) ? v : 7; }

/* 期限を効かせるコードの集合（大文字で保持） */
function ce_codes_() {
  var raw = String(cfg('COUPON_EXPIRY_CODES', '') || '').trim();
  var map = {};
  if (raw) {
    raw.split(',').forEach(function (v) { var k = String(v || '').trim().toUpperCase(); if (k) map[k] = true; });
  } else {
    map[String(linkCouponCode_()).toUpperCase()] = true;
  }
  return map;
}

/* 全員共通の下限日（日番号）。未設定なら null。 */
function ce_floorDayNum_() {
  var s = String(cfg('FIRST_COUPON_DEADLINE', '') || '').trim();
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return null;
  var p = s.split('-');
  return _jstDayNum(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}

/* customers の連携日（日番号）。見つからなければ null。
   メール優先・無ければ line_uid で引く（連携直後はメールが空の行がある）。 */
function ce_linkedDayNum_(email, lineUid) {
  var em = String(email || '').trim().toLowerCase();
  var ud = String(lineUid || '').trim();
  if (!em && !ud) return null;
  var d;
  try { d = sheet('customers').getDataRange().getValues(); } catch (e) { return null; }
  if (!d || d.length < 2) return null;
  var h = d[0];
  var iE = h.indexOf('email'), iU = h.indexOf('line_uid'), iL = h.indexOf('linked_at');
  if (iL < 0) return null;
  for (var r = 1; r < d.length; r++) {
    var hitMail = em && iE >= 0 && String(d[r][iE] || '').trim().toLowerCase() === em;
    var hitUid  = ud && iU >= 0 && String(d[r][iU] || '').trim() === ud;
    if (!hitMail && !hitUid) continue;
    var v = d[r][iL];
    if (!v) continue;
    if (v instanceof Date) return _jstDayNum(v);
    var m = String(v).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (m) return _jstDayNum(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return null;
}

/* この人のクーポン期限（日番号）。判定材料が無ければ null＝期限なし扱い。 */
function ce_expiryDayNum_(email, lineUid) {
  var linked = ce_linkedDayNum_(email, lineUid);
  var floor  = ce_floorDayNum_();
  var fromLink = (linked === null) ? null : (linked + ce_validDays_());
  if (fromLink === null && floor === null) return null;
  if (fromLink === null) return floor;
  if (floor === null) return fromLink;
  return Math.max(fromLink, floor);
}

function ce_md_(n) {
  var d = new Date(n * 86400000 - 9 * 3600000);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'M月d日');
}
function ce_ymd_(n) {
  var d = new Date(n * 86400000 - 9 * 3600000);
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/* ============================================================
   決済作成前のガード。createCheckout / createBankOrder から呼ぶ。
   期限切れなら例外＝Stripeセッションを作る前に止まる（副作用ゼロ）。
   ============================================================ */
function assertCouponNotExpired_(code, email, lineUid) {
  var c = String(code || '').trim().toUpperCase();
  if (!c) return;
  if (!ce_codes_()[c]) return;                       // 期限を持たないコードは素通し
  var exp = ce_expiryDayNum_(email, lineUid);
  if (exp === null) return;                          // 連携日も下限も無い＝止めない
  var today = _jstDayNum(new Date());
  if (today <= exp) return;
  log('coupon_expired', { code: c, email: String(email || '').slice(0, 64), expiry: ce_ymd_(exp) });
  throw new Error('クーポン「' + c + '」の有効期限（' + ce_md_(exp) + '）が過ぎています');
}

/* ============================================================
   表示用API  GET ?action=coupon_status&code=LINE10&email=...&uid=...
   決済ページが「使えるか／いつまでか」を出すために叩く。
   請求と同じ ce_expiryDayNum_ 1本を見る＝画面と請求がズレない。
   個人情報は返さない（真偽と日付だけ）。
   ============================================================ */
function couponStatus(params) {
  var code  = String((params && params.code) || '').trim().toUpperCase();
  var email = String((params && params.email) || '').trim();
  var uid   = String((params && params.uid) || '').trim();
  var out = { ok: true, code: code, hasExpiry: false, valid: true };
  try {
    if (!code || !ce_codes_()[code]) return jsonResponse(out);   // 期限のないコード
    out.hasExpiry = true;
    var exp = ce_expiryDayNum_(email, uid);
    if (exp === null) return jsonResponse(out);                  // 判定材料なし＝止めない
    var today = _jstDayNum(new Date());
    out.valid    = (today <= exp);
    out.expiry   = ce_ymd_(exp);
    out.expiryJp = ce_md_(exp);
    out.daysLeft = exp - today;
  } catch (e) {
    log('coupon_status_error', { error: String(e) });
  }
  return jsonResponse(out);
}
