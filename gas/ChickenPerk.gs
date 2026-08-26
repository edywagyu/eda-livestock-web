/* ============================================================
   🐔 鶏ムネ特典（購入時アンケート回答者への次回同梱）
   ------------------------------------------------------------
   購入完了ページの3問アンケートに答えたお客様には、お礼として
   「次回発送で鶏むね1個を無料同梱」する運用がある。
   回答は別GAS（eda-survey-gas）が別スプレッド
   「EDA 購入時アンケート回答」に1行ずつ記録し、
   F列「鶏むね同梱」が『未同梱』の行がスタッフのToDo（赤背景）。

   ただし ToDo は "回答した注文" ではなく "その人の次の注文" に
   紐づく。そのままでは発送作業をしていても気づけないため、ここで
     ① 未同梱の回答 → 注文番号 → orders から顧客(メール/電話)を特定
     ② その顧客の「回答より後の注文」に 🐔 の印を付ける
     ③ orders シートに chicken_perk 列として書き出す（スプレッド側）
     ④ staff_orders に chicken_perk を載せる（管理画面のバッジ）
     ⑤ 同梱したら staff_perk_done で回答シートを『同梱済』に戻す
   を行う。

   ⚠️ 前提: 回答スプレッド(CHICKEN_PERK_SHEET_ID)を、このGASの
      実行アカウント（＝最後に版上げした人）に編集者で共有しておく。
      共有が無い場合は例外を握りつぶして「特典なし」として動く
      （発送業務そのものは絶対に止めない）。
   ============================================================ */

var CHICKEN_PERK_SHEET_ID = '1Eifjyac8zCqLNL8zRZoSQeGzUFlD0NVPUWA3SiN8vzc';
var CHICKEN_PERK_COL      = 'chicken_perk';
var CHICKEN_PERK_TODO     = '要同梱（鶏ムネ1個）';
var CHICKEN_PERK_DONE     = '同梱済';
var CHICKEN_PERK_SOURCE   = '特典発生元（アンケート回答）';
/* 回答シートの列（eda-survey-gas の HEADERS と同じ並び。1始まり） */
var CP_C_AT = 1, CP_C_ORDER = 2, CP_C_STATUS = 6, CP_C_SESSION = 7, CP_C_WIDTH = 7;

/* ---------- 小道具 ---------- */
function cpNormEmail_(v) { return String(v || '').trim().toLowerCase(); }
function cpNormPhone_(v) {
  var d = String(v || '').replace(/[^0-9]/g, '');
  if (d.length > 10 && d.indexOf('81') === 0) d = '0' + d.slice(2); /* +81… を国内表記へ */
  return d.length >= 9 ? d.slice(-10) : '';   /* 先頭0の有無で揺れるので下10桁で比較 */
}
function cpDate_(v) { var d = new Date(v); return isNaN(d.getTime()) ? null : d; }

function cpSurveySheet_() {
  var ss = SpreadsheetApp.openById(CHICKEN_PERK_SHEET_ID);
  return ss.getSheets()[0];
}

/* 回答シートの全行を読む。共有されていない等で開けなければ [] を返す。 */
function cpSurveyRows_() {
  try {
    var sh = cpSurveySheet_();
    var last = sh.getLastRow();
    if (last < 2) return [];
    var vals = sh.getRange(2, 1, last - 1, CP_C_WIDTH).getValues();
    var out = [];
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      var order = String(r[CP_C_ORDER - 1] || '').trim();
      if (!order) continue;
      out.push({
        row: i + 2,
        at: cpDate_(r[CP_C_AT - 1]),
        orderNumber: order,
        status: String(r[CP_C_STATUS - 1] || '').trim(),
        sessionId: String(r[CP_C_SESSION - 1] || '').trim(),
        done: String(r[CP_C_STATUS - 1] || '').trim() === CHICKEN_PERK_DONE
      });
    }
    return out;
  } catch (e) {
    log('chicken_perk_read_error', { error: e.message });
    return [];
  }
}

/* 未同梱の回答を「顧客」に畳み込む。
   返り値: { byEmail:{email:perk}, byPhone:{phone:perk}, list:[perk] }
   perk = { orderNumber, at, email, phone, rows:[回答シートの行番号] } */
function cpPendingIndex_() {
  var rows = cpSurveyRows_().filter(function (r) { return !r.done; });
  var idx = { byEmail: {}, byPhone: {}, bySourceOrder: {}, list: [] };
  if (!rows.length) return idx;

  /* orders から 注文番号 → メール/電話 を引く */
  var sh = sheet('orders');
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return idx;
  var h = data[0];
  var iOn = h.indexOf('order_number'), iEm = h.indexOf('customer_email'), iPh = h.indexOf('customer_phone');
  if (iOn === -1) return idx;
  var byOrder = {};
  for (var i = 1; i < data.length; i++) {
    var on = String(data[i][iOn] || '').trim();
    if (on) byOrder[on] = { email: cpNormEmail_(iEm >= 0 ? data[i][iEm] : ''), phone: cpNormPhone_(iPh >= 0 ? data[i][iPh] : '') };
  }

  /* 同じ回答が二重記録されることがある（通知メールも2通来る）ので
     session_id、無ければ注文番号で1人にまとめる */
  var merged = {};
  rows.forEach(function (r) {
    var who = byOrder[r.orderNumber] || { email: '', phone: '' };
    var key = r.sessionId || r.orderNumber;
    if (!merged[key]) {
      merged[key] = { orderNumber: r.orderNumber, at: r.at, email: who.email, phone: who.phone, rows: [] };
    }
    merged[key].rows.push(r.row);
    if (r.at && (!merged[key].at || r.at < merged[key].at)) merged[key].at = r.at;
  });

  Object.keys(merged).forEach(function (k) {
    var p = merged[k];
    idx.list.push(p);
    idx.bySourceOrder[p.orderNumber] = p;
    if (p.email) idx.byEmail[p.email] = p;
    if (p.phone) idx.byPhone[p.phone] = p;
  });
  return idx;
}

/* 1件の注文に対する特典の状態を返す。'' / CHICKEN_PERK_TODO / CHICKEN_PERK_SOURCE
   paymentStatus を渡すと「回答を出した注文がまだ未発送」の場合も同梱対象にする
   （＝次回を待たずにその箱へ入れる。定期便の初回申込がこれに当たる）。 */
function cpStateForOrder_(idx, orderNumber, email, phone, placedAt, paymentStatus) {
  var on = String(orderNumber || '').trim();
  var st = String(paymentStatus || '').toLowerCase();
  var shipped = (st === 'shipped' || st === 'delivered');
  if (on && idx.bySourceOrder[on]) {
    /* 回答を出した注文そのもの。まだ発送していないならこの箱に入れるのが最短。 */
    return shipped ? CHICKEN_PERK_SOURCE : CHICKEN_PERK_TODO;
  }
  if (shipped) return '';                                        /* 発送済の過去注文には付けない */
  var p = idx.byEmail[cpNormEmail_(email)] || idx.byPhone[cpNormPhone_(phone)];
  if (!p) return '';
  var d = cpDate_(placedAt);
  if (p.at && d && d < p.at) return '';                          /* 回答より前の注文には付けない */
  return CHICKEN_PERK_TODO;
}

/* ---------- orders シートへの書き出し（スプレッドシート側の可視化） ---------- */
/* chicken_perk 列を（無ければ）作り、未発送〜直近の注文について印を更新する。
   30分ごとの writeShippingSheet から呼ばれる。列はヘッダー名で引くので
   列を足しても既存コードは壊れない。 */
function syncChickenPerkColumn_() {
  try {
    var idx = cpPendingIndex_();
    var sh = sheet('orders');
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return 'no_orders';
    var h = data[0];
    var iOn = h.indexOf('order_number'), iEm = h.indexOf('customer_email'),
        iPh = h.indexOf('customer_phone'), iAt = h.indexOf('placed_at'),
        iSt = h.indexOf('payment_status');
    var iCp = h.indexOf(CHICKEN_PERK_COL);
    if (iCp === -1) {
      iCp = h.length;
      sh.getRange(1, iCp + 1).setValue(CHICKEN_PERK_COL);
      sh.getRange(1, iCp + 1).setFontWeight('bold');
    }
    var changed = 0;
    /* 直近200件だけ見る（過去の確定分は触らない） */
    var from = Math.max(1, data.length - 200);
    for (var i = from; i < data.length; i++) {
      var cur = String(data[i][iCp] || '').trim();
      if (cur.indexOf(CHICKEN_PERK_DONE) === 0) continue;        /* 同梱済は上書きしない */
      var want = cpStateForOrder_(idx, data[i][iOn],
                                  iEm >= 0 ? data[i][iEm] : '',
                                  iPh >= 0 ? data[i][iPh] : '',
                                  iAt >= 0 ? data[i][iAt] : '',
                                  iSt >= 0 ? data[i][iSt] : '');
      if (cur === want) continue;
      var cell = sh.getRange(i + 1, iCp + 1);
      cell.setValue(want);
      cell.setBackground(want === CHICKEN_PERK_TODO ? '#FDE7E7' : null);
      cell.setFontColor(want === CHICKEN_PERK_TODO ? '#B91C1C' : null);
      cell.setFontWeight(want === CHICKEN_PERK_TODO ? 'bold' : 'normal');
      changed++;
    }
    if (changed) SpreadsheetApp.flush();
    return 'ok:' + changed;
  } catch (e) {
    log('chicken_perk_sync_error', { error: e.message });
    return 'error:' + e.message;
  }
}

/* ---------- GET staff_perks : 未同梱の一覧（管理画面用） ---------- */
function staffPerks() {
  try {
    var idx = cpPendingIndex_();
    if (!idx.list.length) return jsonResponse({ ok: true, perks: [], linked: [] });

    var sh = sheet('orders');
    var data = sh.getDataRange().getValues();
    var h = data[0];
    var iOn = h.indexOf('order_number'), iEm = h.indexOf('customer_email'),
        iPh = h.indexOf('customer_phone'), iNm = h.indexOf('customer_name'),
        iAt = h.indexOf('placed_at'), iSt = h.indexOf('payment_status');

    /* 各特典について「これから発送する注文（未発送）」があれば紐づける */
    var linked = idx.list.map(function (p) {
      var target = null;
      for (var i = data.length - 1; i >= 1; i--) {
        var on = String(data[i][iOn] || '').trim();
        if (on === p.orderNumber) continue;
        var em = cpNormEmail_(iEm >= 0 ? data[i][iEm] : '');
        var ph = cpNormPhone_(iPh >= 0 ? data[i][iPh] : '');
        if ((p.email && em === p.email) || (p.phone && ph === p.phone)) {
          var st = String(iSt >= 0 ? data[i][iSt] : '').toLowerCase();
          var d = cpDate_(iAt >= 0 ? data[i][iAt] : '');
          if (p.at && d && d < p.at) continue;
          target = { order_number: on, placed_at: String(iAt >= 0 ? data[i][iAt] : ''), shipped: (st === 'shipped' || st === 'delivered') };
          if (!target.shipped) break;   /* 未発送を優先 */
        }
      }
      /* 顧客名は発生元の注文から取る */
      var name = '';
      for (var j = 1; j < data.length; j++) {
        if (String(data[j][iOn] || '').trim() === p.orderNumber) { name = iNm >= 0 ? String(data[j][iNm] || '') : ''; break; }
      }
      return {
        source_order: p.orderNumber,
        customer_name: name,
        email: p.email,
        phone: p.phone,
        answered_at: p.at ? Utilities.formatDate(p.at, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '',
        next_order: target
      };
    });
    return jsonResponse({ ok: true, perks: linked, count: linked.length });
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message });
  }
}

/* ---------- POST staff_perk_done { order_number } ----------
   「この注文に鶏ムネを入れた」を記録する。
   ・回答シートの該当行を『同梱済』にし、赤背景を戻す
   ・orders の chicken_perk を『同梱済（注文番号）』にする */
function staffPerkDone(body) {
  var on = String((body && body.order_number) || '').trim();
  if (!on) throw new Error('order_number required');

  var sh = sheet('orders');
  var data = sh.getDataRange().getValues();
  var h = data[0];
  var iOn = h.indexOf('order_number'), iEm = h.indexOf('customer_email'), iPh = h.indexOf('customer_phone');
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) { if (String(data[i][iOn] || '').trim() === on) { rowIdx = i; break; } }
  if (rowIdx === -1) return jsonResponse({ ok: false, error: '注文が見つかりません: ' + on });

  var email = cpNormEmail_(iEm >= 0 ? data[rowIdx][iEm] : '');
  var phone = cpNormPhone_(iPh >= 0 ? data[rowIdx][iPh] : '');

  var idx = cpPendingIndex_();
  var p = idx.byEmail[email] || idx.byPhone[phone] || idx.bySourceOrder[on];
  if (!p) return jsonResponse({ ok: false, error: 'この注文に未同梱の鶏ムネ特典が見つかりません' });

  /* 回答シートを『同梱済』へ */
  var updated = 0;
  try {
    var ssh = cpSurveySheet_();
    p.rows.forEach(function (r) {
      ssh.getRange(r, CP_C_STATUS).setValue(CHICKEN_PERK_DONE);
      ssh.getRange(r, 1, 1, CP_C_WIDTH).setBackground(null);
      ssh.getRange(r, CP_C_STATUS).setBackground('#E8FAF0').setFontColor('#065F46')
         .setFontWeight('bold').setHorizontalAlignment('center');
      ssh.getRange(r, CP_C_STATUS).setNote('同梱: ' + on + ' / ' +
        Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));
      updated++;
    });
    SpreadsheetApp.flush();
  } catch (e) {
    return jsonResponse({ ok: false, error: '回答シートを更新できませんでした（共有設定を確認してください）: ' + e.message });
  }

  /* orders 側にも印を残す */
  var iCp = h.indexOf(CHICKEN_PERK_COL);
  if (iCp === -1) { iCp = h.length; sh.getRange(1, iCp + 1).setValue(CHICKEN_PERK_COL).setFontWeight('bold'); }
  var cell = sh.getRange(rowIdx + 1, iCp + 1);
  cell.setValue(CHICKEN_PERK_DONE + '（' + on + '）');
  cell.setBackground('#E8FAF0').setFontColor('#065F46').setFontWeight('bold');
  SpreadsheetApp.flush();

  log('chicken_perk_done', { order_number: on, source_order: p.orderNumber, rows: updated });
  return jsonResponse({ ok: true, order_number: on, source_order: p.orderNumber, updated_rows: updated });
}
