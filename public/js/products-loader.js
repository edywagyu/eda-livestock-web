/* ============================================================
   江田畜産 商品マスター動的ローダー
   ------------------------------------------------------------
   GAS Web App から products シート を取得し、
   window.EDA_PRODUCTS_MASTER を上書きする。

   バックエンドスプシ: 1kMLksRzJRFMKXotwF8IILZJlgUcjpxI84lRZoEBaOMo
   (江田畜産_EC_オペレーション_2026-05-17・GAS「江田畜産_EC_API」連携)
   ↓ products タブ
   https://docs.google.com/spreadsheets/d/1kMLksRzJRFMKXotwF8IILZJlgUcjpxI84lRZoEBaOMo/edit

   フロー:
   1. products-master.js が defer で読み込まれる (フォールバック)
   2. このスクリプトが GAS から最新を fetch
   3. 成功したら window.EDA_PRODUCTS_MASTER を上書き → stock badge 等が再描画
   4. 失敗したら products-master.js のデータをそのまま使う

   STAFF 編集:
   - スプシを直接編集 → 5 分以内に shop.html に反映 (sessionStorage キャッシュ)
   - 在庫だけは STAFF.html からも変更可能 (GAS staff_update_stock)
   ============================================================ */

(function() {
  'use strict';

  const GAS_URL = 'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';

  /* 5分キャッシュ (sessionStorage) — 同じ訪問内で何度も叩かない */
  const CACHE_KEY = 'eda-products-cache';
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function getCached() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) return null;
      return data;
    } catch (e) { return null; }
  }

  function setCached(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {}
  }

  /* ============================================================
     🧩 BOM (セット商品) — セット行の stock は当てにならない
     ------------------------------------------------------------
     gas/Code.gs の expandBundles_ は、components を持つセット商品を
     「構成品」に置き換えてから在庫を検査・減算する。置き換えなので
     セット行そのものは検査も減算もされず、stock が初期値のまま凍る。

     そのまま表示すると:
       ・「残り◯セット」が売れても動かない ＝ 在庫と無関係な数字
       ・stock が 0 にならないので「在庫切れ」もカートボタンの停止も
         永久に発動せず、肉が無くてもカートに入り決済で弾かれる

     そこで、セット商品のフロント側 stock を
       min( 構成品の stock ÷ 必要数 )  ＝ あと何セット作れるか
     で置き換える。構成品は単品としても売っているので、単品が売れた
     瞬間にもセットの残数が正しく減る。

     🔴 数字を出す唯一の根拠は構成品の実在庫。作り話の残数は出さない。
     🔴 構成品名は products シートの name と完全一致が前提 (GAS と同じ)。
        名前が見つからないセットは判定不能として stock を触らない
        (＝ GAS の validateStockBeforeCheckout と同じ fail-open)。
     ============================================================ */
  var BOM_MAX_DEPTH = 5;   /* 入れ子セットの打ち切り。gas/Code.gs と同じ */

  /* components は GAS からは JSON 文字列、同梱マスターからは配列で来る */
  function parseComponents(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) return raw.length ? raw : null;
    try {
      var a = JSON.parse(raw);
      return (Array.isArray(a) && a.length) ? a : null;
    } catch (e) { return null; }
  }

  function masterList() {
    return (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
  }

  function byName(list) {
    var m = {};
    (list || masterList()).forEach(function (p) { if (p && p.name) m[p.name] = p; });
    return m;
  }

  /* 「この商品はあと何個確保できるか」を再帰で解く。
     単品なら unitsOf(p) をそのまま返し、セットなら構成品の最小値を返す。
     判定できないとき (商品が見つからない) は null。 */
  function solve(name, map, unitsOf, depth) {
    var p = map[name];
    if (!p) return null;                                   /* 名前が一致しない＝判定不能 */
    var comps = (depth < BOM_MAX_DEPTH) ? parseComponents(p.components) : null;
    if (!comps) return Math.max(0, unitsOf(p));            /* 単品＝自分の在庫がそのまま答え */

    var min = Infinity;
    for (var i = 0; i < comps.length; i++) {
      var c = comps[i] || {};
      var cn = c.name || c.title;
      if (!cn) continue;
      var q = Number(c.qty) || 1;
      var sub = solve(cn, map, unitsOf, depth + 1);
      if (sub === null) return null;                       /* 構成品が不明＝セットも判定不能 */
      min = Math.min(min, Math.floor(sub / q));
    }
    return (min === Infinity) ? null : Math.max(0, min);
  }

  /* セット商品の stock を「あと何セット作れるか」に差し替える。
     セットでない商品と、判定不能なセットは触らない。 */
  function applyBomStock(list) {
    var map = byName(list);
    var units = function (p) { return Number(p.stock) || 0; };
    list.forEach(function (p) {
      if (!p.name || !parseComponents(p.components)) return;
      var n = solve(p.name, map, units, 0);
      if (n !== null) p.stock = n;
    });
  }

  /* 「いま買える数」= 構成品の実在庫から、他のお客様がカートに確保中の分を
     引いたもの。カート確保は単品名でもセット名でも記録されるので、
       ・構成品側の確保 … edaAvailable(構成品) で引く
       ・セット自体の確保 … 最後に edaHeldCount(セット名) を引く
     の二段で数える。cart-holds.js が無いページでは実在庫のまま返す。

     戻り値: セット商品なら残セット数 / セットでなければ null
     (呼び出し側が従来の単品ロジックにフォールバックできるように) */
  window.edaBomAvailable = function (name) {
    return bomSolve(name, function (q) {
      var s = Number(q.stock) || 0;
      if (typeof window.edaAvailable === 'function') {
        var a = window.edaAvailable(q.name, s);
        if (a !== null && a !== undefined) return a;
      }
      return s;
    }, true);
  };

  /* カート確保を引く前の「あと何セット作れるか」＝セットの実在庫。
     applyBomStock は GAS を取り直したときにしか走らないので、その間に単品が
     売れると p.stock が古いままになる。残数と在庫切れの判定がズレないよう、
     表示側はこちらを都度呼んで現在の構成品から作り直す。
     戻り値: セット商品なら残セット数 / セットでなければ null */
  window.edaBomStock = function (name) {
    return bomSolve(name, function (q) { return Number(q.stock) || 0; }, false);
  };

  function bomSolve(name, unitsOf, subtractOwnHold) {
    var map = byName();
    var p = map[name];
    if (!p || !parseComponents(p.components)) return null;   /* セットではない */
    var n = solve(name, map, unitsOf, 0);
    if (n === null) return null;
    if (!subtractOwnHold) return n;
    var held = (typeof window.edaHeldCount === 'function') ? window.edaHeldCount(name) : 0;
    return Math.max(0, n - held);
  }

  function applyProducts(products) {
    if (!Array.isArray(products) || products.length === 0) return;

    /* 限定品カウント(limited-stock.js)の3列は products シートに未追加でも動くようにする。
       GAS が値を返さない場合は products-master.js のフォールバックを引き継ぐ。
       ＝ シートに列を足せばシートが正、足すまでは同梱マスターが正。 */
    var prev = {};
    ((window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || []).forEach(function (p) {
      if (p.productId) prev[p.productId] = p;
    });
    function keep(p, key) {
      var v = p[key];
      if (v !== undefined && v !== null && String(v) !== '') return v;
      var old = prev[p.productId];
      return old ? old[key] : undefined;
    }

    /* 型整形: スプシは文字列で返るので数値カラムを変換 */
    const normalized = products.map(p => ({
      productId:     p.productId || '',
      variantId:     p.variantId || '',
      sku:           p.sku || '',
      stripePriceId: p.stripePriceId || '',
      name:          p.name || '',
      variant:       p.variant || '',
      price:         Number(p.price) || 0,
      weight:        Number(p.weight) || 0,
      stock:         Number(p.stock) || 0,
      temp:          p.temp || '冷凍',
      category:      p.category || '',
      categoryLabel: p.categoryLabel || '',
      tagEn:         p.tagEn || '',
      description:   p.description || '',
      images:        p.image ? [p.image] : [],
      isOrganic:     p.isOrganic === true || p.isOrganic === 'TRUE' || p.isOrganic === 'true',
      comingSoon:    p.comingSoon === true || p.comingSoon === 'TRUE' || p.comingSoon === 'true',
      published:     p.published !== false && p.published !== 'FALSE' && p.published !== 'false',
      /* 🧩 セット商品の構成品 (BOM)。これを捨てると下の applyBomStock が効かず、
         セットの残数がまた凍る。GAS は JSON 文字列で返す。 */
      components:    keep(p, 'components') || '',
      /* 限定品カウント (public/js/limited-stock.js) */
      limitedTotal:     keep(p, 'limitedTotal'),
      limitedStartAt:   keep(p, 'limitedStartAt'),
      limitedSoldOutAt: keep(p, 'limitedSoldOutAt'),
      limitedUntil:     keep(p, 'limitedUntil'),
      limitedUnit:      keep(p, 'limitedUnit') || ''
    }));

    /* 🧩 セット商品の stock を構成品から作り直す。
       これより後ろで在庫バッジ・カート上限・限定品の残数が全部この値を読むので、
       ここで直せば表示も購入導線も一度に正しくなる。 */
    applyBomStock(normalized);

    /* window.EDA_PRODUCTS_MASTER を更新 (products-master.js の構造に合わせる) */
    window.EDA_PRODUCTS_MASTER = window.EDA_PRODUCTS_MASTER || {};
    window.EDA_PRODUCTS_MASTER.products = normalized;
    window.EDA_PRODUCTS_MASTER.version  = 'gas-' + Date.now();

    /* 在庫バッジ等を再描画 (shop.html 内の関数) */
    if (typeof window.refreshStockBadges === 'function') {
      window.refreshStockBadges();
    }
    /* 価格・公開ステータス更新 + 新商品レンダリング */
    if (typeof window.refreshProductCards === 'function') {
      window.refreshProductCards();
    }

  }

  /* ギフト・定期便プランの適用 */
  function applyGifts(gifts) {
    if (typeof window.__renderGifts === 'function') {
      try { window.__renderGifts(gifts || []); } catch(e) {}
    }
  }
  function applyPlans(plans) {
    if (typeof window.__renderPlans === 'function') {
      try { window.__renderPlans(plans || []); } catch(e) {}
    }
  }

  /* メイン処理 */
  function load() {
    /* GAS が落ちている / 通信できないときは同梱の products-master.js がそのまま正になる。
       その場合もセットの残数と在庫切れ判定を構成品から作り直しておく
       (ここを飛ばすと、オフライン時だけ凍った残数が出てしまう)。 */
    applyBomStock(masterList());

    /* キャッシュヒット → 即適用 */
    const cached = getCached();
    if (cached) {
      applyProducts(cached.products || cached);
      if (cached.gifts) applyGifts(cached.gifts);
      if (cached.plans) applyPlans(cached.plans);
      return;
    }

    /* GAS から fetch (public_catalog で全部一括取得) */
    fetch(GAS_URL + '?action=public_catalog', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (data && data.ok) {
          const products = data.products || [];
          const gifts = data.gifts || [];
          const plans = data.plans || [];
          setCached({ products, gifts, plans });
          if (products.length > 0) applyProducts(products);
          applyGifts(gifts);
          applyPlans(plans);
        } else {
        }
      })
      .catch(e => {
      });
  }

  /* DOMContentLoaded 後に実行 (products-master.js が先に読み込まれる) */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
