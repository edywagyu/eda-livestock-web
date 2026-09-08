/* ============================================================
   予約注文 — 売り切れ商品の「次回最短お届け日」
   ------------------------------------------------------------
   2026-09-07 田崎さん決定の仕様をここ1か所に集約する。
   商品ページ / 商品一覧 / チェックアウトの3画面が全部これを読むので、
   日数や文言を変えるときはこのファイルだけを直せばよい。

   仕様:
     ・在庫が 0 になったら「次回最短お届け日」を出し、そのままカートに入れて買える
     ・表示日 = 在庫が0になった日 + LEAD_DAYS(9日)
         内訳 … ミートクレストの加工7日(暦日・2026年5〜8月の実測7ロットから決定)
                 ＋ 出荷準備 ＋ 配送
     ・全国どこでも同じ日付を出す（東西で出し分けない）
     ・ご入金は注文時（＝通常商品とまったく同じ決済フロー）
     ・在庫が1以上に戻ったら、日付も指定日の下限も注意書きも全部消える

   🔴 過去日は絶対に表示しない。
      「在庫が0になった日」(products シートの soldOutAt) が未記録だったり、
      記録があっても発注をかけないまま9日を過ぎている場合は、
      その日付を出すと「昨日お届け予定」の商品が店頭に並ぶ。
      そのときは「今日 + LEAD_DAYS」に読み替える。

   🔴 日曜着はスキップして月曜。配送バー(products.html shipCountdownInit)と同じ規則。
   ============================================================ */
(function () {
  'use strict';

  var LEAD_DAYS = 9;
  var WDAY = ['日', '月', '火', '水', '木', '金', '土'];

  function noon(d) { var x = new Date(d); x.setHours(12, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function today() { return noon(new Date()); }

  /* シートの値は Date で来ることも 'YYYY-MM-DD' 文字列で来ることもある */
  function parseDate(v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : noon(v);
    var s = String(v).trim();
    if (!s) return null;
    /* 🔴 シートに「文字列の 'YYYY-MM-DD'」ではなく「日付」として入っていると、
       GAS は UTC の ISO 文字列 ('2026-09-11T15:00:00.000Z' = JST 9/12 00:00) を返す。
       これを先頭の日付部分だけ切り出すと 9/11 になり、丸一日前倒しで約束してしまう。
       末尾に時刻(T…)が付いている値は Date として解釈し、ブラウザのタイムゾーンに
       直してから日付を取る（日本から見れば 9/12 になる）。 */
    if (/\d{4}-\d{2}-\d{2}T/.test(s)) {
      var iso = new Date(s);
      return isNaN(iso.getTime()) ? null : noon(iso);
    }
    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return noon(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : noon(d);
  }

  function skipSunday(d) { return d.getDay() === 0 ? addDays(d, 1) : d; }

  function toIso(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* 「9月16日（水）」 */
  function toLabel(d) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WDAY[d.getDay()] + '）';
  }

  function stockOf(p) {
    var n = Number(p && p.stock);
    return isNaN(n) ? null : n;
  }

  /* 📅 商品ごとの「この日以降でないと届けられない」指定（2026-09-08 追加）。
     products シートの shipFrom 列に 'YYYY-MM-DD' を入れると、在庫があっても
     その日より前の着日を選べなくなる。原料の入荷待ちで、売りは始めたいが
     早い着日は約束できない商品のため（はじめてセット＝バラ焼肉 9/10 入荷）。
     入荷して不要になったら列を空にするだけでよく、過ぎた日付は自動で無視される。 */
  function shipFromOf(product) {
    var d = parseDate(product && (product.shipFrom || product.shipfrom || product.ship_from));
    if (!d) return null;
    return d.getTime() > today().getTime() ? skipSunday(d) : null;   /* 過去日は出さない */
  }

  /* 在庫が無い＝予約受付の対象か */
  function isPreorder(product) {
    var s = stockOf(product);
    return s !== null && s <= 0;
  }

  /* 「次回最短お届け日」。在庫があり shipFrom も無いなら null（＝何も出さない） */
  function dateFor(product) {
    var sf = shipFromOf(product);
    if (!isPreorder(product)) return sf;      /* 在庫あり → shipFrom があればそれだけ効く */
    var base = parseDate(product.soldOutAt || product.soldoutAt || product.sold_out_at);
    var d = base ? addDays(base, LEAD_DAYS) : null;
    var t = today();
    /* 記録が無い / すでに過ぎている → 今日から数え直す（過去日は出さない） */
    if (!d || d.getTime() <= t.getTime()) d = addDays(t, LEAD_DAYS);
    d = skipSunday(d);
    /* 両方あるときは遅いほうを採る（どちらの制約も破らない） */
    return (sf && sf.getTime() > d.getTime()) ? sf : d;
  }

  function labelFor(product) { var d = dateFor(product); return d ? toLabel(d) : ''; }
  function isoFor(product) { var d = dateFor(product); return d ? toIso(d) : ''; }

  /* カタログ配列から商品名で引く索引を作る（各画面が持っている master をそのまま渡せる） */
  function indexByName(list) {
    var map = {};
    (list || []).forEach(function (p) { if (p && p.name) map[p.name] = p; });
    return map;
  }

  /* カートの中身から「予約になる商品」と「注文全体の最短お届け日」を出す。
     items … [{title, variant, qty}]  catalog … public_catalog の products 配列
     返り値 { items:[{title, label, iso, date}], date, iso, label }（無ければ date:null） */
  function forCart(items, catalog) {
    var byName = indexByName(catalog);
    var found = [];
    var latest = null;
    (items || []).forEach(function (it) {
      var t = (it && (it.title || it.name)) || '';
      var p = byName[t];
      /* 在庫切れ(予約)だけでなく、shipFrom で着日を後ろに寄せている商品も拾う。
         dateFor が null を返す＝どちらの制約も無い商品なので、そこで落ちる。 */
      if (!p) return;
      if (found.some(function (f) { return f.title === t; })) return;
      var d = dateFor(p);
      if (!d) return;
      found.push({ title: t, date: d, iso: toIso(d), label: toLabel(d) });
      if (!latest || d.getTime() > latest.getTime()) latest = d;
    });
    return {
      items: found,
      date: latest,
      iso: latest ? toIso(latest) : '',
      label: latest ? toLabel(latest) : ''
    };
  }

  window.EDA_PREORDER = {
    LEAD_DAYS: LEAD_DAYS,
    isPreorder: isPreorder,
    dateFor: dateFor,
    labelFor: labelFor,
    isoFor: isoFor,
    forCart: forCart,
    indexByName: indexByName,
    toIso: toIso,
    toLabel: toLabel
  };
})();
