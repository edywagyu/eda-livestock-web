/* ============================================================
   📅 今月サマリー — 管理画面ホームの「今月の売上 / 注文数 / 仕入れ額 / 粗利」
   ------------------------------------------------------------
   action: staff_month_summary  (STAFF_PROTECTED)

   ■ 数字の出所（2026-08-26 田崎さん確定）
     ・単品   = orders タブの mode=single / gift。ギフトは単品に含める。
                仕入れ額は「今月売れた分の原価」= ロット台帳の原価/パック × 販売数。
     ・定期便 = 定期便損益タブ（WIX/Shopify/新EC の23軒すべて）。
                売上・原価・件数をそのタブの当月行から合計する。
                ※ orders の subscription_renewal / subscription_first_month は
                  このタブに含まれているので二重計上しないよう単品側から除外する。

   ■ 数字の性質（カードのフッターにも同じ注記を出している）
     ・売上は税込（EC販売価格が税込）／原価は税抜（[[eda-ec-tax-basis]]）。
     ・粗利 = 売上 − 仕入れ額。送料・資材・決済手数料は引いていない。
     ・原価が引けない品目（下の COST_* に無い商品）は原価0で計上され、
       粗利がその分だけ大きく出る。何がいくつ未計上かは uncovered で返す。
   ============================================================ */

var MS_LOT_SHEET = 'ロット台帳';
var MS_SUB_SHEET = '定期便損益';

/* ロット台帳に無い品の原価（税抜・1パック/1個あたり）。
   出典 = [[eda-ec-profit-breakdown-method]] / [[eda-ec-pricing-formula]] の確定値。
   ここに無い商品は「原価未計上」として uncovered に出る。 */
var MS_COST_FALLBACK = {
  '鶏モモ': 450, '平飼い鶏 モモ': 450, 'オーガニックチキン モモ': 450,
  '鶏ムネ': 350, '平飼い鶏 ムネ': 350, 'オーガニックチキン ムネ': 350,
  '鶏ミンチ': 350, '平飼い鶏 ミンチ': 350, 'オーガニックチキン ミンチ': 350,
  'ハンバーグ': 500,   /* 130g/個 */
  'ホルモン': 372      /* 牛内臓セット¥66,000÷35.5kg の小腸200gパック */
};

/* 原価計算専用の構成表（セット商品 → 中身）。
   🔴 在庫減算の PRODUCT_BOM とは別物。ここを触っても在庫計算には影響しない。 */
var MS_COST_BOM = {
  '肉の日限定セット':                     [{ name: 'ミスジステーキ', qty: 1 }, { name: '切り落とし', qty: 1 }],
  'LINE会員限定 焼肉2種セット':           [{ name: '赤身焼肉',       qty: 1 }, { name: 'バラ焼肉',   qty: 1 }],
  'LINE会員限定 霜降スライス まとめ買い': [{ name: '霜降スライス',   qty: 1 }],  /* 2つ/3つ は variant 側で倍率が付く */
  '赤身ステーキ ギフト【竹】':            [{ name: '赤身ステーキ',   qty: 3 }],
  '和牛ハンバーグ ギフト【梅】':          [{ name: 'ハンバーグ',     qty: 5 }]
};

/* 商品名のゆらぎ吸収（注文履歴に残る旧表記 → 現在の商品名） */
function msNormalizeName_(name) {
  var n = String(name || '').trim();
  n = n.replace(/^江田和牛\s*/, '');
  return n;
}

/* variant の「2つ」「3つセット【5%オフ】」等を口数として読む（decrementStockAfterOrder と同じ規則） */
function msVariantUnits_(variant) {
  if (!variant) return 1;
  var m = String(variant).match(/([2-9])\s*(?:つ|個)\s*セット/);
  if (m) return Number(m[1]);
  if (String(variant).indexOf('3つ') >= 0) return 3;
  if (String(variant).indexOf('2つ') >= 0) return 2;
  return 1;
}

/* ロット台帳 → { 商品名: [{date, cost}, ...] }（仕入日の昇順）
   同じ商品でも仕入ロットごとに原価が変わるので、注文日時点の最新ロットを引けるようにする。 */
function msLotCostTable_() {
  var sh = ss().getSheetByName(MS_LOT_SHEET);
  if (!sh) return {};
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return {};

  var h = data[0].map(function (v) { return String(v).trim(); });
  var dateIdx = h.indexOf('仕入日');
  var nameIdx = h.indexOf('商品名');
  var costIdx = h.indexOf('原価/パック');
  if (dateIdx === -1 || nameIdx === -1 || costIdx === -1) return {};

  var table = {};
  for (var i = 1; i < data.length; i++) {
    var name = msNormalizeName_(data[i][nameIdx]);
    var cost = Number(String(data[i][costIdx]).replace(/[^0-9.-]/g, ''));
    if (!name || !cost) continue;
    var d = data[i][dateIdx] instanceof Date ? data[i][dateIdx] : new Date(data[i][dateIdx]);
    if (isNaN(d.getTime())) d = new Date(0);
    (table[name] = table[name] || []).push({ date: d.getTime(), cost: cost });
  }
  Object.keys(table).forEach(function (k) {
    table[k].sort(function (a, b) { return a.date - b.date; });
  });
  return table;
}

/* 注文日時点の原価/パックを引く。
   仕入日 <= 注文日 の中で最新のロット → 無ければ最古のロット → 無ければ固定値 → それも無ければ null */
function msUnitCost_(table, name, at) {
  var key = msNormalizeName_(name);
  var lots = table[key];
  if (lots && lots.length) {
    var t = at ? at.getTime() : Date.now();
    var picked = null;
    for (var i = 0; i < lots.length; i++) {
      if (lots[i].date <= t) picked = lots[i];
    }
    return (picked || lots[0]).cost;
  }
  if (MS_COST_FALLBACK[key] != null) return MS_COST_FALLBACK[key];
  return null;
}

/* items_json を「原価を引く単位」に展開する。セットは MS_COST_BOM で中身に置き換える。 */
function msExplodeItems_(items) {
  var units = {};
  (items || []).forEach(function (it) {
    var title = msNormalizeName_(it.title || it.name || '');
    if (!title) return;
    var n = msVariantUnits_(it.variant) * (Number(it.qty) || 1);
    units[title] = (units[title] || 0) + n;
  });

  /* 入れ子セット対策で深さ5まで展開（PRODUCT_BOM の expandBundles_ と同じ考え方） */
  for (var depth = 0; depth < 5; depth++) {
    var next = {}, expanded = false;
    Object.keys(units).forEach(function (title) {
      var comps = MS_COST_BOM[title];
      if (!comps) { next[title] = (next[title] || 0) + units[title]; return; }
      expanded = true;
      comps.forEach(function (c) {
        var nm = msNormalizeName_(c.name);
        next[nm] = (next[nm] || 0) + units[title] * (Number(c.qty) || 1);
      });
    });
    units = next;
    if (!expanded) break;
  }
  return units;
}

/* ===== 単品（single + gift）: orders タブから当月分を集計 ===== */
function msSinglePart_(from, to) {
  var sh = ss().getSheetByName('orders');
  if (!sh) return { revenue: 0, orders: 0, cost: 0, profit: 0, uncovered: [] };

  var data = sh.getDataRange().getValues();
  var lots = msLotCostTable_();
  var seen = {}, uncovered = {};
  var revenue = 0, orderCount = 0, cost = 0;

  for (var i = 1; i < data.length; i++) {
    var onum = data[i][0];
    if (onum && seen[onum]) continue;          /* webhook多重発火の重複行を二重計上しない */
    if (onum) seen[onum] = true;

    /* 届け先の無い注文(テスト/未完了)は売上に計上しない ＝ dashboardSummary と同基準 */
    var hasDest = false;
    try { var dj = JSON.parse(data[i][11] || '[]'); hasDest = Array.isArray(dj) && dj.length > 0; } catch (e) {}
    if (!hasDest) continue;

    /* 社内/テスト注文を除外 */
    if (String(data[i][4] || '').toLowerCase().indexOf('@eda-livestock.com') >= 0) continue;

    /* 定期便は定期便損益タブ側で数えるのでここでは除外（二重計上防止） */
    var mode = String(data[i][6] || '').toLowerCase();
    if (mode !== 'single' && mode !== 'gift') continue;

    var ps = String(data[i][9] || '').toLowerCase();
    if (ps !== 'paid' && ps !== 'shipped' && ps !== 'delivered') continue;

    var placedAt = data[i][1] instanceof Date ? data[i][1] : new Date(data[i][1]);
    if (isNaN(placedAt.getTime()) || placedAt < from || placedAt >= to) continue;

    revenue += Number(data[i][7]) || 0;
    orderCount++;

    var items = [];
    try { items = JSON.parse(data[i][12] || '[]'); } catch (e) {}
    var units = msExplodeItems_(items);
    Object.keys(units).forEach(function (name) {
      var unit = msUnitCost_(lots, name, placedAt);
      if (unit == null) { uncovered[name] = (uncovered[name] || 0) + units[name]; return; }
      cost += unit * units[name];
    });
  }

  return {
    revenue: Math.round(revenue),
    orders: orderCount,
    cost: Math.round(cost),
    profit: Math.round(revenue - cost),
    uncovered: Object.keys(uncovered).map(function (k) { return { name: k, qty: uncovered[k] }; })
                     .sort(function (a, b) { return b.qty - a.qty; })
  };
}

/* ===== 定期便: 定期便損益タブの当月行を合計 ===== */
function msSubscriptionPart_(month) {
  var empty = { revenue: 0, orders: 0, cost: 0, profit: 0, rows: 0, sheetMonths: [] };
  var sh = ss().getSheetByName(MS_SUB_SHEET);
  if (!sh) return empty;

  var data = sh.getDataRange().getValues();
  if (data.length < 2) return empty;

  var h = data[0].map(function (v) { return String(v).trim(); });
  var monthIdx = h.indexOf('月');
  var nameIdx  = h.indexOf('名前');
  var costIdx  = h.indexOf('原価(自動)');
  var priceIdx = h.indexOf('販売価格');
  if (monthIdx === -1 || nameIdx === -1 || costIdx === -1 || priceIdx === -1) return empty;

  var want = month + '月';
  var num = function (v) { return Number(String(v).replace(/[^0-9.-]/g, '')) || 0; };
  var revenue = 0, cost = 0, rows = 0, months = {}, noContent = [];

  /* 中身(和牛1〜7 / 鶏1〜3)が全部空 かつ 原価0 の行 = 商品が未選定。
     米プランは中身欄が空でも原価が入るので、原価0を条件に入れて誤検知を避ける。 */
  var contentIdx = [];
  ['和牛1','和牛2','和牛3','和牛4','和牛5','和牛6','和牛7','鶏1','鶏2','鶏3'].forEach(function (k) {
    var i = h.indexOf(k);
    if (i !== -1) contentIdx.push(i);
  });

  for (var i = 1; i < data.length; i++) {
    var m = String(data[i][monthIdx] || '').trim();
    if (!m || !data[i][nameIdx]) continue;
    months[m] = true;
    if (m !== want) continue;
    var c = num(data[i][costIdx]);
    revenue += num(data[i][priceIdx]);
    cost    += c;
    rows++;
    var filled = contentIdx.some(function (ci) { return String(data[i][ci] || '').trim() !== ''; });
    if (!filled && !c) noContent.push(String(data[i][nameIdx]).trim());
  }

  return {
    revenue: Math.round(revenue),
    orders: rows,
    cost: Math.round(cost),
    profit: Math.round(revenue - cost),
    rows: rows,
    noContent: noContent,              /* 中身が未選定で原価0の行 */
    sheetMonths: Object.keys(months)   /* タブに当月行が無いとき画面で気づけるように返す */
  };
}

/* GET ?action=staff_month_summary
   月は省略時＝今月。?month=2026-07 で過去月も出せる（単品側のみ。定期便タブは月列が一致した行だけ）。 */
function staffMonthSummary(params) {
  var tz = 'Asia/Tokyo';
  var now = new Date();
  var year = now.getFullYear(), month = now.getMonth() + 1;

  var q = String((params && params.month) || '').match(/^(\d{4})-(\d{1,2})$/);
  if (q) { year = Number(q[1]); month = Number(q[2]); }

  var from = new Date(year, month - 1, 1, 0, 0, 0);
  var to   = new Date(year, month,     1, 0, 0, 0);

  var single = msSinglePart_(from, to);
  var sub    = msSubscriptionPart_(month);

  return jsonResponse({
    ok: true,
    month: year + '-' + ('0' + month).slice(-2),
    monthLabel: month + '月',
    updatedAt: Utilities.formatDate(now, tz, 'M/d HH:mm'),
    single: single,
    subscription: sub,
    total: {
      revenue: single.revenue + sub.revenue,
      orders:  single.orders  + sub.orders,
      cost:    single.cost    + sub.cost,
      profit:  single.profit  + sub.profit
    },
    /* 画面のフッター注記に使う */
    basis: {
      singleSource: 'orders(single+gift) × ロット台帳の原価/パック',
      subscriptionSource: MS_SUB_SHEET + ' の「' + month + '月」行',
      taxNote: '売上=税込 / 原価=税抜。送料・資材・決済手数料は原価に含めない'
    }
  });
}
