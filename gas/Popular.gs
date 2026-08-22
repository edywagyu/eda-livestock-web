/* GET ?action=public_popular&days=14
   商品一覧を「売れている順」に並べるためのランキング。
   スコア = 購入数×3 + カート投入×2（popular.json の手動データと同じ基準）。

   なぜ公開APIか: 返すのは商品名・件数・スコアだけで個人情報を含まない。
   顧客名・メール・注文番号は一切載せないため認証不要で出せる。

   なぜ商品名がキーか: orders の items_json は title、events(add_to_cart) の
   meta_json も title を持つ。products シートの variantId('RED-MEAT'等)や
   HTML の data-variants の数値IDとは体系が違うので、両方に共通する商品名で束ねる。

   キャッシュ: 1時間（CacheService）。毎リクエストで orders/events を
   全走査すると重いため。在庫と違い分単位の鮮度は不要。 */
function publicPopular(params) {
  var days = parseInt((params && params.days) || '14', 10);
  if (!(days > 0)) days = 14;
  days = Math.min(days, 90);

  var cache = CacheService.getScriptCache();
  var cacheKey = 'public_popular_v1_' + days;
  try {
    var hit = cache.get(cacheKey);
    if (hit) return jsonResponse(JSON.parse(hit));
  } catch (e) {}

  var since = Date.now() - days * 24 * 3600 * 1000;
  var byName = {};
  function bump(name, field, n) {
    var k = String(name == null ? '' : name).trim();
    if (!k) return;
    if (!byName[k]) byName[k] = { purchase: 0, cart: 0 };
    byName[k][field] += n;
  }

  /* 1) 購入 — orders.items_json。入金前・キャンセルを人気に混ぜないため paid 以降のみ数える */
  try {
    var od = sheet('orders').getDataRange().getValues();
    var OH = od[0] || [];
    var cPlaced = OH.indexOf('placed_at');
    var cItems  = OH.indexOf('items_json');
    var cStatus = OH.indexOf('payment_status');
    if (cPlaced >= 0 && cItems >= 0) {
      for (var i = 1; i < od.length; i++) {
        var t = new Date(od[i][cPlaced]).getTime();
        if (!(t >= since)) continue;
        var st = String(cStatus >= 0 ? od[i][cStatus] : 'paid').toLowerCase();
        if (st !== 'paid' && st !== 'shipped' && st !== 'delivered') continue;
        var items = [];
        try { items = JSON.parse(od[i][cItems] || '[]'); } catch (e2) {}
        if (!items || !items.length) continue;
        for (var k = 0; k < items.length; k++) {
          var it = items[k] || {};
          bump(it.title || it.name, 'purchase', Number(it.qty) || 1);
        }
      }
    }
  } catch (e) { log('public_popular_orders_error', { error: String(e) }); }

  /* 2) カート投入 — events の add_to_cart。商品名は meta_json.title に入る */
  try {
    var ed = eventsSheet().getDataRange().getValues();
    var EH = ed[0] || [];
    var cTs = EH.indexOf('ts'), cType = EH.indexOf('event_type'), cMeta = EH.indexOf('meta_json');
    if (cTs >= 0 && cType >= 0 && cMeta >= 0) {
      for (var j = 1; j < ed.length; j++) {
        if (String(ed[j][cType]) !== 'add_to_cart') continue;
        var et = new Date(ed[j][cTs]).getTime();
        if (!(et >= since)) continue;
        var meta = {};
        try { meta = JSON.parse(ed[j][cMeta] || '{}'); } catch (e3) {}
        bump(meta && (meta.title || meta.name), 'cart', 1);
      }
    }
  } catch (e) { log('public_popular_events_error', { error: String(e) }); }

  var ranking = [];
  Object.keys(byName).forEach(function (name) {
    var s = byName[name];
    var score = s.purchase * 3 + s.cart * 2;
    if (score > 0) ranking.push({ name: name, purchase: s.purchase, cart: s.cart, score: score });
  });
  ranking.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);   /* 同点は名前順＝並びが日替わりでブレない */
  });
  ranking.forEach(function (r, i) { r.rank = i; });

  var out = {
    ok: true,
    updated: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    basis: '直近' + days + '日: 購入×3 + カート×2',
    days: days,
    ranking: ranking
  };
  try { cache.put(cacheKey, JSON.stringify(out), 3600); } catch (e) {}
  return jsonResponse(out);
}