/* ============================================================
   定期便プランの唯一の正本を読む部品（2026-10-05）
   ------------------------------------------------------------
   なぜ作ったか:
     プランの名前・価格・中身が subscription.html / shop.html /
     products.html / checkout.html / staff.html の5ファイルに
     同じ内容で直書きされていた。2026-08-30 のプラン刷新で4つは
     直したが checkout.html だけ取り残され、「画面に ¥3,490 と出て
     ¥4,640 請求される」という事故になった（PR #353 で修正）。

     正本は本番スプレッドシートの subscription_plans タブ。
     GAS の ?action=public_subscriptions がそれをそのまま返す。
     以後、各ページはこの部品だけを見る。

   使い方:
     <script src="public/js/eda-plans.js"></script>
     const plans = await EdaPlans.load();        // 配列（安い順）
     const p     = await EdaPlans.get('starter'); // 1件
     EdaPlans.byId(plans, 'starter');             // 読み込み済みから1件

   大事なこと:
     ・published が TRUE の行だけ返る（GAS 側で絞っている）。
       → 新プランは published=FALSE で仕込んでおけば、
         シートを TRUE にするだけで店頭に出る。コード変更は不要。
     ・通信が失敗しても FALLBACK で画面が出る（申込ページを白くしない）。
     ・金額は税込・送料込み。
   ============================================================ */
(function (global) {
  'use strict';

  var GAS_URL = (global.EDA_CONFIG && global.EDA_CONFIG.GAS_URL_PROD) ||
                (global.EDA_CONFIG && global.EDA_CONFIG.GAS_URL) ||
                'https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec';

  var CACHE_KEY = 'eda-plans-v1';
  var CACHE_TTL = 5 * 60 * 1000;   /* 5分。値上げ直後に古い値を見せ続けないため短め */

  /* 通信が落ちたときだけ使う最低限の内容。
     🔴 ここを増やさないこと。増やすと「5ファイルに直書き」に戻る。
        画面を白くしないための保険であって、正本ではない。 */
  var FALLBACK = [
    { planId: 'starter', name: 'ミニ',       target: '1人暮らし', spec: '1.2kg・6品',
      oldPrice: 9280,  firstMonthPrice: 4640,  savings: 4640,  individualPrice: 11400,
      items: '赤身ステーキ 200g, 赤身スライス 200g, 切り落とし 200g, 鶏モモ 200g, 鶏ムネ 200g, 鶏ミンチ 200g',
      featured: 'FALSE', badgeLabel: '', vipPerk: '', image: '', published: 'TRUE', stripePriceId: '' },
    { planId: 'regular', name: 'ライト',     target: '1-2名',     spec: '1.6kg・8品',
      oldPrice: 12300, firstMonthPrice: 6150,  savings: 6150,  individualPrice: 12900,
      items: '赤身ステーキ 200g, サイコロステーキ 200g, 赤身スライス 200g, 切り落とし 200g, 鶏モモ 200g, 鶏ムネ 200g, 鶏ミンチ 200g×2',
      featured: 'TRUE',  badgeLabel: '人気 No.1', vipPerk: '', image: '', published: 'TRUE', stripePriceId: '' },
    { planId: 'volume',  name: 'ファミリー', target: '3-4名',     spec: '2.8kg・14品',
      oldPrice: 21800, firstMonthPrice: 10900, savings: 10900, individualPrice: 26100,
      items: '赤身ステーキ 200g×2, 赤身スライス 200g×2, 切り落とし 200g×2, 霜降スライス 200g, サイコロステーキ 200g, 鶏モモ 200g×2, 鶏ムネ 200g×2, 鶏ミンチ 200g×2',
      featured: 'FALSE', badgeLabel: '💰 お得', vipPerk: '', image: '', published: 'TRUE', stripePriceId: '' }
  ];

  /* プランの英字ラベル（カードの上に出す「MINI · 毎月お届け」の左側）。
     ここに無い planId は planId から機械的に作る。 */
  /* 長いラベル（WAGYU FAMILY 等）はカード右上のバッジに重なるため、
     サイズだけにする。系統は入口とプラン名（和牛ミニ 等）で分かる。 */
  var CYCLE = {
    starter: 'MINI', regular: 'LIGHT', volume: 'FAMILY',
    wagyu_mini: 'MINI', wagyu_light: 'LIGHT', wagyu_family: 'FAMILY',
    chicken_mini: 'MINI', chicken_light: 'LIGHT', chicken_family: 'FAMILY'
  };

  /* 品目名 → 写真と一言。プランではなく「商品」の情報なので、
     プランが増えてもここは増えない。新しい部位を売り始めたときだけ足す。 */
  var ITEM_META = {
    '赤身ステーキ':       { img: 'public/images/products/drive/red-meat.jpg',        desc: 'モモ系赤身・脂少なめ' },
    'サーロインステーキ': { img: 'public/images/products/drive/sirloin.jpg',         desc: '王道の霜降り・厚切りで' },
    'ミスジステーキ':     { img: 'public/images/products/drive/misuji.jpg',          desc: '希少部位・肩の芯' },
    'ヒレステーキ':       { img: 'public/images/products/drive/fillet.jpg',          desc: '最もやわらかい部位' },
    'サイコロステーキ':   { img: 'public/images/products/drive/cube-steak.jpg',      desc: '一口サイズ・お弁当にも' },
    '赤身スライス':       { img: 'public/images/products/drive/wagyu-slice.jpg',     desc: 'しゃぶしゃぶ・すき焼きに' },
    '霜降スライス':       { img: 'public/images/products/drive/shimofuri-slice.jpg', desc: 'とろける甘み・すき焼きに' },
    '赤身焼肉':           { img: 'public/images/products/drive/akami-yakiniku.jpg',  desc: 'ウデ・噛みごたえのある赤身' },
    'バラ焼肉':           { img: 'public/images/products/drive/yakiniku-brisket.jpg', desc: 'バラ・脂の甘みで味を締める' },
    '切り落とし':         { img: 'public/images/products/drive/kiriotoshi-2026.jpg', desc: '牛丼・カレー・肉じゃがに' },
    '和牛ミンチ':         { img: 'public/images/products/drive/minced.jpg',          desc: 'ハンバーグ・そぼろに' },
    '鶏モモ':             { img: 'public/images/products/drive/chicken-thigh.jpg',   desc: '無投薬・平飼い・万能部位' },
    '鶏ムネ':             { img: 'public/images/products/drive/chicken-breast.jpg',  desc: '高たんぱく・低脂肪' },
    '鶏ミンチ':           { img: 'public/images/products/drive/chicken-minced.jpg',  desc: 'つくね・そぼろに' }
  };

  /* 系統（お客さんが最初に選ぶ3つの入口）。
     判定は planId の頭だけ。シートに列を足さなくても増やせる。
     写真は使わない（絵文字＋一言）＝画像の用意が不要。
     絵文字は肉(🥩🍗)ではなく動物(🐃🐓)。生産者が育てているものを出す。 */
  var LINES = [
    { key: 'mix',     emoji: '🐃🐓', name: '和牛＋鶏', lead: 'バランスよく楽しみたい方',
      note: '和牛と鶏、どちらも毎月。いちばん人気の組み合わせです。',
      test: function (id) { return !/^wagyu_|^chicken_/.test(id); } },
    { key: 'wagyu',   emoji: '🐃',   name: '和牛だけ', lead: '和牛のみ楽しみたい方',
      note: '月ごとに用途（ステーキ／焼肉／すき焼き／しゃぶしゃぶ）が変わります。',
      test: function (id) { return /^wagyu_/.test(id); } },
    { key: 'chicken', emoji: '🐓',   name: '鶏だけ',   lead: '鶏肉のみ楽しみたい方',
      note: '大分県・無投薬の平飼い鶏。モモとムネを半分ずつお届けします。',
      test: function (id) { return /^chicken_/.test(id); } }
  ];

  function lineOf(planId) {
    for (var i = 0; i < LINES.length; i++) if (LINES[i].test(String(planId || ''))) return LINES[i];
    return LINES[0];
  }

  /* 公開中のプランを系統ごとにまとめる。
     中身が1件も無い系統は返さない＝published=TRUE にした系統だけが店頭に出る。 */
  function groupByLine(rows) {
    return LINES.map(function (ln) {
      var plans = rows.filter(function (r) { return ln.test(r.planId); })
                      .sort(function (a, b) { return a.price - b.price; });
      if (!plans.length) return null;
      return {
        key: ln.key, emoji: ln.emoji, name: ln.name, lead: ln.lead, note: ln.note,
        plans: plans,
        minPrice: plans[0].price,
        maxPrice: plans[plans.length - 1].price,
        featured: plans.some(function (p) { return p.featured; })
      };
    }).filter(Boolean);
  }

  /* 全プラン共通の仕様（プランごとに変わらないのでシートに持たせない） */
  var SHARED_SPEC = {
    origin:  '肉(宮崎) / 鶏(大分)',
    process: '宮崎',
    feed:    '抗生物質 / ホルモン剤 不使用',
    storage: '冷凍（賞味期限6ヶ月）'
  };

  function num(v) { var n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; }
  function isTrue(v) { return String(v).trim().toUpperCase() === 'TRUE'; }

  /* "1.6kg・8品" → { weight:'1.6kg', count:8, grams:1600 } */
  function parseSpec(spec) {
    var s = String(spec || '');
    var w = s.match(/([\d.]+\s*(?:kg|g))/i);
    var c = s.match(/(\d+)\s*品/);
    var weight = w ? w[1].replace(/\s+/g, '') : '';
    var grams = 0;
    if (weight) {
      var v = parseFloat(weight);
      grams = /kg/i.test(weight) ? Math.round(v * 1000) : Math.round(v);
    }
    return { weight: weight, count: c ? Number(c[1]) : 0, grams: grams };
  }

  /* items の2つの書き方を、どちらも同じ「品目の配列」に直す。
     見た目を揃えるため、文章形でも箇条書きにできる形で返す。

     ① 毎月同じ中身: "赤身ステーキ 200g, 鶏ミンチ 200g×2"
     ② 月替わりの選出: "下記6種から毎月お届け：赤身ステーキ／サーロインステーキ／…（各200g）"
        → pool=true を立てる。②は「候補」であって実際の内訳ではないので、
          牛/鶏のg数の計算には使わない（6種×200g=1.2kg だが実際は800g 等になる）。 */
  function parseItems(items) {
    var raw = String(items || '').trim();
    if (!raw) return { list: [], note: '', pool: false };

    /* ② 選出型: 「：」の後ろを「／」で割る */
    if (/[:：]/.test(raw)) {
      var sp = raw.split(/[:：]/);
      var head = sp.shift().trim();
      var tail = sp.join('：').trim();
      if (tail.indexOf('／') >= 0 || tail.indexOf('/') >= 0) {
        /* 末尾の（各200g）を全品共通の単位として取り出す */
        var unitAll = '';
        tail = tail.replace(/[（(]\s*各\s*([\d.]+\s*(?:kg|g))\s*[)）]\s*$/i, function (m, u) {
          unitAll = u.replace(/\s+/g, ''); return '';
        }).trim();
        var names = tail.split(/\s*[／/]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (names.length) {
          return {
            pool: true,
            note: head,
            list: names.map(function (nm) {
              var meta = ITEM_META[nm] || {};
              return {
                name: nm, qty: unitAll, packs: 1, grams: 0,
                kind: /^鶏/.test(nm) ? 'chicken' : 'beef',
                img: meta.img || '', desc: meta.desc || ''
              };
            })
          };
        }
      }
      return { list: [], note: raw, pool: false };
    }

    var list = raw.split(/\s*,\s*/).filter(Boolean).map(function (chunk) {
      var m = chunk.match(/^(.+?)\s*([\d.]+\s*(?:kg|g))\s*(?:[×x*]\s*(\d+))?\s*$/i);
      var name = m ? m[1].trim() : chunk.trim();
      var unit = m ? m[2].replace(/\s+/g, '') : '';
      var packs = m && m[3] ? Number(m[3]) : 1;
      var one = unit ? (/kg/i.test(unit) ? parseFloat(unit) * 1000 : parseFloat(unit)) : 0;
      var meta = ITEM_META[name] || {};
      return {
        name: name,
        qty: unit ? (packs > 1 ? unit + ' × ' + packs : unit) : '',
        packs: packs,
        grams: Math.round(one * packs),
        kind: /^鶏/.test(name) ? 'chicken' : 'beef',
        img: meta.img || '',
        desc: meta.desc || ''
      };
    });
    return { list: list, note: '', pool: false };
  }

  /* シート1行 → 画面が使いやすい形 */
  function normalize(row) {
    var spec = parseSpec(row.spec);
    var parsed = parseItems(row.items);
    var price = num(row.oldPrice);
    var half = num(row.firstMonthPrice);
    var individual = num(row.individualPrice);

    var beef = 0, chicken = 0;
    if (!parsed.pool) {
      parsed.list.forEach(function (it) {
        if (it.kind === 'chicken') chicken += it.grams; else beef += it.grams;
      });
    }
    /* 選出型、または一覧が取れないときはプラン名から振り分ける
       （候補の合計は実際の内訳ではないので使わない） */
    if (parsed.pool || !parsed.list.length) {
      if (/^和牛/.test(row.name)) beef = spec.grams;
      else if (/^鶏/.test(row.name)) chicken = spec.grams;
      else beef = spec.grams;
    }

    /* 単品で買うより何%お得か。individualPrice が未入力なら出さない（0を返す） */
    var savingsPct = (individual > price && individual > 0)
      ? Math.round((1 - price / individual) * 100) : 0;

    /* 1年続けた場合のお得額 = 通常月11回ぶん + 初月ぶん */
    var yearly = (individual > 0)
      ? Math.max(0, (individual - price) * 11 + (individual - half)) : 0;

    /* "600g" / "1.6kg" の見せ方（カードの牛・鶏の内訳に使う） */
    function gLabel(g) {
      if (!g) return '';
      return g >= 1000 ? (Math.round(g / 100) / 10) + 'kg' : g + 'g';
    }

    return {
      planId: row.planId,
      name: row.name,
      target: row.target,
      /* 「1人暮らし · 1.2kg · 全6品（牛 600g + 鶏 600g）」 */
      targetLong: [
        row.target,
        spec.weight,
        spec.count ? ('全' + spec.count + '品') : ''
      ].filter(Boolean).join(' · ') + (function () {
        var parts = [];
        if (beef) parts.push('牛 ' + gLabel(beef));
        if (chicken) parts.push('鶏 ' + gLabel(chicken));
        return parts.length ? ('（' + parts.join(' + ') + '）') : '';
      })(),
      beefLabel: gLabel(beef),
      chickenLabel: gLabel(chicken),
      cycleLabel: CYCLE[row.planId] || String(row.planId || '').toUpperCase().replace(/_/g, ' '),
      spec: row.spec,
      weight: spec.weight,
      productCount: spec.count,
      grams: spec.grams,
      beefGrams: beef,
      chickenGrams: chicken,
      price: price,
      regular: price,          /* 既存コードが .regular を見ているための別名 */
      half: half,
      savings: num(row.savings),
      individualPrice: individual,
      individual: individual,  /* 同上 */
      savingsPct: savingsPct,
      yearlySavings: yearly,
      items: parsed.list,
      itemsNote: parsed.note,
      isPool: !!parsed.pool,   /* true=「この中から毎月選ぶ」候補。実際の内訳ではない */
      featured: isTrue(row.featured),
      badgeLabel: String(row.badgeLabel || '').trim(),
      vipPerk: String(row.vipPerk || '').trim(),
      image: String(row.image || '').trim(),
      stripePriceId: String(row.stripePriceId || '').trim(),
      shared: SHARED_SPEC,
      origin: SHARED_SPEC.origin,
      process: SHARED_SPEC.process,
      feed: SHARED_SPEC.feed,
      storage: SHARED_SPEC.storage
    };
  }

  function fromCache() {
    try {
      var hit = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (hit && hit.at && (Date.now() - hit.at) < CACHE_TTL && hit.rows && hit.rows.length) return hit.rows;
    } catch (e) {}
    return null;
  }

  function toCache(rows) {
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: rows })); } catch (e) {}
  }

  var pending = null;

  function load() {
    var cached = fromCache();
    if (cached) return Promise.resolve(cached.map(normalize)).then(sortByPrice);
    if (pending) return pending;

    pending = fetch(GAS_URL + '?action=public_subscriptions', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.plans || !d.plans.length) throw new Error('no plans');
        toCache(d.plans);
        return d.plans.map(normalize);
      })
      .catch(function (e) {
        try { console.warn('[EdaPlans] 正本の取得に失敗。保険の内容で表示します:', e && e.message); } catch (_) {}
        return FALLBACK.map(normalize);
      })
      .then(sortByPrice)
      .then(function (rows) { pending = null; return rows; });

    return pending;
  }

  /* products-loader.js のように「シートの生の行」を既に持っている画面向け。
     もう一度通信せずに正規化だけする。 */
  function fromRows(rows) {
    return sortByPrice((rows || []).map(normalize));
  }

  function sortByPrice(rows) {
    return rows.slice().sort(function (a, b) { return a.price - b.price; });
  }

  function byId(rows, planId) {
    for (var i = 0; i < rows.length; i++) if (rows[i].planId === planId) return rows[i];
    return null;
  }

  function get(planId) {
    return load().then(function (rows) { return byId(rows, planId); });
  }

  /* planId を辞書形式で欲しい画面のために */
  function asMap(rows) {
    var m = {};
    rows.forEach(function (r) { m[r.planId] = r; });
    return m;
  }

  function yen(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }

  global.EdaPlans = {
    load: load,
    fromRows: fromRows,
    LINES: LINES,
    lineOf: lineOf,
    groupByLine: groupByLine,
    get: get,
    byId: byId,
    asMap: asMap,
    yen: yen,
    parseSpec: parseSpec,
    parseItems: parseItems,
    ITEM_META: ITEM_META,
    SHARED_SPEC: SHARED_SPEC,
    FALLBACK: FALLBACK
  };
})(window);
