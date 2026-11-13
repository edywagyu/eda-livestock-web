/**
 * ============================================================
 *  📥 旧カート（WIX / Shopify）のお客様・ご注文をドライブのCSVから取り込む
 *  2026-11-13 追加
 * ------------------------------------------------------------
 *  田崎さんの方針:
 *    「WIXとShopifyの顧客データ（誰に何を送ったか）を定期的にCSVでドライブに
 *      格納し、それを管理画面が読んで反映する」
 *    ★ 正本はCSV。PDFは機械で読めないので正本にしない。
 *      人が見るためのPDFが必要なら、取り込んだあとにCSVから起こす。
 *
 *  何をするか:
 *    ① ドライブの所定フォルダ（下の LEGACY_FOLDER_* で指定）のCSVを読む
 *    ② 列の名前を LEGACY_COLUMN_MAP で江田畜産の言葉に読み替える
 *    ③ customers に「お客様」を足す／足りない欄だけ埋める
 *       （突合は CustomerMatch.gs の メール→電話→お名前。お名前だけの一致では
 *         つながず「連携候補」に控えを残す）
 *    ④ orders に「ご注文」を足す（旧カートのご注文として mode=legacy_wix / legacy_shopify）
 *    ⑤ 何件入ったかを「旧カート取込_ログ」タブに1行残す
 *
 *  🔴 冪等（同じCSVを2回入れても二重にならない）:
 *    ・ご注文は orders の右端に作る legacy_key 列で重複を判定する。
 *      キー = 区分 + ':' + 注文番号。注文番号が無いCSVは
 *      区分 + ':' + メール + '|' + 日付(YYYY-MM-DD) + '|' + 金額 で作る。
 *    ・ファイル単位でも「旧カート取込_ログ」に記録を残し、
 *      同じファイル（ID＋最終更新日時）は既定で読み飛ばす。
 *
 *  🔴 まだ確定していないこと（田崎さんの確認が必要）:
 *    ・取り込み元フォルダのID … LEGACY_FOLDER_ID（スクリプトプロパティ）が未設定。
 *      設定が無ければフォルダ名 LEGACY_FOLDER_NAME で探す。
 *    ・WIX / Shopify が実際に書き出す列名 … 下の候補表で複数を見ているが、
 *      実物のCSVを1本もらえたら候補表に1行足すだけで直る形にしてある。
 *      当たらなかった列は取り込みログの「読めなかった列」に出す。
 *
 *  使い方（どれも ▶ エディタから実行。まず dry で中身を見てから）:
 *    importLegacyCartsDry()   … 1文字も書かずに、何件入るかだけ返す
 *    importLegacyCarts()      … 実際に取り込む
 * ============================================================ */

/* 取り込み元フォルダ。スクリプトプロパティ LEGACY_FOLDER_ID があればそれを使う。
   無ければ LEGACY_FOLDER_NAME の名前でドライブを探す。 */
var LEGACY_FOLDER_NAME = '旧カート顧客CSV';

/* 取り込み済みファイルの退避先（フォルダ名）。'' なら動かさない（既定）。
   ファイルを動かさなくても legacy_key とファイル記録で二重取り込みは起きない。 */
var LEGACY_DONE_FOLDER_NAME = '';

var LEGACY_LOG_TAB = '旧カート取込_ログ';
var LEGACY_LOG_HEADERS = [
  '取込日時', 'ファイル名', '区分', '種類', '読んだ行数',
  '新規お客様', '更新したお客様', '新規ご注文', '重複スキップ',
  '注文キーが作れず', '照合できず作らず', '連携候補',
  '空行スキップ', '読めなかった列', 'ファイルID', 'ファイル更新日時', 'モード', '備考'
];

/* orders の右端に作る、二重取り込み防止のための列 */
var LEGACY_KEY_COL = 'legacy_key';

/* ------------------------------------------------------------
   🔧 列の読み替え表
   ------------------------------------------------------------
   左が江田畜産の言葉、右がCSV側の列名の候補（上から順に探す）。
   WIX / Shopify の実物の列名が違っても、ここに1語足すだけで直る。
   比較は「小文字・前後の空白を落とす」でそろえてから行う。
   ------------------------------------------------------------ */
var LEGACY_COLUMN_MAP = {
  shopify: {
    /* お客様 */
    email:      ['email', 'customer email', 'contact email', 'メール', 'メールアドレス'],
    /* 🔴 Shopify の注文CSVは「Name」列が注文番号(#1539)。お名前ではない。
       だから name の候補に裸の 'name' は入れない（入れるとお名前欄に #1539 が入る）。 */
    name:       ['billing name', 'shipping name', 'customer name', '名前', 'お名前', '氏名'],
    first_name: ['first name', 'billing first name', 'shipping first name', '名'],
    last_name:  ['last name', 'billing last name', 'shipping last name', '姓'],
    phone:      ['phone', 'billing phone', 'shipping phone', 'customer phone', '電話', '電話番号'],
    zip:        ['billing zip', 'shipping zip', 'zip', '郵便番号'],
    address:    ['billing address1', 'shipping address1', 'address1', '住所'],
    /* ご注文 */
    order_no:   ['name', 'order name', 'order number', '#', '注文番号'],
    placed_at:  ['created at', 'paid at', 'processed at', 'date', '注文日'],
    total:      ['total', 'subtotal', 'total price', '合計', '金額'],
    items:      ['lineitem name', 'line item name', 'product title', '商品名'],
    qty:        ['lineitem quantity', 'line item quantity', 'quantity', '数量'],
    financial:  ['financial status', 'payment status', '支払状況']
  },
  wix: {
    email:      ['email', 'buyer email', 'recipient email', 'メール', 'メールアドレス'],
    name:       ['name', 'buyer name', 'recipient name', 'full name', '名前', 'お名前', '氏名'],
    first_name: ['first name', 'buyer first name', '名'],
    last_name:  ['last name', 'buyer last name', '姓'],
    phone:      ['phone', 'buyer phone', 'recipient phone', '電話', '電話番号'],
    zip:        ['zip', 'zip/postal code', 'postal code', '郵便番号'],
    address:    ['address', 'address line 1', 'street address', '住所'],
    order_no:   ['order number', 'order #', 'number', '注文番号'],
    placed_at:  ['date created', 'order date', 'date', '注文日'],
    total:      ['total', 'order total', '合計', '金額'],
    items:      ['items', 'item name', 'product name', '商品名'],
    qty:        ['quantity', 'qty', '数量'],
    financial:  ['payment status', 'status', '支払状況']
  }
};

/* ファイル名から区分（wix / shopify）を当てる。当たらなければ '' */
function legacySourceOf_(fileName) {
  var s = String(fileName || '').toLowerCase();
  if (s.indexOf('shopify') >= 0) return 'shopify';
  if (s.indexOf('wix') >= 0) return 'wix';
  return '';
}

/* ファイル名から種類（customers / orders）を当てる。当たらなければ 'orders' 扱いにしない。 */
function legacyKindOf_(fileName) {
  var s = String(fileName || '').toLowerCase();
  if (s.indexOf('order') >= 0 || s.indexOf('注文') >= 0) return 'orders';
  if (s.indexOf('customer') >= 0 || s.indexOf('contact') >= 0 || s.indexOf('顧客') >= 0) return 'customers';
  return '';
}

function legacyHeaderKey_(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

/* 見出し行から「江田畜産の言葉 → 列番号」の対応を作る。
   戻り: { map:{field:idx}, missing:[field] } */
function legacyResolveColumns_(header, source) {
  var dict = LEGACY_COLUMN_MAP[source] || {};
  var hk = (header || []).map(legacyHeaderKey_);
  var map = {}, missing = [];
  Object.keys(dict).forEach(function (field) {
    var cands = dict[field];
    for (var i = 0; i < cands.length; i++) {
      var k = hk.indexOf(legacyHeaderKey_(cands[i]));
      if (k >= 0) { map[field] = k; return; }
    }
    missing.push(field);
  });
  /* 同じ列が2つの役割に当たってしまった場合の安全弁。
     注文番号とお名前が同じ列なら、お名前は「無い」ものとして扱う
     （Shopify の「Name」= 注文番号 のような取り違えを防ぐ）。 */
  if (map.order_no != null && map.name != null && map.order_no === map.name) {
    delete map.name;
    missing.push('name(注文番号の列と同じだったため外しました)');
  }
  return { map: map, missing: missing };
}

function legacyCell_(row, map, field) {
  var i = map[field];
  if (i == null || i < 0) return '';
  var v = row[i];
  return v == null ? '' : v;
}

/* 氏名: name が無ければ 姓+名 を組む */
function legacyName_(row, map) {
  var n = String(legacyCell_(row, map, 'name') || '').trim();
  if (n) return n;
  var l = String(legacyCell_(row, map, 'last_name') || '').trim();
  var f = String(legacyCell_(row, map, 'first_name') || '').trim();
  return (l + ' ' + f).trim();
}

/* 日付を 'yyyy/MM/dd HH:mm:ss' にそろえる。読めなければ元の文字列を返す */
function legacyDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  }
  var s = String(v).trim();
  var d = new Date(s.replace(/-/g, '/'));
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  return s;
}

function legacyDateKey_(v) {
  var s = legacyDate_(v);
  var m = String(s).match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : String(s).slice(0, 10);
}

function legacyMoney_(v) {
  var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/* ------------------------------------------------------------
   ご注文1件のキー（二重取り込み防止）。
   ① 注文番号があればそれを使う（いちばん確実）
   ② 無ければ メール|日付|金額|商品名|数量 で作る
   🔴 2026-11-13 の指摘で直したところ:
     ・旧実装は メール|日付|金額 の3つだけだった。同じ方が同じ日に同じ金額で
       2回ご注文されると2件目が「重複」として落ちていた（二重より落ちる方が怖い）。
       → 商品名と数量を足し、さらに「同じキーがファイル内で何件目か」の
         通し番号(#2, #3…)を付ける。通し番号はファイルの中身だけで決まるので、
         同じCSVを入れ直しても同じキーになる＝二重にならない。
         （CSVの行番号は使わない。別の月に書き出し直すと行がずれて
           同じご注文が別物になってしまうため）
     ・メールが空の行では wix:|2026-01-01|0 のように全員共通のキーになり、
       別人のご注文同士がぶつかっていた。
       → メール・日付・金額のどれかが空なら、キーを作らず '' を返す。
         呼び側は「突合できず」に数えて取り込まない（混ざるより落ちる方を選ぶ）。
   ------------------------------------------------------------ */
function legacyOrderKey_(source, row, map) {
  var no = String(legacyCell_(row, map, 'order_no') || '').trim();
  if (no) return source + ':' + no;

  var mail = matchEmailKey_(legacyCell_(row, map, 'email'));
  var date = legacyDateKey_(legacyCell_(row, map, 'placed_at'));
  var totalRaw = String(legacyCell_(row, map, 'total') == null ? '' : legacyCell_(row, map, 'total')).trim();
  var total = legacyMoney_(legacyCell_(row, map, 'total'));
  /* 🔴 金額は「空かどうか」で見る。0 を falsy で弾くと、無償交換や
     全額クーポンの0円のご注文が取り込まれない（2026-11-13 指摘）。 */
  if (!mail || !date || !totalRaw) return '';   /* 代替キーを作れない */

  var item = String(legacyCell_(row, map, 'items') || '').trim();
  var qty  = String(legacyCell_(row, map, 'qty') || '').trim();
  return source + ':' + mail + '|' + date + '|' + total + '|' + item + '|' + qty;
}

/* キーから短い符号を作る（注文番号が無いCSVの order_number 用） */
function legacyHash_(key) {
  try {
    var b = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(key), Utilities.Charset.UTF_8);
    var hex = '';
    for (var i = 0; i < b.length && hex.length < 12; i++) {
      hex += ('0' + (b[i] & 0xFF).toString(16)).slice(-2);
    }
    return hex.toUpperCase().slice(0, 12);
  } catch (e) {
    return String(key).replace(/[^A-Za-z0-9]/g, '').slice(-12).toUpperCase();
  }
}

/* ファイルの中で同じキーが何件目かを数えて、2件目以降に #n を付ける。
   同じ内容のCSVなら何度入れても同じ結果になる（冪等）。 */
function legacyNumberDuplicateKeys_(keys) {
  var seen = {}, out = [];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!k) { out.push(''); continue; }
    seen[k] = (seen[k] || 0) + 1;
    out.push(seen[k] === 1 ? k : (k + '#' + seen[k]));
  }
  return out;
}

/* ------------------------------------------------------------
   取り込み元フォルダを取る。見つからなければ null。
   ------------------------------------------------------------ */
function legacyFolder_() {
  var id = cfg('LEGACY_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); }
    catch (e) { log('legacy_folder_id_error', { id: id, error: e.message }); }
  }
  try {
    var it = DriveApp.getFoldersByName(LEGACY_FOLDER_NAME);
    if (it.hasNext()) return it.next();
  } catch (e) { log('legacy_folder_name_error', { error: e.message }); }
  return null;
}

/* ------------------------------------------------------------
   本体
   mode: 'dry'（1文字も書かない） / 'live'
   opts: { force:true で既に取り込んだファイルも読み直す }
   ------------------------------------------------------------ */
function importLegacyCartsDry(opts) { return importLegacyCarts_('dry', opts); }
function importLegacyCarts(opts)    { return importLegacyCarts_('live', opts); }

function importLegacyCarts_(mode, opts) {
  var live = (mode === 'live');
  var force = !!(opts && opts.force);
  var folder = legacyFolder_();
  if (!folder) {
    var msg = '取り込み元フォルダが見つかりません。スクリプトプロパティ LEGACY_FOLDER_ID を設定するか、' +
              'ドライブに「' + LEGACY_FOLDER_NAME + '」フォルダを作ってください。';
    log('legacy_import_no_folder', { mode: mode });
    return { ok: false, error: msg };
  }

  var logSh = sheet(LEGACY_LOG_TAB, LEGACY_LOG_HEADERS);
  var doneKeys = {};
  try {
    var lv = logSh.getDataRange().getValues();
    var lh = (lv[0] || []).map(function (x) { return String(x).trim(); });
    var iFid = lh.indexOf('ファイルID'), iUpd = lh.indexOf('ファイル更新日時'), iMode = lh.indexOf('モード');
    for (var i = 1; i < lv.length; i++) {
      if (iMode >= 0 && String(lv[i][iMode]) !== 'live') continue;   /* dry の記録は済み扱いにしない */
      if (iFid >= 0) doneKeys[String(lv[i][iFid]) + '|' + legacyDate_(iUpd >= 0 ? lv[i][iUpd] : '')] = true;
    }
  } catch (e) {}

  var results = [];
  var files = folder.getFilesByType(MimeType.CSV);
  var seen = 0;
  while (files.hasNext()) {
    var f = files.next();
    seen++;
    var fname = f.getName();
    var fkey = f.getId() + '|' + legacyDate_(f.getLastUpdated());
    if (!force && doneKeys[fkey]) {
      results.push({ file: fname, skipped: '既に取り込み済み' });
      continue;
    }
    var source = legacySourceOf_(fname);
    var kind = legacyKindOf_(fname);
    if (!source || !kind) {
      results.push({ file: fname, skipped: 'ファイル名から区分（wix/shopify）か種類（customers/orders）が分かりません' });
      continue;
    }
    var r = legacyImportFile_(f, source, kind, live);
    results.push(r);
    if (live) {
      ensureColumns_(logSh, LEGACY_LOG_HEADERS.length);
      logSh.appendRow([
        new Date(), fname, source, kind, r.rows || 0,
        r.cust_new || 0, r.cust_updated || 0, r.order_new || 0, r.dup || 0,
        r.no_key || 0, r.no_contact || 0, r.candidate || 0,
        r.skipped_blank || 0,
        (r.missing || []).join(' / '), f.getId(), legacyDate_(f.getLastUpdated()), mode, r.note || ''
      ]);
      if (LEGACY_DONE_FOLDER_NAME) {
        try {
          var dit = folder.getFoldersByName(LEGACY_DONE_FOLDER_NAME);
          var dst = dit.hasNext() ? dit.next() : folder.createFolder(LEGACY_DONE_FOLDER_NAME);
          f.moveTo(dst);
        } catch (e) { r.note = (r.note || '') + ' 退避に失敗: ' + e.message; }
      }
    }
  }

  var out = { ok: true, mode: mode, folder: folder.getName(), files_seen: seen, results: results };
  if (!live) out.note = 'お客様のデータ（顧客・注文）には1文字も書いていません（dry）。処理の記録（_logs）だけ残ります。live で実行すると上の件数だけ書き込みます';
  log('legacy_import', { mode: mode, files: seen });
  return out;
}

/* 1行ぶんの配列に、列名を見て値を置く */
function legacyPut_(arr, headers, colName, val) {
  var i = headers.indexOf(colName);
  if (i >= 0) arr[i] = val;
}

/* CSV 1本ぶん */
function legacyImportFile_(file, source, kind, live) {
  var res = { file: file.getName(), source: source, kind: kind, rows: 0,
              cust_new: 0, cust_updated: 0, order_new: 0, dup: 0,
              no_key: 0, no_contact: 0, candidate: 0,
              skipped_blank: 0, missing: [], note: '' };

  var rows;
  try {
    rows = Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8'));
  } catch (e) {
    try { rows = Utilities.parseCsv(file.getBlob().getDataAsString('Shift_JIS')); }
    catch (e2) { res.note = 'CSVが読めませんでした: ' + e.message; return res; }
  }
  if (!rows || rows.length < 2) { res.note = '中身が空です'; return res; }

  var resolved = legacyResolveColumns_(rows[0], source);
  var map = resolved.map;
  res.missing = resolved.missing;
  if (map.email == null && map.phone == null) {
    res.note = 'メールも電話番号も見つかりません。LEGACY_COLUMN_MAP に実際の列名を足してください';
    return res;
  }

  var idx = identityIndex_();

  /* orders 側の準備（legacy_key 列と既存キー） */
  var osh = null, oh = [], iKey = -1, haveKey = {};
  if (kind === 'orders') {
    osh = sheet('orders');
    oh = osh.getDataRange().getValues()[0].map(function (x) { return String(x).trim(); });
    iKey = oh.indexOf(LEGACY_KEY_COL);
    if (iKey === -1) {
      iKey = oh.length;
      /* 🔴 見出しを足す前に列を広げる。orders の現在の最大列数が見出し数と同じだと
         getRange(1, iKey+1) が範囲外で落ちる（2026-11-13 指摘）。
         実測: orders の見出しは27列。 */
      if (live) { ensureColumns_(osh, iKey + 1); osh.getRange(1, iKey + 1).setValue(LEGACY_KEY_COL); }
      oh.push(LEGACY_KEY_COL);
    } else {
      var kv = osh.getRange(2, iKey + 1, Math.max(osh.getLastRow() - 1, 1), 1).getValues();
      kv.forEach(function (x) { var k = String(x[0] || '').trim(); if (k) haveKey[k] = true; });
    }
  }

  /* ご注文のキーを先に全部作っておく（同じキーの2件目以降に #n を付けるため）。
     行ごとにその場で決めると、同じCSVを入れ直したときに番号がずれる。 */
  var rowKeys = [];
  if (kind === 'orders') {
    var rawKeys = [];
    for (var k0 = 1; k0 < rows.length; k0++) {
      var rr = rows[k0];
      rawKeys.push((!rr || !rr.join('').trim()) ? '' : legacyOrderKey_(source, rr, map));
    }
    rowKeys = legacyNumberDuplicateKeys_(rawKeys);
  }

  var pendingOrders = [];

  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (!row || !row.join('').trim()) continue;

    var email = String(legacyCell_(row, map, 'email') || '').trim();
    var phone = String(legacyCell_(row, map, 'phone') || '').trim();
    var name  = legacyName_(row, map);

    /* 🔴 注文CSVの「続きの行」から customers の行を作らない（2026-11-13 指摘3）。
       Shopify の注文CSVは1件のご注文が商品ごとに複数行に分かれ、続きの行は
       お客様の欄が空（配送先のお名前だけ残ることがある）。
       前回は「注文番号・日付・金額がすべて空なら続き行」と判定したが、
       Shopify は注文番号(Name列)を全商品行に繰り返すため判定が効かなかった。
       → 素直に「注文CSVで、メールも電話も無い行からは customers の行を作らない」。
         ご注文の側も、メールが無いと legacyOrderKey_ がキーを作れないので取り込まない。
       ※ お客様CSV(kind='customers')にはこの判定をかけない（お名前だけの名簿は正しい）。 */
    if (!email && !phone && !name) {
      res.skipped_blank++;
      continue;
    }
    if (kind === 'orders' && !email && !phone) {
      res.skipped_blank++;
      continue;
    }

    res.rows++;

    /* ---- お客様 ---- */
    var probe = { email: email, phone: phone, name: name, line_uid: '' };
    var m = matchIdentity_(probe, idx);
    if (m.auto) {
      /* メール or 電話で1人に絞れた。customers に行が無ければ台帳の情報で作る
         （定期便マスターにしか居なかったお客様を迎え入れるのがこの仕組みの目的） */
      if (live) legacyUpsertCustomer_(probe, m, source, 'matched', res);
      else res.cust_updated++;
    } else if (m.by === 'name' || m.by === 'phone' || m.by === 'email') {
      /* 1人に絞れなかった（お名前だけの一致／電話が複数／メールが共有）
         → つながない。控えだけ残して、新しい行として入れる。
         🔴 'new' を渡すので、既存行には相乗りしない（メールもお名前も一致する行だけ）。
            これが無いと、共有メールの行で他の方の行にお名前・電話を書いてしまう。 */
      res.candidate++;
      if (live) {
        recordLinkCandidate_({ line_uid: '', display_name: '', name: name }, m,
                             '旧カートCSVの取り込み（' + source + '）', false);
        legacyUpsertCustomer_(probe, { by: '', hits: [] }, source, 'new', res);
      } else { res.cust_new++; }
    } else {
      if (live) legacyUpsertCustomer_(probe, { by: '', hits: [] }, source, 'new', res);
      else res.cust_new++;
    }

    /* ---- ご注文 ---- */
    if (kind === 'orders') {
      var key = rowKeys[r - 1] || '';
      if (!key) {
        /* 注文番号も代替キーも作れない（メール・日付・金額のどれかが空）。
           混ざると取り返しがつかないので取り込まない。 */
        res.no_key++;
        continue;
      }
      if (haveKey[key]) { res.dup++; continue; }
      haveKey[key] = true;
      var item = String(legacyCell_(row, map, 'items') || '').trim();
      var qty  = Number(legacyCell_(row, map, 'qty') || 0) || 0;
      var o = new Array(oh.length).fill('');
      /* 🔴 注文番号が無いCSVの代替値は、キー全体から作った短い符号にする（2026-11-13 指摘3）。
         key の末尾10文字だけだと「同じお客様・同じ商品・同じ数量・同じ金額で日付だけ違う」
         ご注文が同じ番号になり、RepeatShipReminder が order_number で畳むので
         2件が1件に見える（ご購入回数が減る）。納品書・請求書の突合も order_number 前提。 */
      legacyPut_(o, oh, 'order_number', String(legacyCell_(row, map, 'order_no') || '').trim() || ('LEGACY-' + source.toUpperCase() + '-' + legacyHash_(key)));
      legacyPut_(o, oh, 'placed_at', legacyDate_(legacyCell_(row, map, 'placed_at')));
      legacyPut_(o, oh, 'customer_name', name);
      legacyPut_(o, oh, 'customer_email', email);
      legacyPut_(o, oh, 'customer_phone', phone);
      legacyPut_(o, oh, 'mode', 'legacy_' + source);
      legacyPut_(o, oh, 'total', legacyMoney_(legacyCell_(row, map, 'total')));
      legacyPut_(o, oh, 'payment_status', String(legacyCell_(row, map, 'financial') || 'imported'));
      legacyPut_(o, oh, 'payment_method', source);
      legacyPut_(o, oh, 'items_json', item ? JSON.stringify([{ title: item, qty: qty || 1 }]) : '[]');
      legacyPut_(o, oh, 'metadata_json', JSON.stringify({ imported_from: source, file: file.getName(), imported_at: new Date().toISOString() }));
      o[iKey] = key;
      pendingOrders.push(o);
      res.order_new++;
    }
  }

  if (live && pendingOrders.length) {
    ensureColumns_(osh, oh.length);
    osh.getRange(osh.getLastRow() + 1, 1, pendingOrders.length, oh.length).setValues(pendingOrders);
  }

  return res;
}

/* customers への upsert。
   ・既にある行（メール/電話一致）は空欄だけ埋める
   ・無ければ1行足す（ご購入額は0・source に旧カートの区分を残す）
   🔴 お名前だけの一致では新しい行を作る（勝手につながない）。
      同じ人かどうかは「連携候補」で人が決める。 */
function legacyUpsertCustomer_(probe, m, source, mode, res) {
  /* mode:
       'matched'  … メール/電話で1人に絞れた。メール・電話で既存行を探し、
                    無ければ台帳の情報で新しい行を作る
       'new'      … 誰とも当たらなかった／候補どまり（共有メール・電話が複数・
                    お名前だけ一致）。既存行には相乗りせず、新しい行を作る。
                    相乗りしてよいのは「メールもお名前も一致する行」だけ
                    （同じCSVを入れ直したときに行が増えないようにするため）
  */
  /* 🔴 'new' では「既存行を探す」こと自体をほぼ止める（2026-11-13 指摘1）。
     前回は電話照合だけ止めたが、メール照合は無条件に走っていた。
     そのため共有メールの行（中尾様ご兄弟）で、候補どまりにしたはずの方の
     お名前・電話が、もう一方の既存行に書き込まれてしまっていた。
     ＝指摘1で塞いだ事故が、CSV取り込みから入ってきていた。
     → 'new' が既存行に相乗りしてよいのは「メールもお名前も一致する行」だけ。
       （同じCSVを入れ直したときに行が増えないようにするための最小限の照合） */
  var allowPhone = (mode === 'matched');
  var strictPair = (mode === 'new');
  /* 🔴 2026-11-13: 前回の strictPair は「メール＋お名前」だけだったため、
     メールが空の行では既存行が一生見つからず、取り込みを走らせるたびに
     customers に新しい行が積まれていた（CSVを書き出し直せば毎回新しい
     ファイルとして読み直されるので、運用上ふつうに起きる）。
     → メールが無ければ「電話＋お名前」の両方一致で探す。
       メールも電話も無い行は、そもそも連絡の取りようがないので行を作らない。 */
  var sh = sheet('customers', ['customer_id','email','name','phone','first_order','last_order','total_spent','order_count','line_uid','line_name','linked_at']);
  var data = sh.getDataRange().getValues();
  var h = (data[0] || []).map(function (x) { return String(x).trim(); });
  function col(n) { var i = h.indexOf(n); if (i === -1) { i = h.length; ensureColumns_(sh, i + 1); sh.getRange(1, i + 1).setValue(n); h.push(n); } return i; }
  var iE = col('email'), iN = col('name'), iP = col('phone'), iSrc = col('source'), iId = col('customer_id');

  /* 台帳（定期便マスター等）で分かっている情報。CSV側が空でもこちらで埋められる */
  var known = {
    email: probe.email || (m && m.email) || '',
    name:  probe.name  || (m && m.name)  || '',
    phone: probe.phone || (m && m.phone) || ''
  };

  var ek = matchEmailKey_(known.email), pk = matchPhoneKey_(known.phone),
      nk = custNameKey_(known.name);
  var target = -1;
  for (var i = 1; i < data.length; i++) {
    if (strictPair) {
      /* 相乗りしてよいのは「メール＋お名前」か「（メールが無ければ）電話＋お名前」が
         そろって一致する行だけ。片方だけでは相乗りしない。 */
      if (nk && ek && matchEmailKey_(data[i][iE]) === ek && custNameKey_(data[i][iN]) === nk) {
        target = i + 1; break;
      }
      if (nk && !ek && pk && matchPhoneKey_(data[i][iP]) === pk && custNameKey_(data[i][iN]) === nk) {
        target = i + 1; break;
      }
      continue;
    }
    if (ek && matchEmailKey_(data[i][iE]) === ek) { target = i + 1; break; }
    if (allowPhone && pk && matchPhoneKey_(data[i][iP]) === pk) { target = i + 1; break; }
  }

  if (target > 0) {
    var cur = sh.getRange(target, 1, 1, h.length).getValues()[0];
    function fillIfEmpty(idx, val) {
      if (idx < 0 || val === '' || val == null) return;
      if (!String(cur[idx] == null ? '' : cur[idx]).trim()) sh.getRange(target, idx + 1).setValue(val);
    }
    fillIfEmpty(iE, known.email);
    fillIfEmpty(iN, known.name);
    fillIfEmpty(iP, known.phone);
    if (res) res.cust_updated++;
    return { row: target, created: false };
  }

  /* ここで作る行は、ご購入額0・line_uid 空の「名簿の行」。
     🔴 定期便マスターにしか居なかったお客様を customers に迎え入れるのが
        この仕組みの目的（2026-11-13 指摘）。メール/電話で1人に絞れた方は
        台帳の情報で行を作る。 */
  /* 作らない行（おつなぎに使えず、取り込むたびに増えるだけなので数えるだけにする）:
      ① 連絡先がまったく無い（メールも電話も無い）
      ② 'new' で来て、お名前が無く、メールも無い（電話だけ）
         → 相乗りの条件（メール＋お名前／電話＋お名前）にどうしても当たらないため、
           走らせるたびに行が増える。お名前が無いので人が見ても確かめられない。
           ※ 'matched' は身元が1人に絞れているので、お名前が無くても作ってよい
             （次回は電話で自分の行を見つけるので増えない）。 */
  if (!ek && !pk) {
    if (res) res.no_contact++;
    return { row: -1, created: false };
  }
  if (strictPair && !nk && !ek) {
    if (res) res.no_contact++;
    return { row: -1, created: false };
  }

  var row = new Array(h.length).fill('');
  row[iId] = Utilities.getUuid();
  row[iE] = known.email;
  row[iN] = known.name;
  row[iP] = known.phone;
  row[iSrc] = (mode === 'matched')
    ? '旧カート取込（' + source + '・台帳と一致）'
    : '旧カート取込（' + source + '）';
  var iTs = h.indexOf('total_spent'), iOc = h.indexOf('order_count');
  if (iTs >= 0) row[iTs] = 0;
  if (iOc >= 0) row[iOc] = 0;
  sh.appendRow(row);
  if (res) res.cust_new++;
  return { row: sh.getLastRow(), created: true };
}
