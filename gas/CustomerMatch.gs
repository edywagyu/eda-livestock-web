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
  '当たった先', 'メール', '電話', '根拠', '備考'
];

/* ------------------------------------------------------------
   キーのそろえ方（表記ゆれの吸収）
   ------------------------------------------------------------ */

/* お名前: 全角/半角の空白を詰める・「様」を落とす・英字は小文字に。
   例「時枝　美沙」「時枝 美沙」「時枝美沙」「時枝美沙 様」→ すべて "時枝美沙" */
function custNameKey_(v) {
  var s = String(v == null ? '' : v).replace(/[\s　]/g, '');
  s = s.replace(/[様さま]+$/, '');
  return s.toLowerCase();
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
    if (h2.length) { res.by = 'phone'; res.auto = true; res.hits = h2; fill(h2); return res; }
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
   お名前だけ一致した組み合わせを「連携候補」タブに1行残す。
   同じ line_uid × 同じお名前は二度書かない（冪等）。
   🔴 ここでは customers を1文字も書き換えない。
   ------------------------------------------------------------ */
function recordLinkCandidate_(probe, m, note) {
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
    sh.appendRow([
      new Date(),
      m.ambiguous ? '要確認（同じお名前が複数）' : '未確認',
      (probe && probe.display_name) || '',
      uid,
      nm,
      srcs,
      m.email || '',
      m.phone || '',
      'お名前の一致のみ（自動ではつないでいません）',
      note || ''
    ]);
    log('link_candidate_added', { uid: uid, name: nm, srcs: srcs });
    return { ok: true, added: true };
  } catch (e) {
    log('link_candidate_error', { error: e.message });
    return { ok: false, error: e.message };
  }
}

/* ------------------------------------------------------------
   customers の行に line_uid をおつなぎする（メール/電話で当たったときだけ）。
   ・customers に該当行が無ければ、既存の lineLinkAccount に渡して作らせる。
   ・既に入っている値は潰さない。ご購入額には触らない。
   戻り: { linked:true/false, row, by }
   ------------------------------------------------------------ */
function attachUidToCustomerRow_(probe, m) {
  var uid = String((probe && probe.line_uid) || '').trim();
  if (!uid) return { linked: false, error: 'line_uid required' };

  var sh = sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
  var data = sh.getDataRange().getValues();
  var h = (data[0] || []).map(function (x) { return String(x).trim(); });
  function col(n) { var i = h.indexOf(n); if (i === -1) { i = h.length; sh.getRange(1, i + 1).setValue(n); h.push(n); } return i; }
  var iU = col('line_uid'), iE = col('email'), iN = col('name'), iP = col('phone'),
      iLN = col('line_name'), iLA = col('linked_at');

  var email = matchEmailKey_(m.email || (probe && probe.email));
  var phone = matchPhoneKey_(m.phone || (probe && probe.phone));

  /* 統合先の行を決める順: ① この line_uid が既に入っている行（友だち追加で作られた行）
     ② メール一致の行  ③ 電話一致の行。①があればそこへ、無ければ②③に uid を書く。 */
  var rowByUid = -1, rowByMail = -1, rowByPhone = -1;
  for (var i = 1; i < data.length; i++) {
    if (rowByUid < 0 && String(data[i][iU] || '').trim() === uid) rowByUid = i + 1;
    if (rowByMail < 0 && email && matchEmailKey_(data[i][iE]) === email) rowByMail = i + 1;
    if (rowByPhone < 0 && phone && matchPhoneKey_(data[i][iP]) === phone) rowByPhone = i + 1;
  }

  var target = rowByMail > 0 ? rowByMail : (rowByPhone > 0 ? rowByPhone : rowByUid);
  if (target < 0) return { linked: false, row: -1, by: m.by, note: 'customers に行が無い' };

  var cur = sh.getRange(target, 1, 1, h.length).getValues()[0];
  function fillIfEmpty(idx, val) {
    if (idx < 0 || val === '' || val == null) return;
    if (!String(cur[idx] == null ? '' : cur[idx]).trim()) sh.getRange(target, idx + 1).setValue(val);
  }
  /* uid は「空のときだけ」書く。別人の uid を上書きしない */
  var curUid = String(cur[iU] || '').trim();
  if (!curUid) sh.getRange(target, iU + 1).setValue(uid);
  else if (curUid !== uid) {
    return { linked: false, row: target, by: m.by, note: '別の line_uid が既に入っている（人が確認）' };
  }
  fillIfEmpty(iE, m.email || (probe && probe.email) || '');
  fillIfEmpty(iP, m.phone || (probe && probe.phone) || '');
  fillIfEmpty(iN, m.name  || (probe && probe.name)  || '');
  fillIfEmpty(iLN, (probe && probe.display_name) || '');
  if (iLA >= 0 && !cur[iLA]) sh.getRange(target, iLA + 1).setValue(new Date());

  /* 友だち追加で先に作られた空の行が別に残るなら、重複として印を残す
     （行は消さない。消すのは人の判断。既存の mergeDupCustomers に任せる） */
  if (rowByUid > 0 && target !== rowByUid) {
    var iSrc = col('source');
    var curSrc = String(sh.getRange(rowByUid, iSrc + 1).getValue() || '');
    if (curSrc.indexOf('重複') === -1) {
      sh.getRange(rowByUid, iSrc + 1).setValue((curSrc ? curSrc + ' / ' : '') + '重複（' + target + '行に統合済）');
    }
  }

  log('identity_linked', { uid: uid, row: target, by: m.by });
  return { linked: true, row: target, by: m.by, dup_row: (rowByUid > 0 && rowByUid !== target) ? rowByUid : 0 };
}

/* ============================================================
   POST line_link_contact { line_uid, display_name, email?, phone? }
   ------------------------------------------------------------
   公式LINEの「ご購入歴を連携する」からの、お客様ご自身による連携。
   ・メール → 電話番号 の順に見る。当たればその場でおつなぎする。
   ・どちらも外れたら matched:false を返す（画面が電話番号の入力に誘導する）。
   ・お名前だけ当たった場合は「連携候補」に控えを残し、matched:false・
     candidate:true を返す（勝手につながない）。
   🔒 お客様の個人情報は返さない。おつなぎできたかどうかだけを返す。
      （既存の line_link_account は注文明細をそのまま返しているが、
        この窓口は「連携できた/できない」の判定だけで足りる）
   🔒 当て推量での総当たりを防ぐため、1つの line_uid から1日20回まで。
   ============================================================ */
function lineLinkByContact(body) {
  try {
    var uid = String((body && body.line_uid) || '').trim();
    if (!uid) return jsonResponse({ ok: false, error: 'line_uid required' });
    var email = String((body && body.email) || '').trim();
    var phone = String((body && body.phone) || '').trim();
    if (!email && !phone) return jsonResponse({ ok: false, error: 'email or phone required' });

    /* 総当たり防止（1日20回） */
    var guardKey = 'linkcontact_' + uid;
    try {
      var cache = CacheService.getScriptCache();
      var n = Number(cache.get(guardKey) || 0) + 1;
      cache.put(guardKey, String(n), 21600);
      if (n > 20) {
        log('line_link_contact_throttled', { uid: uid, n: n });
        return jsonResponse({ ok: false, error: 'too_many_attempts' });
      }
    } catch (e) {}

    var probe = {
      line_uid: uid,
      display_name: String((body && body.display_name) || ''),
      email: email,
      phone: phone,
      name: String((body && body.name) || '')
    };
    var m = matchIdentity_(probe, identityIndex_());

    if (m.auto) {
      /* メール一致で、ご注文のメールが分かっている場合は既存の lineLinkAccount に通す。
         連携完了のLINE通知・クーポン付与などの既存の流れをそのまま使うため。 */
      var useEmail = m.email || email;
      if (useEmail) {
        var r = lineLinkAccount({ line_uid: uid, display_name: probe.display_name, email: useEmail });
        var payload = {};
        try { payload = JSON.parse(r.getContent()); } catch (e2) {}
        log('line_link_contact_ok', { uid: uid, by: m.by });
        return jsonResponse({
          ok: !!payload.ok, matched: !!payload.ok, by: m.by,
          name: (payload.customer && payload.customer.name) || m.name || '',
          orders: (payload.orders && payload.orders.length) || 0,
          subscriber: m.hits.some(function (x) { return x.src === '定期便マスター'; })
        });
      }
      /* 電話番号だけで当たった（旧カートの方。定期便マスターにしか電話が無い） */
      var a = attachUidToCustomerRow_(probe, m);
      log('line_link_contact_ok', { uid: uid, by: m.by, row: a.row });
      return jsonResponse({
        ok: true, matched: !!a.linked, by: m.by,
        name: m.name || '', orders: 0,
        subscriber: m.hits.some(function (x) { return x.src === '定期便マスター'; }),
        note: a.note || ''
      });
    }

    if (m.by === 'name') {
      recordLinkCandidate_(probe, m, 'お客様ご自身の連携操作から');
      return jsonResponse({ ok: true, matched: false, candidate: true });
    }

    log('line_link_contact_nomatch', { uid: uid, has_email: !!email, has_phone: !!phone });
    return jsonResponse({ ok: true, matched: false, candidate: false });
  } catch (e) {
    log('line_link_contact_error', { error: e.message });
    return jsonResponse({ ok: false, error: e.message });
  }
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
