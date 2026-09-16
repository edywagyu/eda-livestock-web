/* ============================================================
   販売実績（売れた注文ベース）の集計  2026-09-05
   ロット台帳の「販売数」を products の在庫からの逆算ではなく、
   実際に売れた注文（orders）から出すための土台。

   ・orders の items_json を商品名ごとに合計する（paid / shipped のみ）。
   ・セット商品は products の components(BOM) で構成品に展開して数える
     （例: カメノコ・シンシン焼肉セット1つ → カメノコ焼肉1・シンシン焼肉1）。
     セットそのものの行も残すので、両方の見方ができる。
   ・書き出し先は本番EC注文DBの「販売実績_自動」タブ。毎回作り直す
     （手で書き換えても次回の更新で消える）。
   ・30分ごとの writeShippingSheet の最後から呼ばれる。
   ⚠️ ここに出るのは「新ECで売れた数」だけ。EC外の出庫（例: 2026-08-24
      今井美里様へカメノコ/シンシン各3パック）は入らない。ロット台帳の
      残数をこの数字だけで出すと、EC外の出庫ぶんが合わなくなる。
   ============================================================ */
/* ============================================================
   EC外出庫（手入力）タブ。卸・サンプル・贈答など、新ECの注文を
   通らずに出した肉をここに1行ずつ足す。ロット台帳の「残」はここも引く。
   無ければ作って見出しと既知の1件（2026-08-24 今井美里様）を入れる。
   ⚠️ 作るのは初回だけ。以後は中身に触らない（手入力が正）。
   ============================================================ */
var OFFSITE_TAB = 'EC外出庫';

function ensureOffsiteTab_() {
  var db = ss();
  var sh = db.getSheetByName(OFFSITE_TAB);
  if (sh) return 'あり';
  sh = db.insertSheet(OFFSITE_TAB);
  sh.getRange(1, 1, 1, 5).setValues([[
    'ECを通さずに出した肉を1行ずつ足してください（ロット台帳の「残」から引かれます）', '', '', '', ''
  ]]);
  sh.getRange(2, 1, 1, 5).setValues([[
    '出庫日', '商品名（ロット台帳・productsと完全一致）', '数量', '出荷先', '備考'
  ]]).setFontWeight('bold');
  sh.getRange(3, 1, 2, 5).setValues([
    ['2026/08/24', 'カメノコ焼肉', 3, '今井美里様',
     'Square請求書No.000004。0.6kg=3パック・¥3,892(税抜)＝¥1,297/パック'],
    ['2026/08/24', 'シンシン焼肉', 3, '今井美里様',
     'Square請求書No.000004。0.6kg=3パック・¥3,892(税抜)＝¥1,297/パック']
  ]);
  sh.setFrozenRows(2);
  sh.setColumnWidth(2, 260); sh.setColumnWidth(5, 420);
  return '作成';
}

var SOLD_TAB = '販売実績_自動';
var SOLD_TZ  = 'Asia/Tokyo';

/* products から 商品名 → components(BOM) を作る */
function soldBomMap_() {
  var ps = ss().getSheetByName('products');
  var map = {};
  if (!ps) return map;
  var d = ps.getDataRange().getValues(); if (d.length < 2) return map;
  var H = d[0];
  var iN = H.indexOf('name'), iC = H.indexOf('components');
  if (iN < 0 || iC < 0) return map;
  for (var r = 1; r < d.length; r++) {
    var n = String(d[r][iN] || '').trim(); if (!n) continue;
    var raw = String(d[r][iC] || '').trim(); if (!raw) continue;
    try {
      var arr = JSON.parse(raw);
      if (arr && arr.length) map[n] = arr;
    } catch (e) {}
  }
  return map;
}

function updateSoldCounts() {
  var db = ss();
  var os = db.getSheetByName('orders'); if (!os) return 'orders なし';
  var d = os.getDataRange().getValues(); if (d.length < 2) return 'orders 空';
  var H = d[0];
  var iIt = H.indexOf('items_json'), iSt = H.indexOf('payment_status'), iAt = H.indexOf('placed_at');
  if (iIt < 0 || iSt < 0) return '列が見つからない';

  var bom = soldBomMap_();
  var direct = {};   // 商品名 → 売れた数（カードに出ている商品そのもの）
  var real   = {};   // 商品名 → 実際に出る肉の数（セットを構成品に展開したもの）
  var lastAt = {};   // 商品名 → 最後に売れた日時

  for (var r = 1; r < d.length; r++) {
    var st = String(d[r][iSt] || '');
    if (st !== 'paid' && st !== 'shipped') continue;
    var items = [];
    try { items = JSON.parse(d[r][iIt] || '[]') || []; } catch (e) { items = []; }
    var at = d[r][iAt] ? new Date(d[r][iAt]) : null;
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var t = String(it.title || it.name || '').trim();
      var q = Number(it.qty || it.quantity || 0) || 0;
      if (!t || !q) continue;
      direct[t] = (direct[t] || 0) + q;
      if (at && (!lastAt[t] || at > lastAt[t])) lastAt[t] = at;
      var comp = bom[t];
      if (comp) {
        for (var k = 0; k < comp.length; k++) {
          var cn = String(comp[k].name || '').trim();
          var cq = Number(comp[k].qty || 0) || 0;
          if (!cn || !cq) continue;
          real[cn] = (real[cn] || 0) + q * cq;
          if (at && (!lastAt[cn] || at > lastAt[cn])) lastAt[cn] = at;
        }
      } else {
        real[t] = (real[t] || 0) + q;
      }
    }
  }

  var names = {};
  Object.keys(direct).forEach(function (n) { names[n] = 1; });
  Object.keys(real).forEach(function (n) { names[n] = 1; });

  var rows = Object.keys(names).map(function (n) {
    return [
      n,
      real[n] || 0,
      direct[n] || 0,
      bom[n] ? 'セット（中身に展開）' : '',
      lastAt[n] ? Utilities.formatDate(lastAt[n], SOLD_TZ, 'yyyy/MM/dd HH:mm') : ''
    ];
  });
  rows.sort(function (a, b) { return b[1] - a[1]; });

  var sh = db.getSheetByName(SOLD_TAB) || db.insertSheet(SOLD_TAB);
  sh.clear();
  var stamp = Utilities.formatDate(new Date(), SOLD_TZ, 'yyyy/MM/dd HH:mm');
  sh.getRange(1, 1, 1, 5).setValues([[
    '販売実績（新ECで売れた数・自動／手で書き換えても次回更新で消えます）', '', '', '', '更新: ' + stamp
  ]]);
  sh.getRange(2, 1, 1, 5).setValues([[
    '商品名', '売れた数（肉の実数）', '売れた数（カード単位）', '備考', '最後に売れた日時'
  ]]).setFontWeight('bold');
  if (rows.length) sh.getRange(3, 1, rows.length, 5).setValues(rows);
  sh.setFrozenRows(2);
  sh.getRange(rows.length + 4, 1).setValue(
    '「肉の実数」＝セットを中身に展開して数えたもの（ロット台帳の販売数はこちらを使う）。' +
    '「カード単位」＝売り場のカードが売れた数。対象は payment_status が paid / shipped の注文のみ。' +
    '⚠️ EC外の出庫（卸・サンプル等）はここに入りません。'
  );

  try { ensureOffsiteTab_(); } catch (e) {}
  try { log('sold_counts_sync', { rows: rows.length }); } catch (e) {}
  return '完了 / ' + rows.length + '品目 @' + stamp;
}
