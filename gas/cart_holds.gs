/* ============================================================
   カート確保（30分ホールド）
   ------------------------------------------------------------
   誰かがカートに入れた商品を、その時点から CART_HOLD_MINUTES 分だけ
   「確保中」として在庫から差し引く。＝売れていなくても残数が減る。

   ⚠️ 大前提: 表示だけ減らして実際は売る、は絶対にやらない。
      createCheckout の在庫検証（validateStockBeforeCheckout）も同じホールドを見るので、
      確保中の分は他のお客様が本当に買えない。表示と実態が一致している状態を保つこと。
      在庫と無関係に減る「演出用カウンタ」は景表法(有利誤認)違反になるので実装しない。

   ホールドの定義:
     直近 N 分に add_to_cart した session_id を 1商品につき1ホールドと数える。
     - 同じ人が連打しても 1（session × 商品 で重複排除）
     - すでに begin_checkout に進んだ session は除外
       （Stripe 側に移行済み。購入されれば stock が減るので二重に引かない）
     - localhost / 127.0.0.1 の開発セッションは除外
     - N 分経てば自動で失効する＝取り置きの解放も自動

   Script Properties:
     CART_HOLD_MINUTES  … ホールド時間（分・既定 30。analytics.js のセッション
                          ローテ 30 分と合わせてある）
     CART_HOLD_ENFORCE  … 'false' にすると決済ブロックだけ止まる（表示も自動で止める）

   関連: public/js/cart-holds.js（表示側）
   ============================================================ */

var CART_HOLD_DEFAULT_MINUTES = 30;
var CART_HOLD_CACHE_KEY = 'cart_hold_pairs_v1';
var CART_HOLD_CACHE_SEC = 30;
/* events は追記のみなので、末尾からこの行数だけ見れば 30 分は十分カバーできる */
var CART_HOLD_SCAN_ROWS = 1500;

function cartHoldMinutes_() {
  var v = Number(cfg('CART_HOLD_MINUTES'));
  return v > 0 ? v : CART_HOLD_DEFAULT_MINUTES;
}

/* 決済ブロックを効かせるか。false のとき表示側も確保表示をやめる（表示と実態を必ず一致させるため） */
function cartHoldEnforced_() {
  return String(cfg('CART_HOLD_ENFORCE') || 'true').toLowerCase() !== 'false';
}

/* ------------------------------------------------------------
   直近 N 分の「確保」を ['<session_id>|<商品名>', ...] で返す。
   30 秒キャッシュ（表示側が数十秒おきにポーリングするため）。
   ------------------------------------------------------------ */
function cartHoldPairs_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) {}
  if (cache) {
    var hit = cache.get(CART_HOLD_CACHE_KEY);
    if (hit) { try { return JSON.parse(hit); } catch (e2) {} }
  }

  var pairs = [];
  try {
    var sh = ss().getSheetByName('events');
    if (!sh) return pairs;
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return pairs;

    var span = Math.min(CART_HOLD_SCAN_ROWS, lastRow - 1);
    var data = sh.getRange(lastRow - span + 1, 1, span, EVENTS_HEADERS.length).getValues();
    /* 列は EVENTS_HEADERS 固定:
       0 ts / 1 event_type / 2 session_id / 3 page / 4 product_id / 5 value / 6 referrer / 7 ua / 8 meta_json */
    var now = new Date();
    var since = new Date(now.getTime() - cartHoldMinutes_() * 60 * 1000);

    var checkedOut = {};   /* 決済に進んだ session（= 二重に引かない） */
    var devSessions = {};  /* localhost 由来の開発セッション */
    var candidates = [];

    for (var i = 0; i < data.length; i++) {
      var ts = data[i][0];
      /* 未来日時の行は無視（手でシートを編集した／時計ズレ）。窓を [since, now] に閉じる */
      if (!(ts instanceof Date) || ts < since || ts > now) continue;

      var sid = String(data[i][2] || '');
      if (!sid) continue;

      var ref = String(data[i][6] || '');
      if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(ref)) { devSessions[sid] = true; continue; }

      var type = data[i][1];
      if (type === 'begin_checkout') { checkedOut[sid] = true; continue; }
      if (type !== 'add_to_cart') continue;

      var title = '';
      try { title = (JSON.parse(data[i][8] || '{}') || {}).title || ''; } catch (e3) {}
      if (!title) continue;   /* 商品名が取れない古いイベントは数えない（誤差より欠測を選ぶ） */

      candidates.push(sid + '|' + title);
    }

    var seen = {};
    for (var j = 0; j < candidates.length; j++) {
      var key = candidates[j];
      var s = key.slice(0, key.indexOf('|'));
      if (checkedOut[s] || devSessions[s] || seen[key]) continue;
      seen[key] = true;
      pairs.push(key);
    }
  } catch (e4) {
    log('cart_holds_error', { error: e4.message });
    return [];   /* 失敗時は「確保ゼロ」= 在庫そのまま表示（fail-open） */
  }

  if (cache) { try { cache.put(CART_HOLD_CACHE_KEY, JSON.stringify(pairs), CART_HOLD_CACHE_SEC); } catch (e5) {} }
  return pairs;
}

/* 商品名 → 確保数。excludeSession の分は数えない（自分のカートは自分の残数から引かない） */
function cartHoldsByTitle_(excludeSession) {
  var out = {};
  if (!cartHoldEnforced_()) return out;   /* 押さえないなら表示も減らさない */
  var pairs = cartHoldPairs_();
  var ex = String(excludeSession || '');
  for (var i = 0; i < pairs.length; i++) {
    var p = pairs[i];
    var cut = p.indexOf('|');
    var sid = p.slice(0, cut);
    if (ex && sid === ex) continue;
    var title = p.slice(cut + 1);
    out[title] = (out[title] || 0) + 1;
  }
  return out;
}

/* ------------------------------------------------------------
   GET ?action=cart_holds&session_id=<自分のセッション>
   → { ok, holds: {"商品名": 確保数}, hold_minutes, enforced, ts }
   在庫そのものは public_catalog が返すので、ここは差分だけ返す。
   ------------------------------------------------------------ */
function cartHoldsPublic(params) {
  var self = (params && params.session_id) || '';
  return jsonResponse({
    ok: true,
    holds: cartHoldsByTitle_(self),
    hold_minutes: cartHoldMinutes_(),
    enforced: cartHoldEnforced_(),
    ts: Date.now()
  });
}
