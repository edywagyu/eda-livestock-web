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
          iN = ch.indexOf('name'), iU = ch.indexOf('line_uid');
      for (var r = 1; r < cv.length; r++) {
        add({
          src: 'customers', row: r + 1,
          email: iE >= 0 ? cv[r][iE] : '', phone: iP >= 0 ? cv[r][iP] : '',
          name:  iN >= 0 ? cv[r][iN] : '', line_uid: iU >= 0 ? String(cv[r][iU] || '').trim() : '',
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
  var res = { by: '', auto: false, hits: [], email: '', phone: '', name: '', ambiguous: false };

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
    if (h1.length) { res.by = 'email'; res.auto = true; res.hits = h1; fill(h1); return res; }
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
    var nm  = String(m.name || (probe && probe.name) || '').trim();
    for (var i = 1; i < data.length; i++) {
      if (iUid >= 0 && String(data[i][iUid] || '').trim() === uid &&
          custNameKey_(iName >= 0 ? data[i][iName] : '') === custNameKey_(nm)) {
        return { ok: true, added: false };   /* 既に控えがある */
      }
    }
    var srcs = (m.hits || []).map(function (r) { return r.src + ' ' + r.row + '行'; }).join(' / ');
    var states = {};
    (m.hits || []).forEach(function (r) { if (r.state) states[r.state] = true; });
    var basis = (m.by === 'phone')
      ? '電話番号が一致したが、2人以上に当たった（自動ではつないでいません）'
      : 'お名前の一致のみ（自動ではつないでいません）';
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
      try {
        MailApp.sendEmail({
          to: staffNotificationRecipients(),
          subject: '【EC】ご購入歴のおつなぎ：ご確認のお願い（お名前が一致したお客様）',
          body:
            'お客様ご自身が公式LINEから「ご購入歴を連携する」を操作されましたが、\n' +
            'メールアドレス・電話番号では確認できず、お名前だけが一致しました。\n' +
            '同姓同名の取り違えを防ぐため、自動ではおつなぎしていません。\n\n' +
            '・LINE表示名: ' + ((probe && probe.display_name) || '(なし)') + '\n' +
            '・推定されたお名前: ' + (nm || '(なし)') + '\n' +
            '・当たった先: ' + (srcs || '(なし)') + '\n' +
            '・定期便の状態: ' + (Object.keys(states).join(' / ') || '(なし)') + '\n' +
            '・根拠: ' + basis + '\n\n' +
            '「連携候補」タブ（本番EC注文DB）をご確認のうえ、同じ方であれば\n' +
            'おつなぎをお願いします。お客様には「確認のうえLINEでご連絡します」と\n' +
            'お伝えしています。\n'
        });
      } catch (e2) { log('link_candidate_mail_error', { error: e2.message }); }
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
    if (!m.auto && m.by !== 'phone') {
      var byName = matchIdentity_({ line_uid: uid, name: probe.display_name }, idx);
      if (byName.by === 'name' && (byName.hits || []).length) {
        recordLinkCandidate_(probe, byName, 'お客様ご自身の連携操作から（メール・電話では確認できず）', true);
        return jsonResponse({ ok: true, found: false, candidate: true });
      }
      log('line_link_request_nomatch', { uid: uid, has_email: !!email, has_phone: !!phone });
      return jsonResponse({ ok: true, found: false, candidate: false });
    }

    /* 電話が2人以上に当たった → 自動ではつながない（レビュー指摘2） */
    if (m.by === 'phone' && !m.auto) {
      recordLinkCandidate_(probe, m, 'お客様ご自身の連携操作から（電話番号が複数の方に一致）', true);
      return jsonResponse({ ok: true, found: false, candidate: true });
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
      recordLinkCandidate_(probe, m, '電話番号は一致したが、台帳にメールアドレスが無く確認できない', true);
      log('line_link_request_no_email_on_file', { uid: uid, by: m.by });
      return jsonResponse({ ok: true, found: true, sent: false, candidate: true, reason: 'no_email_on_file' });
    }

    var sh = sheet(LINK_CODE_TAB, LINK_CODE_HEADERS);
    if (linkMailThrottled_(sh, sendTo)) {
      /* 送りすぎ。画面には「お送りしました」と同じ返事をする（送信の有無を外から判別させない） */
      return jsonResponse({ ok: true, found: true, sent: true });
    }

    var code = String(Math.floor(100000 + Math.random() * 900000));
    ensureColumns_(sh, LINK_CODE_HEADERS.length);
    sh.appendRow([new Date(), uid, sendTo, code,
                  new Date(Date.now() + LINK_CODE_TTL_MIN * 60 * 1000), false, m.by]);

    MailApp.sendEmail({
      to: sendTo,
      subject: '【江田畜産】公式LINEとのおつなぎ用 確認番号',
      body:
        '江田畜産の公式LINEで「ご購入歴を連携する」をご操作いただきました。\n\n' +
        '確認番号: ' + code + '\n\n' +
        'LINEの画面にこの番号をご入力ください。' + LINK_CODE_TTL_MIN + '分間ご利用いただけます。\n' +
        'お心当たりのない場合は、このメールを破棄してください。\n' +
        'この番号をお伝えいただかない限り、ご購入歴がつながることはありません。\n\n' +
        '江田畜産株式会社\nhttps://www.eda-livestock.com/\n'
    });
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
    sh.getRange(hitRow, iUsed + 1).setValue(true);   /* 1回で使い切り */

    /* ここまで来た方は「台帳のメールアドレスを受信できる方」＝ご本人。
       おつなぎは既存の lineLinkAccount に通す（連携完了のLINE通知・
       クーポン付与などの流れをそのまま使うため）。 */
    var display = String((body && body.display_name) || '');
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
      ok: true, matched: true, pushed: true,
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
   🔍 下見（1文字も書かない）: 今つながっていない行がどれだけ救えるか数える。
   エディタから ▶ で実行して、ログで結果を見る。
   ============================================================ */
function dryRunIdentityMatch() {
  var idx = identityIndex_();
  var cs = ss().getSheetByName('customers');
  var cv = cs.getDataRange().getValues();
  var h = (cv[0] || []).map(function (x) { return String(x).trim(); });
  var iE = h.indexOf('email'), iP = h.indexOf('phone'), iN = h.indexOf('name'),
      iU = h.indexOf('line_uid'), iOC = h.indexOf('order_count');

  var out = { rows: cv.length - 1, line_only: 0, purchased_no_uid: 0,
              savable_by_email: 0, savable_by_phone: 0, candidate_by_name: 0, hopeless: 0, samples: [] };

  for (var r = 1; r < cv.length; r++) {
    var uid = String(cv[r][iU] || '').trim();
    var email = String(cv[r][iE] || '').trim();
    var oc = Number(cv[r][iOC] || 0) || 0;
    if (uid && !email) {
      out.line_only++;
      var m = matchIdentity_({ line_uid: uid, name: cv[r][iN], phone: cv[r][iP] }, idx);
      /* 自分の行しか当たらない場合は救えない */
      var others = (m.hits || []).filter(function (x) { return !(x.src === 'customers' && x.row === r + 1); });
      if (!others.length) { out.hopeless++; continue; }
      if (m.by === 'phone') { out.savable_by_phone++; }
      else if (m.by === 'email') { out.savable_by_email++; }
      else if (m.by === 'name') {
        out.candidate_by_name++;
        if (out.samples.length < 20) {
          out.samples.push({ row: r + 1, name: String(cv[r][iN] || ''),
                             hit: others.map(function (x) { return x.src + ':' + x.row; }).join(',') });
        }
      }
    }
    if (!uid && oc > 0) out.purchased_no_uid++;
  }
  log('dry_run_identity_match', out);
  return out;
}
