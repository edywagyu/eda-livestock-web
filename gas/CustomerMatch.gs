/**
 * ============================================================
 *  🔗 お客様の突合（メール → 電話番号 → お名前 の3段）
 *  2026-11-13 追加
 * ------------------------------------------------------------
 *  なぜ要るか:
 *    公式LINEの友だち追加だけをされた方（customers に line_uid はあるが
 *    メールが空・ご購入0の行）と、ご購入歴・定期便のある同じ方の行が
 *    別々のまま残っている。実測 2026-11-13:
 *      ・友だち追加だけの行（line_uid あり・メール空）= 74
 *      ・ご購入ありで line_uid 空 = 21
 *      ・customers の「定期便」印 = 12行（実際の定期便は23軒）
 *    原因は突合の入口が2つに分かれていたこと:
 *      ・lineLinkAccount … メール一致だけ
 *      ・markSubscribers … お名前の完全一致だけ（「時枝　美沙」と
 *        LINE表示名「みさ」は永久に当たらない）
 *    さらに「定期便マスター」は紐づけに一度も使われていなかった。
 *    旧カート（WIX/Shopify）のお客様はこのマスターにしか電話番号が無い。
 *
 *  このファイルがやること:
 *    突合の判定をここ1箇所に集める。見る先は3つ:
 *      ① customers      （メール / 電話 / お名前 / line_uid）
 *      ② orders         （メール / 電話 / お名前）
 *      ③ 定期便マスター  （メール / 電話 / 名前）← 旧カートの方はここだけ
 *
 *  🔴 安全の決まり（必ず守る）:
 *    ・メール一致・電話一致は本人とみなして自動でおつなぎする。
 *    ・お名前一致だけでは絶対に自動でつながない（同姓同名の事故を防ぐ）。
 *      「連携候補」タブに1行残して、人が見て決める形にする。
 *    ・既に別の line_uid が入っている行は拾わない（別人の可能性）。
 *    ・既に入っている値は潰さない。空欄のときだけ書く。
 *    ・ご購入額（total_spent / order_count）には一切触らない。
 * ============================================================ */

/* 「連携候補」= お名前だけ一致した組み合わせを人が確かめるための控え。
   ここに書くだけでは何も起きない。承認の操作は人が行う（自動統合しない）。 */
var LINK_CANDIDATE_TAB = '連携候補';
var LINK_CANDIDATE_HEADERS = [
  '検出日時', '状態', 'LINE表示名', 'line_uid', '推定されたお名前',
  '当たった先', '定期便の状態', 'メール', '電話', '根拠', '備考'
];

/* ------------------------------------------------------------
   キーのそろえ方（表記ゆれの吸収）
   ------------------------------------------------------------ */

/* お名前: 全角/半角の空白を詰める・「様」を落とす・英字は小文字に。
   例「時枝　美沙」「時枝 美沙」「時枝美沙」「時枝美沙 様」→ すべて "時枝美沙" */
function custNameKey_(v) {
  var s = String(v == null ? '' : v).replace(/[\s　]/g, '');
  /* 🔴 文字クラス [様さま] にしてはいけない。末尾の「さ」「ま」まで落ちて
     「みさ」→「み」「かずま」→「かず」になり、名寄せが誤爆する（2026-11-13 指摘）。 */
  s = s.replace(/(?:様|さま)$/, '');
  return s.toLowerCase();
}

/* シートの列が足りないときだけ広げる。
   getRange(1, n) は最大列数を超えると例外になるため、見出しを足す前に必ず通す。 */
function ensureColumns_(sh, needed) {
  try {
    var max = sh.getMaxColumns();
    if (needed > max) sh.insertColumnsAfter(max, needed - max);
  } catch (e) { log('ensure_columns_error', { error: e.message }); }
  return sh;
}

/* 電話: 数字だけにして 0 始まりの 10/11 桁にそろえる。
   「090-1675-0388」「9016750388」「+81 90 1675 0388」→ すべて "09016750388"
   ※ 既にある custPhoneKey_(Code.gs) と同じ考え方。あちらを呼ぶだけにして実装は増やさない。 */
function matchPhoneKey_(v) {
  try { return custPhoneKey_(v); } catch (e) {}
  var d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (d.length > 11 && d.indexOf('81') === 0) d = '0' + d.slice(2);
  if (d && d.charAt(0) !== '0') d = '0' + d;
  return (d.length === 10 || d.length === 11) ? d : '';
}

function matchEmailKey_(v) {
  try { return custEmailKey_(v); } catch (e) {}
  return String(v == null ? '' : v).trim().toLowerCase();
}

/* ------------------------------------------------------------
   3つの正を1つの索引にまとめる（読み取りのみ・1文字も書かない）
   戻り: { byEmail:{key:[rec]}, byPhone:{...}, byName:{...} }
   rec = { src:'customers'|'orders'|'定期便マスター', row:行番号(1始まり),
           email, phone, name, line_uid, state }
   ------------------------------------------------------------ */
function identityIndex_() {
  var out = { byEmail: {}, byPhone: {}, byName: {} };

  function put(map, key, rec) {
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(rec);
  }
  function add(rec) {
    put(out.byEmail, matchEmailKey_(rec.email), rec);
    put(out.byPhone, matchPhoneKey_(rec.phone), rec);
    put(out.byName,  custNameKey_(rec.name),    rec);
  }

  /* ① customers */
  try {
    var cs = ss().getSheetByName('customers');
    if (cs) {
      var cv = cs.getDataRange().getValues();
      var ch = (cv[0] || []).map(function (x) { return String(x).trim(); });
      var iE = ch.indexOf('email'), iP = ch.indexOf('phone'),
          iN = ch.indexOf('name'), iU = ch.indexOf('line_uid'), iLN = ch.indexOf('line_name');
      for (var r = 1; r < cv.length; r++) {
        add({
          src: 'customers', row: r + 1,
          email: iE >= 0 ? cv[r][iE] : '', phone: iP >= 0 ? cv[r][iP] : '',
          name:  iN >= 0 ? cv[r][iN] : '', line_uid: iU >= 0 ? String(cv[r][iU] || '').trim() : '',
          line_name: iLN >= 0 ? cv[r][iLN] : '',
          state: ''
        });
      }
    }
  } catch (e) { log('identity_index_customers_error', { error: e.message }); }

  /* ② orders（ご注文のお名前・メール・電話） */
  try {
    var os = ss().getSheetByName('orders');
    if (os) {
      var ov = os.getDataRange().getValues();
      var oh = (ov[0] || []).map(function (x) { return String(x).trim(); });
      var jE = oh.indexOf('customer_email'), jP = oh.indexOf('customer_phone'),
          jN = oh.indexOf('customer_name'), jU = oh.indexOf('line_uid');
      for (var r2 = 1; r2 < ov.length; r2++) {
        add({
          src: 'orders', row: r2 + 1,
          email: jE >= 0 ? ov[r2][jE] : '', phone: jP >= 0 ? ov[r2][jP] : '',
          name:  jN >= 0 ? ov[r2][jN] : '', line_uid: jU >= 0 ? String(ov[r2][jU] || '').trim() : '',
          state: ''
        });
      }
    }
  } catch (e) { log('identity_index_orders_error', { error: e.message }); }

  /* ③ 定期便マスター（手管理の名簿。旧カートのお客様はここにしか居ない）
        🔴 ここは「状態」で絞らない（2026-11-13 の確認事項への回答）。
           subscriberIndex_（定期便の印をつける処理）は 状態=有効 だけを見るが、
           こちらは「同じ方を見つける」ための索引なので、停止・解約済みの方も
           対象にする（井崎様のように解約されても、ご購入歴はご本人のもので、
           マイページでご確認いただくべきもの）。
           ＝2つの索引のずれは意図したもの。「定期便の方かどうか」の判定は
           これまでどおり subscriberIndex_ / isSubscriber_ が担う。
           当たった行の「状態」は rec.state に入れて「連携候補」タブに出すので、
           人が見るときに有効／停止が分かる。
        2026-11-13 実測の見出し: 状態/区分/カテゴリ/名前/プラン/頻度/次回月/
        配達時間帯希望/郵便番号/住所/電話/メール/受領配送料/備考/解約日/解約理由
        見出しが変わっても拾えるよう候補名で探す（電話 / 電話番号 / TEL …）。 */
  try {
    var msh = ss().getSheetByName('定期便マスター');
    if (msh) {
      var mv = msh.getDataRange().getValues();
      var mh = (mv[0] || []).map(function (x) { return String(x).trim(); });
      function pick(cands) {
        for (var i = 0; i < cands.length; i++) {
          var k = mh.indexOf(cands[i]);
          if (k >= 0) return k;
        }
        return -1;
      }
      var kN = pick(['名前', 'お名前', '氏名']);
      var kE = pick(['メール', 'メールアドレス', 'email']);
      var kP = pick(['電話', '電話番号', 'TEL', 'tel', '携帯', '携帯番号']);
      var kS = pick(['状態']);
      for (var r3 = 1; r3 < mv.length; r3++) {
        if (kN < 0 && kE < 0 && kP < 0) break;
        add({
          src: '定期便マスター', row: r3 + 1,
          email: kE >= 0 ? mv[r3][kE] : '', phone: kP >= 0 ? mv[r3][kP] : '',
          name:  kN >= 0 ? mv[r3][kN] : '', line_uid: '',
          state: kS >= 0 ? String(mv[r3][kS] || '').trim() : ''
        });
      }
    }
  } catch (e) { log('identity_index_master_error', { error: e.message }); }

  return out;
}

/* ============================================================
   📧 メール送信の出口を1か所にする（2026-11-13 指摘2）
   ------------------------------------------------------------
   この仕組みから出るメールは2種類ある。
     ① お客様へ送る確認番号
     ② 担当（r.tasaki@ / backoffice@）へ送る「連携候補」のお知らせ
   ②に歯止めが無かったため、line_uid を変えながら
   「共有メール／電話が複数／台帳にメール無し／お名前だけ一致」に当たる入力を
   繰り返すだけで、担当宛メールを無制限に出せた。
   Workspace の1日の送信枠を使い切ると、毎朝8時のやることリスト・
   ご注文通知・請求書のメールまで止まる。
   → 両方ともこの関数だけを通す。ここで
     ・1日の総量（LINK_MAIL_DAILY_MAX・種類をまたいだ合計）
     ・残り送信枠（LINK_MAIL_QUOTA_FLOOR を下回ったら送らない）
     を見る。
   止めたときは、その日1回だけ担当へ「止めています」を知らせる
   （誰も気づかないまま、お客様が連携できない状態が続くのを防ぐ）。
   ============================================================ */
var LINK_MAIL_DAILY_MAX = 80;        /* 1日に出すメールの上限（確認番号＋候補通知の合計） */
var LINK_MAIL_COUNT_PROP = 'LINK_MAIL_DAY_COUNT';       /* 'yyyy-MM-dd|件数' */
var LINK_MAIL_PAUSE_PROP = 'LINK_MAIL_PAUSE_NOTIFIED';  /* 'yyyy-MM-dd' */

function linkMailToday_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }

function linkMailCount_() {
  try {
    var v = String(PropertiesService.getScriptProperties().getProperty(LINK_MAIL_COUNT_PROP) || '');
    var parts = v.split('|');
    if (parts[0] !== linkMailToday_()) return 0;
    return Number(parts[1] || 0) || 0;
  } catch (e) { return 0; }
}
function linkMailBump_(n) {
  try {
    PropertiesService.getScriptProperties()
      .setProperty(LINK_MAIL_COUNT_PROP, linkMailToday_() + '|' + n);
  } catch (e) {}
}

/* 送っていいか。戻り: { ok:true } / { ok:false, reason:'daily_cap'|'quota_floor' } */
function linkMailAllowance_() {
  var used = linkMailCount_();
  if (used >= LINK_MAIL_DAILY_MAX) return { ok: false, reason: 'daily_cap', used: used, remaining: -1 };
  var remaining = 99999;
  try { remaining = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (remaining < LINK_MAIL_QUOTA_FLOOR) return { ok: false, reason: 'quota_floor', used: used, remaining: remaining };
  return { ok: true, used: used, remaining: remaining };
}

/* 止めていることを担当へ知らせる（1日1回だけ） */
function linkMailNotifyPaused_(info) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (String(props.getProperty(LINK_MAIL_PAUSE_PROP) || '') === linkMailToday_()) return;
    props.setProperty(LINK_MAIL_PAUSE_PROP, linkMailToday_());
    var why = (info.reason === 'quota_floor')
      ? ('メールの残り送信枠が少ない（残り ' + info.remaining + '通）')
      : ('1日の上限 ' + LINK_MAIL_DAILY_MAX + '通に達した');
    MailApp.sendEmail({
      to: staffNotificationRecipients(),
      subject: '【EC】ご購入歴のおつなぎ：確認番号のメールを本日分止めています',
      body:
        'ご購入歴のおつなぎで出すメールが、本日分の上限に達したため止まっています。\n' +
        'お客様が公式LINEから連携を操作されても、確認番号が届きません。\n\n' +
        '・理由: ' + why + '\n' +
        '・今日すでに出した数: ' + linkMailCount_() + '通\n\n' +
        'お問い合わせが来た場合は、「連携候補」タブと顧客タブを見て手でおつなぎしてください。\n' +
        '上限の数値は gas/CustomerMatch.gs の LINK_MAIL_DAILY_MAX / LINK_MAIL_QUOTA_FLOOR です。\n'
    });
  } catch (e) { log('link_mail_pause_notify_error', { error: e.message }); }
}

/* 実際に送る出口。この仕組みからは、ここ以外で MailApp を呼ばない */
function linkMailSend_(to, subject, body, kind) {
  /* 「数を読む→送る→数を書く」は読んで書く更新なので、同時に来ると数え落ちる。
     短いロックで囲う（取れなくても送信は止めない。実効の歯止めは残り送信枠の方）。 */
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(3000); } catch (e0) {}
  try {
    var a = linkMailAllowance_();
    if (!a.ok) {
      log('link_mail_blocked', { kind: kind, reason: a.reason, used: a.used, remaining: a.remaining });
      linkMailNotifyPaused_(a);
      return { sent: false, reason: a.reason };
    }
    try {
      MailApp.sendEmail({ to: to, subject: subject, body: body });
      linkMailBump_(linkMailCount_() + 1);
      return { sent: true };
    } catch (e) {
      log('link_mail_send_error', { kind: kind, error: e.message });
      return { sent: false, reason: 'send_error' };
    }
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e1) {} }
  }
}

/* ------------------------------------------------------------
   そのメールアドレスが「2人以上のお名前」で使われているか。
   ------------------------------------------------------------
   メールアドレスは人ではなく受信箱を指すので、共有されていると
   「そのアドレスを受信できる＝その行のご本人」が成り立たない。
   確認番号をお送りする先を決めるとき、必ずここを通す。
   ------------------------------------------------------------ */
/* お名前欄に入っている値が「こちらのシステムが作った値」かどうか。
   true なら“お名前が入っていない”とみなして人数に数えない。
   ・lineLinkAccount はお名前が取れないとき body.email.split('@')[0] を入れる
     ＝メールアドレスの先頭がそのままお名前欄に入る。これは系統的に起きる。
   ・LINE_NAME_NOT_A_PERSON が true のときは、LINEの表示名がそのまま
     お名前欄に入っている行（name と line_name が同じ）も数えない。
     こちらは既定オフ（田崎さんの判断待ち）。 */
var LINK_NAME_FROM_LINE_IGNORED = false;   /* ← true にすると LINE表示名も数えない */

function linkNameIsSystemGenerated_(rec) {
  var n = custNameKey_(rec && rec.name);
  if (!n) return true;
  var em = String((rec && rec.email) || '');
  var local = em.indexOf('@') > 0 ? em.slice(0, em.indexOf('@')) : '';
  if (local && custNameKey_(local) === n) return true;
  if (LINK_NAME_FROM_LINE_IGNORED && rec && rec.line_name && custNameKey_(rec.line_name) === n) return true;
  return false;
}

function emailSharedByMultiplePeople_(idx, emailKey) {
  var ek = matchEmailKey_(emailKey);
  if (!ek) return false;
  var list = (idx && idx.byEmail && idx.byEmail[ek]) || [];
  var names = {};
  for (var i = 0; i < list.length; i++) {
    if (linkNameIsSystemGenerated_(list[i])) continue;
    var n = custNameKey_(list[i].name);
    if (n) names[n] = true;
  }
  return Object.keys(names).length > 1;
}

/* ------------------------------------------------------------
   突合そのもの。メール → 電話 → お名前 の順に見る。
   probe = { email?, phone?, name?, line_uid? }
   戻り: { by:'email'|'phone'|'name'|'', auto:true/false, hits:[rec], email, phone, name }
     auto=true … 本人とみなして自動でおつなぎしてよい（メール/電話で一致）
     auto=false & by='name' … 候補どまり。人が確かめる
   🔴 お名前は「当たった人が1人だけ」のときしか候補にしない。
      2人以上に当たったら候補にもしない（同姓同名の事故を防ぐ）。
   ------------------------------------------------------------ */
function matchIdentity_(probe, idx) {
  idx = idx || identityIndex_();
  var res = { by: '', auto: false, hits: [], email: '', phone: '', name: '', ambiguous: false, shared_email: false };

  function collect(map, key) {
    var list = (key && map[key]) || [];
    /* 既に別の line_uid が入っている行は拾わない（別人の可能性） */
    var uid = String((probe && probe.line_uid) || '').trim();
    return list.filter(function (rec) {
      return !(rec.line_uid && uid && rec.line_uid !== uid);
    });
  }
  function fill(hits) {
    for (var i = 0; i < hits.length; i++) {
      if (!res.email && hits[i].email) res.email = String(hits[i].email).trim();
      if (!res.phone && hits[i].phone) res.phone = String(hits[i].phone).trim();
      if (!res.name  && hits[i].name)  res.name  = String(hits[i].name).trim();
    }
  }

  var ek = matchEmailKey_(probe && probe.email);
  if (ek) {
    var h1 = collect(idx.byEmail, ek);
    if (h1.length) {
      /* 🔴 メールにも同一性の検算を入れる（2026-11-13 指摘1）。
         メールアドレスは「人」ではなく「受信箱」を指す。1つのアドレスを
         ご家族・ご法人で共有されている場合、先頭1件を本人とみなすと
         別の方のご購入歴につないでしまう。
         本番の定期便マスターで実在: 中尾 賢一郎様と中尾 創哉様が
         k.nakao@gvn.co.jp を共有（電話は別）。
         → お名前が2種類以上に跨るアドレスは自動ではつながず候補どまりにする。 */
      if (emailSharedByMultiplePeople_(idx, ek)) {
        res.by = 'email'; res.auto = false; res.ambiguous = true; res.hits = h1;
        return res;
      }
      res.by = 'email'; res.auto = true; res.hits = h1; fill(h1); return res;
    }
  }

  var pk = matchPhoneKey_(probe && probe.phone);
  if (pk) {
    var h2 = collect(idx.byPhone, pk);
    if (h2.length) {
      /* 🔴 電話番号にも同一性の検算を入れる（2026-11-13 指摘）。
         固定電話のご家族共有や、定期便マスターの電話が代表者のものだった場合、
         1つの番号が2人以上に当たる。先頭1件を本人とみなすと他人の行に
         line_uid を書いてしまうので、メールかお名前が2種類以上に跨るときは
         自動ではつながず候補どまりにする。 */
      var pMails = {}, pNames = {};
      h2.forEach(function (rec) {
        var k = matchEmailKey_(rec.email); if (k) pMails[k] = true;
        var n = custNameKey_(rec.name);    if (n) pNames[n] = true;
      });
      if (Object.keys(pMails).length > 1 || Object.keys(pNames).length > 1) {
        res.by = 'phone'; res.auto = false; res.ambiguous = true; res.hits = h2;
        return res;
      }
      /* 🔴 電話で1人に絞れても、その方の台帳メールが他の方と共有されていたら
         自動ではつながない（2026-11-13 指摘1）。確認番号の宛先がその共有メールに
         なり、「番号を受け取れた＝ご本人」が成り立たなくなるため。
         実在: 中尾 創哉様はご自身の携帯で1人に絞れるが、台帳メールは
         賢一郎様と共有の k.nakao@gvn.co.jp。 */
      var pMail = '';
      for (var pi = 0; pi < h2.length; pi++) {
        if (h2[pi].email) { pMail = h2[pi].email; break; }
      }
      if (pMail && emailSharedByMultiplePeople_(idx, pMail)) {
        res.by = 'phone'; res.auto = false; res.ambiguous = true; res.shared_email = true; res.hits = h2;
        return res;
      }
      res.by = 'phone'; res.auto = true; res.hits = h2; fill(h2); return res;
    }
  }

  var nk = custNameKey_(probe && probe.name);
  if (nk) {
    var h3 = collect(idx.byName, nk);
    /* 同じお名前で「別の人」が居ないか: メールの種類が2つ以上あれば別人の可能性あり */
    var mails = {};
    h3.forEach(function (rec) { var k = matchEmailKey_(rec.email); if (k) mails[k] = true; });
    if (h3.length && Object.keys(mails).length > 1) {
      res.by = 'name'; res.auto = false; res.ambiguous = true; res.hits = h3;
      return res;
    }
    if (h3.length) { res.by = 'name'; res.auto = false; res.hits = h3; fill(h3); return res; }
  }

  return res;
}

/* つながなかった理由の言葉。画面・担当メール・シートで同じ言葉を使う */
var LINK_REASON_TEXT = {
  email_shared:     '同じメールアドレスを複数の方が使われている（自動ではつないでいません）',
  phone_multi:      '電話番号が一致したが、2人以上に当たった（自動ではつないでいません）',
  no_email_on_file: '電話番号は一致したが、台帳にメールアドレスが無く本人確認ができない（自動ではつないでいません）',
  name_only:        'お名前の一致のみ（自動ではつないでいません）'
};
var LINK_REASON_SUBJECT = {
  email_shared:     'メールアドレスを複数の方が使用',
  phone_multi:      '同じ電話番号に複数の方',
  no_email_on_file: '台帳にメールアドレスが無い',
  name_only:        'お名前のみ一致'
};

/* m から理由を決める（呼び側が reason を渡さなかったとき用） */
function linkCandidateReason_(m) {
  if (!m) return 'name_only';
  if (m.by === 'email' && m.ambiguous) return 'email_shared';
  if (m.by === 'phone' && m.shared_email) return 'email_shared';
  if (m.by === 'phone') return 'phone_multi';
  return 'name_only';
}

/* ------------------------------------------------------------
   自動ではつなげなかった組み合わせを「連携候補」タブに1行残す。
   ・お名前だけ一致した場合
   ・電話番号は一致したが2人以上に当たった場合
   同じ line_uid × 同じお名前は二度書かない（冪等）。
   notify=true のときは担当へメールも送る（お客様ご自身の操作から来た候補）。
   🔴 ここでは customers を1文字も書き換えない。
   ------------------------------------------------------------ */
function recordLinkCandidate_(probe, m, note, notify) {
  try {
    var sh = sheet(LINK_CANDIDATE_TAB, LINK_CANDIDATE_HEADERS);
    var data = sh.getDataRange().getValues();
    var h = (data[0] || []).map(function (x) { return String(x).trim(); });
    var iUid = h.indexOf('line_uid'), iName = h.indexOf('推定されたお名前');
    var uid = String((probe && probe.line_uid) || '').trim();
    /* 🔴 当たった先が複数あるときは、先頭1件のお名前だけを書かない（2026-11-13 指摘2）。
       先頭が別の方だと「推定されたお名前: 中尾 賢一郎」と出て、担当が
       そのまま手で統合してしまう。当たった全行のお名前を並べ、複数だと分かる形にする。 */
    var hitNames = [];
    (m.hits || []).forEach(function (r0) {
      var n0 = String(r0.name || '').trim();
      if (n0 && hitNames.indexOf(n0) === -1) hitNames.push(n0);
    });
    var nm = (hitNames.length > 1)
      ? ('【候補が複数】' + hitNames.join(' / '))
      : String(m.name || hitNames[0] || (probe && probe.name) || '').trim();
    for (var i = 1; i < data.length; i++) {
      if (iUid >= 0 && String(data[i][iUid] || '').trim() === uid &&
          custNameKey_(iName >= 0 ? data[i][iName] : '') === custNameKey_(nm)) {
        return { ok: true, added: false };   /* 既に控えがある */
      }
    }
    var srcs = (m.hits || []).map(function (r) { return r.src + ' ' + r.row + '行'; }).join(' / ');
    var states = {};
    (m.hits || []).forEach(function (r) { if (r.state) states[r.state] = true; });
    /* 🔴 理由ごとに言葉を変える（2026-11-13 指摘5）。
       どの理由でも「お名前だけが一致しました」と知らせると、担当が
       「同姓同名の照合だ」と読んで手で誤って統合しかねない。
       とくに共有メール（中尾様ご兄弟）は、お名前の問題ではない。 */
    var reason = (m && m.reason) || linkCandidateReason_(m);
    var basis = LINK_REASON_TEXT[reason] || LINK_REASON_TEXT.name_only;
    ensureColumns_(sh, LINK_CANDIDATE_HEADERS.length);
    sh.appendRow([
      new Date(),
      m.ambiguous ? '要確認（複数の方に当たりました）' : '未確認',
      (probe && probe.display_name) || '',
      uid,
      nm,
      srcs,
      Object.keys(states).join(' / '),
      m.email || '',
      m.phone || '',
      basis,
      note || ''
    ]);
    log('link_candidate_added', { uid: uid, name: nm, srcs: srcs });

    /* 🔔 2026-11-13: 控えを残すだけでは誰も気づかず放置される（指摘6）。
       お客様ご自身の操作から生まれた候補は、その場で担当へ1通送る。
       「確認が済みましたらLINEでご連絡いたします」と画面でお伝えしているため、
       ここを黙らせてはいけない。
       友だち追加のときに自動で見つけた候補はメールを送らない（毎回届いて埋もれるので、
       シートを見る運用にする）。 */
    if (notify) {
      linkMailSend_(
        staffNotificationRecipients(),
        '【EC】ご購入歴のおつなぎ：ご確認のお願い（' + (LINK_REASON_SUBJECT[reason] || '要確認') + '）',
        'お客様ご自身が公式LINEから「ご購入歴を連携する」を操作されましたが、\n' +
        '自動ではおつなぎしませんでした。\n\n' +
        '■ つながなかった理由\n' +
        '  ' + basis + '\n\n' +
        '■ お客様\n' +
        '・LINE表示名: ' + ((probe && probe.display_name) || '(なし)') + '\n' +
        '・推定されたお名前: ' + (nm || '(なし)') + '\n' +
        '・ご入力のメール: ' + ((probe && probe.email) || '(なし)') + '\n' +
        '・ご入力の電話: ' + ((probe && probe.phone) || '(なし)') + '\n' +
        '・当たった先: ' + (srcs || '(なし)') + '\n' +
        '・定期便の状態: ' + (Object.keys(states).join(' / ') || '(なし)') + '\n\n' +
        '■ お願い\n' +
        (reason === 'email_shared'
          ? '  同じメールアドレスを複数の方がお使いです。お名前の問題ではありません。\n' +
            '  どちらの方かをご確認のうえ、該当する方の行におつなぎしてください。\n'
          : reason === 'phone_multi'
          ? '  同じ電話番号で複数の方のご登録があります。どちらの方かをご確認ください。\n'
          : reason === 'no_email_on_file'
          ? '  台帳にメールアドレスが無く、ご本人の確認ができませんでした。\n' +
            '  お電話などで確かめてからおつなぎしてください。\n'
          : '  お名前だけが一致しています。同姓同名の取り違えにご注意ください。\n') +
        '\n「連携候補」タブ（本番EC注文DB）に同じ内容を残しています。\n' +
        'お客様には「確認のうえLINEでご連絡します」とお伝えしています。\n',
        'candidate'
      );
    }
    return { ok: true, added: true };
  } catch (e) {
    log('link_candidate_error', { error: e.message });
    return { ok: false, error: e.message };
  }
}

/* 2026-11-13: attachUidToCustomerRow_ は削除した。
   「台帳の行に直接 line_uid を書く」経路は、本人確認（確認番号）を通らずに
   おつなぎしてしまうため廃止。おつなぎは必ず lineLinkVerifyCode →
   lineLinkAccount の1本に通し、残った重複行は resolveDuplicateUidRows_ で始末する。 */


/* ============================================================
   🔐 ご購入歴のおつなぎ（2段階・2026-11-13 設計変更）
   ------------------------------------------------------------
   🔴 なぜ2段階にしたか（レビュー指摘1）:
     1段階目の実装は「画面で打ったメールアドレスをそのまま突合して
     その場でおつなぎする」形だった。これは
     「メールアドレスを知っているだけで他人のご購入歴を乗っ取れる」。
     既存の MODE A（受注確認メールの ?e= 付きリンク）には
     「そのメールを受信できる人だけが踏める」という裏取りがあったが、
     画面入力にはそれが無い。
   → ご登録のメールアドレス宛に6桁の番号をお送りし、
     それを入れていただいてから初めておつなぎする。
     電話番号で当たった場合も、番号はお客様が打った宛先ではなく
     「台帳に載っているメールアドレス」へ送る（＝本人以外は受け取れない）。
     台帳にメールが無い方は自動ではつながず、人が確認する候補に回す。

   窓口は2つ:
     POST line_link_request_code { line_uid, email? , phone? }
     POST line_link_verify_code  { line_uid, display_name, code }

   🔒 お客様の個人情報は返さない。お名前も返さない（電話番号の総当たりで
      お名前が引けてしまうため・レビュー指摘9）。
   🔒 回数制限: 1つの line_uid から 6時間に5回まで（CacheService の
      上限が6時間のため「1日」ではなく6時間で数える）。
      メールの送信そのものは同じ宛先へ60秒に1回・24時間に10回まで。
   ============================================================ */

var LINK_CODE_TAB = 'ご購入歴連携_確認番号';
var LINK_CODE_HEADERS = ['発行日時', 'line_uid', '送信先メール', '確認番号', '有効期限', '使用済み', '入口'];
var LINK_CODE_TTL_MIN = 10;          /* 確認番号の有効時間（分） */
var LINK_TRY_WINDOW_SEC = 21600;     /* 回数を数える窓（秒）= 6時間。CacheService の上限 */
var LINK_TRY_MAX = 5;                /* 窓の中で試せる回数 */
var LINK_CODE_DAILY_MAX = 60;        /* 確認番号メールを1日に出す上限（確認番号だけの数） */
var LINK_MAIL_QUOTA_FLOOR = 300;     /* 残り送信枠がこれを下回ったら送らない（linkMailSend_ が見る） */

/* 今日すでに何通の確認番号を出したか */
function linkCodesIssuedToday_(sh) {
  try {
    var data = sh.getDataRange().getValues();
    var h = (data[0] || []).map(function (x) { return String(x).trim(); });
    var iAt = h.indexOf('発行日時');
    if (iAt < 0) return 0;
    var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    var n = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      var t = new Date(data[i][iAt]);
      if (isNaN(t.getTime())) continue;
      var d = Utilities.formatDate(t, 'Asia/Tokyo', 'yyyy-MM-dd');
      if (d !== today) break;   /* 新しい順に見ているので、今日でなくなったら終わり */
      n++;
    }
    return n;
  } catch (e) { return 0; }
}

/* 回数制限。戻り true なら止める */
function linkTryThrottled_(uid, bucket) {
  try {
    var key = 'linktry_' + bucket + '_' + uid;
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(key) || 0) + 1;
    cache.put(key, String(n), LINK_TRY_WINDOW_SEC);
    return n > LINK_TRY_MAX;
  } catch (e) { return false; }
}

/* 同じ宛先への送りすぎを防ぐ（60秒に1回・24時間に10回） */
function linkMailThrottled_(sh, email) {
  var target = matchEmailKey_(email);
  try {
    var data = sh.getDataRange().getValues();
    var h = (data[0] || []).map(function (x) { return String(x).trim(); });
    var iMail = h.indexOf('送信先メール'), iAt = h.indexOf('発行日時');
    if (iMail < 0 || iAt < 0) return false;
    var now = Date.now(), within24h = 0;
    for (var i = data.length - 1; i >= 1; i--) {
      if (matchEmailKey_(data[i][iMail]) !== target) continue;
      var t = new Date(data[i][iAt]).getTime();
      if (isNaN(t)) continue;
      var age = now - t;
      if (age > 24 * 3600 * 1000) break;
      if (age < 60 * 1000) return true;
      within24h++;
      if (within24h >= 10) return true;
    }
  } catch (e) {}
  return false;
}

/* ------------------------------------------------------------
   ① 確認番号をお送りする
   ------------------------------------------------------------ */
function lineLinkRequestCode(body) {
  try {
    var uid = String((body && body.line_uid) || '').trim();
    if (!uid) return jsonResponse({ ok: false, error: 'line_uid required' });
    var email = String((body && body.email) || '').trim();
    var phone = String((body && body.phone) || '').trim();
    if (!email && !phone) return jsonResponse({ ok: false, error: 'email or phone required' });

    if (linkTryThrottled_(uid, 'req')) {
      log('line_link_request_throttled', { uid: uid });
      return jsonResponse({ ok: false, error: 'too_many_attempts' });
    }

    var probe = {
      line_uid: uid,
      display_name: String((body && body.display_name) || ''),
      email: email, phone: phone, name: ''
    };
    var idx = identityIndex_();   /* 索引は1回だけ作る（シートを2度読まない） */
    var m = matchIdentity_(probe, idx);

    /* メール・電話のどちらでも当たらなかった → 表示名でお名前の当たりだけ見る。
       当たっても自動ではつながない（候補として人が確認する） */
    /* メールが複数の方で共有されていた（例: ご家族・ご法人で1つの受信箱）。
       「番号を受け取れた＝ご本人」が成り立たないので自動ではつながない。 */
    if (m.by === 'email' && !m.auto) {
      recordLinkCandidate_(probe, m, 'お客様ご自身の連携操作から（このメールアドレスを複数の方が使われている）', true);
      return jsonResponse({ ok: true, found: true, sent: false, candidate: true, reason: 'email_shared' });
    }

    if (!m.auto && m.by !== 'phone') {
      var byName = matchIdentity_({ line_uid: uid, name: probe.display_name }, idx);
      if (byName.by === 'name' && (byName.hits || []).length) {
        recordLinkCandidate_(probe, byName, 'お客様ご自身の連携操作から（メール・電話では確認できず）', true);
        return jsonResponse({ ok: true, found: false, candidate: true, reason: 'name_only' });
      }
      log('line_link_request_nomatch', { uid: uid, has_email: !!email, has_phone: !!phone });
      return jsonResponse({ ok: true, found: false, candidate: false, reason: 'not_found' });
    }

    /* 電話が2人以上に当たった、または台帳メールが共有されていた（レビュー指摘1・2） */
    if (m.by === 'phone' && !m.auto) {
      var why = m.shared_email
        ? 'お客様ご自身の連携操作から（電話では1人に絞れたが、台帳のメールアドレスを複数の方が使われている）'
        : 'お客様ご自身の連携操作から（電話番号が複数の方に一致）';
      recordLinkCandidate_(probe, m, why, true);
      return jsonResponse({
        ok: true, found: true, sent: false, candidate: true,
        reason: m.shared_email ? 'email_shared' : 'phone_multi'
      });
    }

    /* 送り先は「台帳に載っているメールアドレス」。お客様が打った文字列ではない。
       メール入力で当たった場合は同じものになる（当たったのだから台帳にある）。 */
    var sendTo = '';
    for (var i = 0; i < (m.hits || []).length; i++) {
      var e1 = String(m.hits[i].email || '').trim();
      if (e1) { sendTo = e1; break; }
    }
    if (!sendTo) {
      /* 台帳にメールが無い方（例: 定期便マスターでメール欄が空）。
         ご本人であることを確かめる手段が無いので、人が確認する候補に回す。 */
      m.reason = 'no_email_on_file';
      recordLinkCandidate_(probe, m, '電話番号は一致したが、台帳にメールアドレスが無く確認できない', true);
      log('line_link_request_no_email_on_file', { uid: uid, by: m.by });
      return jsonResponse({ ok: true, found: true, sent: false, candidate: true, reason: 'no_email_on_file' });
    }

    /* 念のためもう一度: この宛先が共有されていないか（matchIdentity_ で見ているが、
       窓口が増えても事故が起きないように送信直前でも確かめる） */
    if (emailSharedByMultiplePeople_(idx, sendTo)) {
      m.reason = 'email_shared';
      recordLinkCandidate_(probe, m, '確認番号の送り先メールアドレスを複数の方が使われている', true);
      log('line_link_request_shared_email', { uid: uid, by: m.by });
      return jsonResponse({ ok: true, found: true, sent: false, candidate: true, reason: 'email_shared' });
    }

    var sh = sheet(LINK_CODE_TAB, LINK_CODE_HEADERS);
    if (linkMailThrottled_(sh, sendTo)) {
      /* 送りすぎ。画面には「お送りしました」と同じ返事をする（送信の有無を外から判別させない） */
      return jsonResponse({ ok: true, found: true, sent: true });
    }

    /* 🔴 メール送信の総量の歯止め（2026-11-13 指摘4）。
       宛先ごとの制限（60秒に1回・24時間に10回）だけでは全体が守れない。
       line_uid は画面から送られてくる文字列で、こちらで検証できないため、
       uid を変えれば uid あたりの回数制限は回避できる。
       Workspace の1日の送信上限を使い切ると、毎朝8時のやることリスト・
       ご注文通知・請求書のメールまで止まる。
       → ①1日の発行数に上限を置く ②残り送信枠が少なければ送らない。 */
    var issuedToday = linkCodesIssuedToday_(sh);
    if (issuedToday >= LINK_CODE_DAILY_MAX) {
      log('line_link_daily_cap', { issued: issuedToday });
      return jsonResponse({ ok: true, found: true, sent: false, candidate: false, reason: 'mail_paused' });
    }
    /* 総量の歯止めは linkMailSend_ が見る（確認番号と候補通知で枠を共有する） */
    var allow = linkMailAllowance_();
    if (!allow.ok) {
      linkMailNotifyPaused_(allow);
      return jsonResponse({ ok: true, found: true, sent: false, candidate: false, reason: 'mail_paused' });
    }

    var code = String(Math.floor(100000 + Math.random() * 900000));

    /* 🔴 控えを書くのは「送れたあと」。先に書くと、送信を止めているときに
       誰も知らない番号の行が残り、1日の発行数の数まで押し上げる（2026-11-13 指摘）。 */
    var sent = linkMailSend_(
      sendTo,
      '【江田畜産】公式LINEとのおつなぎ用 確認番号',
      '江田畜産の公式LINEで「ご購入歴を連携する」をご操作いただきました。\n\n' +
      '確認番号: ' + code + '\n\n' +
      'LINEの画面にこの番号をご入力ください。' + LINK_CODE_TTL_MIN + '分間ご利用いただけます。\n' +
      'お心当たりのない場合は、このメールを破棄してください。\n' +
      'この番号をお伝えいただかない限り、ご購入歴がつながることはありません。\n\n' +
      '江田畜産株式会社\nhttps://www.eda-livestock.com/\n',
      'code'
    );
    if (!sent.sent) {
      return jsonResponse({ ok: true, found: true, sent: false, candidate: false, reason: 'mail_paused' });
    }
    ensureColumns_(sh, LINK_CODE_HEADERS.length);
    sh.appendRow([new Date(), uid, sendTo, code,
                  new Date(Date.now() + LINK_CODE_TTL_MIN * 60 * 1000), false, m.by]);
    log('line_link_code_sent', { uid: uid, by: m.by });
    return jsonResponse({ ok: true, found: true, sent: true });
  } catch (e) {
    log('line_link_request_error', { error: e.message });
    return jsonResponse({ ok: false, error: e.message });
  }
}

/* ------------------------------------------------------------
   ② 確認番号を照合して、おつなぎする
   ------------------------------------------------------------ */
function lineLinkVerifyCode(body) {
  var lock = LockService.getScriptLock();
  try {
    var uid = String((body && body.line_uid) || '').trim();
    var code = String((body && body.code) || '').trim();
    if (!uid || !code) return jsonResponse({ ok: false, error: 'line_uid and code required' });
    if (linkTryThrottled_(uid, 'vrf')) {
      log('line_link_verify_throttled', { uid: uid });
      return jsonResponse({ ok: false, error: 'too_many_attempts' });
    }

    if (!lock.tryLock(10000)) return jsonResponse({ ok: false, error: 'busy' });

    var sh = sheet(LINK_CODE_TAB, LINK_CODE_HEADERS);
    var data = sh.getDataRange().getValues();
    var h = (data[0] || []).map(function (x) { return String(x).trim(); });
    var iUid = h.indexOf('line_uid'), iMail = h.indexOf('送信先メール'),
        iCode = h.indexOf('確認番号'), iExp = h.indexOf('有効期限'), iUsed = h.indexOf('使用済み');

    var hitRow = -1, email = '';
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][iUid] || '').trim() !== uid) continue;
      if (String(data[i][iCode] || '').trim() !== code) continue;
      if (data[i][iUsed] === true || String(data[i][iUsed]) === 'true') continue;
      if (!(new Date(data[i][iExp]) > new Date())) continue;
      hitRow = i + 1; email = String(data[i][iMail] || '').trim();
      break;
    }
    if (hitRow < 0) {
      log('line_link_verify_bad_code', { uid: uid });
      return jsonResponse({ ok: false, error: 'bad_code' });
    }

    /* ここまで来た方は「台帳のメールアドレスを受信できる方」＝ご本人。
       おつなぎは既存の lineLinkAccount に通す（連携完了のLINE通知・
       クーポン付与などの流れをそのまま使うため）。 */
    var display = String((body && body.display_name) || '');

    /* 🔴 最後にもう一度: このメールアドレスが複数の方で共有されていないか。
       共有されていると lineLinkAccount が「そのメールを持つ先頭の行」に
       つないでしまい、別の方のご購入歴が出る（2026-11-13 指摘1）。
       番号を発行したあとに台帳が変わることもあるので、つなぐ直前に見る。
       🔴 ここは確認番号を使用済みにする前に見る。使い切ってしまうと、
          直したあとにお客様がもう一度番号を取り直すことになる。 */
    var vIdx = identityIndex_();
    if (emailSharedByMultiplePeople_(vIdx, email)) {
      var vHits = (vIdx.byEmail[matchEmailKey_(email)] || []);
      /* 担当メールに「どちらの方か」を判断する材料を必ず載せる。
         照合に使ったメールアドレスを probe に入れる（入れないと
         「ご入力のメール: (なし)」になり、取り違えやすい件ほど情報が無くなる）。 */
      recordLinkCandidate_({ line_uid: uid, display_name: display, email: email, name: '' },
                           { by: 'email', hits: vHits, email: email,
                             ambiguous: true, reason: 'email_shared' },
                           '確認番号は合っていたが、このメールアドレスを複数の方が使われている', true);
      log('line_link_verify_shared_email', { uid: uid });
      return jsonResponse({ ok: false, error: 'email_shared' });
    }

    sh.getRange(hitRow, iUsed + 1).setValue(true);   /* ここで1回使い切り */

    var r = lineLinkAccount({ line_uid: uid, display_name: display, email: email });
    var payload = {};
    try { payload = JSON.parse(r.getContent()); } catch (e2) {}
    if (!payload.ok) {
      log('line_link_verify_link_failed', { uid: uid, error: payload.error });
      return jsonResponse({ ok: false, error: payload.error || 'link_failed' });
    }

    /* 友だち追加で先に作られた空の行が、同じ line_uid を持ったまま残る。
       放っておくと lineLogin がそちらを先に拾ってご注文が0件に見える。 */
    var dup = resolveDuplicateUidRows_(uid, email);

    log('line_link_verified', { uid: uid, dup_cleared: dup.cleared });
    /* 🔒 お名前は返さない。LINE通知は lineLinkAccount が送っている（pushed:true） */
    return jsonResponse({
      ok: true, matched: true, pushed: !!payload.pushed,
      orders: (payload.orders && payload.orders.length) || 0
    });
  } catch (e) {
    log('line_link_verify_error', { error: e.message });
    return jsonResponse({ ok: false, error: e.message });
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
}

/* ------------------------------------------------------------
   同じ line_uid が2行に入ってしまった状態を解消する。
   ・残す行 = おつなぎ先（メール一致の行）
   ・もう一方は「メールが空」かつ「ご購入0」の行だけを対象にして
     line_uid を外し、source に統合の記録を残す。
   🔴 行は消さない。ご購入のある行・メールの入っている行には触らない。
   ------------------------------------------------------------ */
function resolveDuplicateUidRows_(uid, keepEmail) {
  var out = { cleared: 0, rows: [] };
  try {
    var sh = ss().getSheetByName('customers');
    if (!sh) return out;
    var data = sh.getDataRange().getValues();
    var h = (data[0] || []).map(function (x) { return String(x).trim(); });
    var iU = h.indexOf('line_uid'), iE = h.indexOf('email'),
        iOC = h.indexOf('order_count'), iSrc = h.indexOf('source');
    if (iU < 0 || iE < 0) return out;
    var keep = matchEmailKey_(keepEmail);
    var keepRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (keep && matchEmailKey_(data[i][iE]) === keep) { keepRow = i + 1; break; }
    }
    /* 🔴 残す行が分からないのに uid を外すと、その方は連携そのものを失う。
       見つからなければ何もしない（2026-11-13 指摘）。 */
    if (keepRow < 0) { log('resolve_dup_uid_no_keep_row', { uid: uid }); return out; }
    /* 🔴 ご購入回数の列が無いシートでは「ご購入0」を判定できない。
       判定できないまま消すのは危ないので、その場合も何もしない。 */
    if (iOC < 0) { log('resolve_dup_uid_no_order_count', { uid: uid }); return out; }
    for (var j = 1; j < data.length; j++) {
      var row = j + 1;
      if (row === keepRow) continue;
      if (String(data[j][iU] || '').trim() !== uid) continue;
      if (String(data[j][iE] || '').trim()) continue;                 /* メールが入っている行は触らない */
      if (Number(data[j][iOC] || 0) > 0) continue;                    /* ご購入のある行は触らない */
      sh.getRange(row, iU + 1).setValue('');
      if (iSrc >= 0) {
        var cur = String(data[j][iSrc] || '');
        if (cur.indexOf('統合') === -1) {
          sh.getRange(row, iSrc + 1).setValue((cur ? cur + ' / ' : '') + '重複（' + keepRow + '行に統合済 2026-11）');
        }
      }
      out.cleared++; out.rows.push(row);
    }
  } catch (e) { log('resolve_dup_uid_error', { error: e.message }); }
  return out;
}

/* ============================================================
   🔍 下見: 今つながっていない行がどれだけ救えるか数える。
   お客様のデータ（顧客・注文・定期便マスター）には1文字も書かない。
   最後に処理の記録を「_logs」タブに1行だけ残す。
   エディタから ▶ で実行して、戻り値かログで結果を見る。
   ============================================================ */
function dryRunIdentityMatch() {
  var idx = identityIndex_();
  var cs = ss().getSheetByName('customers');
  var cv = cs.getDataRange().getValues();
  var h = (cv[0] || []).map(function (x) { return String(x).trim(); });
  var iE = h.indexOf('email'), iP = h.indexOf('phone'), iN = h.indexOf('name'),
      iU = h.indexOf('line_uid'), iOC = h.indexOf('order_count');

  var out = {
    rows: cv.length - 1,
    line_only: 0,            /* 友だち追加だけの行（line_uid あり・メール空） */
    purchased_no_uid: 0,     /* ご購入ありで line_uid 空 */
    auto_by_email: 0,        /* 自動でおつなぎできる（メール一致・1人に絞れた） */
    auto_by_phone: 0,        /* 自動でおつなぎできる（電話一致・1人に絞れた） */
    candidate_email_shared: 0,   /* メールが複数の方で共有 → 人の確認 */
    candidate_phone_multi: 0,    /* 電話が複数の方に一致 → 人の確認 */
    candidate_name_only: 0,      /* お名前だけ一致 → 人の確認 */
    hopeless: 0,             /* どこにも当たらない */
    samples: []
  };

  /* 定期便マスター側から見た見積もり（この仕組みの主役） */
  out.master = { rows: 0, active: 0, auto: 0, candidate: 0, no_contact: 0, candidate_names: [] };

  for (var r = 1; r < cv.length; r++) {
    var uid = String(cv[r][iU] || '').trim();
    var email = String(cv[r][iE] || '').trim();
    var oc = Number(cv[r][iOC] || 0) || 0;
    if (uid && !email) {
      out.line_only++;
      /* 🔴 m.auto を必ず見る（2026-11-13 指摘4）。
         by だけで数えると、共有メール・電話複数で止まる分まで
         「自動で救える」に数えてしまい、見積もりが過大に出る。 */
      var m = matchIdentity_({ line_uid: uid, name: cv[r][iN], phone: cv[r][iP], email: email }, idx);
      var others = (m.hits || []).filter(function (x) { return !(x.src === 'customers' && x.row === r + 1); });
      if (!others.length) { out.hopeless++; continue; }
      if (m.auto && m.by === 'email') out.auto_by_email++;
      else if (m.auto && m.by === 'phone') out.auto_by_phone++;
      else if (m.by === 'email' || (m.by === 'phone' && m.shared_email)) out.candidate_email_shared++;
      else if (m.by === 'phone') out.candidate_phone_multi++;
      else if (m.by === 'name') out.candidate_name_only++;
      if (!m.auto && out.samples.length < 20) {
        out.samples.push({ row: r + 1, name: String(cv[r][iN] || ''),
                           by: m.by, reason: linkCandidateReason_(m),
                           hit: others.map(function (x) { return x.src + ':' + x.row; }).join(',') });
      }
    }
    if (!uid && oc > 0) out.purchased_no_uid++;
  }

  /* 定期便マスターの「状態=有効」の方が、何軒自動でおつなぎできるか */
  try {
    var ms = ss().getSheetByName('定期便マスター');
    if (ms) {
      var mv = ms.getDataRange().getValues();
      var mh = (mv[0] || []).map(function (x) { return String(x).trim(); });
      function pick(c) { for (var i = 0; i < c.length; i++) { var k = mh.indexOf(c[i]); if (k >= 0) return k; } return -1; }
      var kS = pick(['状態']), kN = pick(['名前', 'お名前', '氏名']),
          kE = pick(['メール', 'メールアドレス', 'email']),
          kP = pick(['電話', '電話番号', 'TEL', '携帯']);
      for (var q = 1; q < mv.length; q++) {
        if (kN >= 0 && !String(mv[q][kN] || '').trim()) continue;
        out.master.rows++;
        if (kS >= 0 && String(mv[q][kS] || '').trim() !== '有効') continue;
        out.master.active++;
        var em = kE >= 0 ? String(mv[q][kE] || '').trim() : '';
        var ph = kP >= 0 ? String(mv[q][kP] || '').trim() : '';
        if (!em && !ph) { out.master.no_contact++; continue; }
        /* お客様が「メール or 電話」で探したときに自動で通るか */
        var mm = matchIdentity_({ line_uid: '', email: em, phone: ph }, idx);
        if (mm.auto && em) { out.master.auto++; }
        else if (mm.auto && !em) { out.master.candidate++;   /* 台帳にメールが無い＝確認番号を送れない */
                                   out.master.candidate_names.push(String(mv[q][kN] || '') + '（メール無し）'); }
        else {
          out.master.candidate++;
          out.master.candidate_names.push(String(mv[q][kN] || '') + '（' + linkCandidateReason_(mm) + '）');
        }
      }
    }
  } catch (e) { out.master.error = e.message; }

  log('dry_run_identity_match', out);
  return out;
}
