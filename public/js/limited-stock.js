/* ============================================================
   限定品カウント（汎用）
   ------------------------------------------------------------
   products シートの3列だけで、どの商品でも「残り◯」を出せるようにする。
   campaign ごとのコード修正・HTML追加・終了後の削除を不要にするのが目的。

     limitedTotal     … 限定総数（例 12）。これが入っている商品だけ対象。表示専用の分母。
     limitedSoldOutAt … 販売停止日時（省略可）。過ぎたら stock を 0 扱いにして
                        「完売しました」に切り替える。表示自体は limitedUntil まで残る。
                        ＝ サイトの販売は止めるが告知はしばらく出しておきたいとき用。
     limitedUntil     … 表示終了日時（例 2026/08/29 23:59）。過ぎたら表示が全部自動で消える。
     limitedUnit      … 単位（省略可。空なら「セット」か「点」を名前から自動判定）

   省略時は limitedSoldOutAt = limitedUntil（＝締切と同時に消える従来どおりの動き）。

   残数 = stock − 他のお客様のカート確保（public/js/cart-holds.js）。
   ＝ 実在庫と、本当に押さえている分だけで作った数字。嘘の残数は出さない。

   HTML側のフック（どれも任意。付けなくてもカードとPDPには自動で出る）:
     [data-limited-scope="商品名"] … 期間外になったら要素ごと非表示。
                                     販促バナーを丸ごと囲えば終了後に自動で消える。
     [data-limited-left="商品名"]  … 中身を「残り◯セット」に置き換える。
                                     手書きのコピーの中に残数を埋め込みたいときに使う。

   関連: public/js/cart-holds.js（確保数）/ gas/cart_holds.gs
   ============================================================ */
(function () {
  'use strict';

  var LOW_AT = 10;   /* これ以下で強調（.is-low） */

  function products() {
    return (window.EDA_PRODUCTS_MASTER && window.EDA_PRODUCTS_MASTER.products) || [];
  }

  function parseUntil(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    /* シートは "2026/08/29 23:59" や ISO で返ってくる。Safari は "/" 区切りを解釈できないことがある */
    var s = String(v).trim();
    var m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59), 59);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function unitOf(p) {
    if (p.limitedUnit) return String(p.limitedUnit);
    var s = (p.name || '') + ' ' + (p.variant || '');
    return s.indexOf('セット') >= 0 ? 'セット' : '点';
  }

  /* 販売停止時刻。未指定なら表示終了時刻と同じ＝従来どおり「消えるまで売る」 */
  function soldOutAtOf(p) {
    return parseUntil(p.limitedSoldOutAt) || parseUntil(p.limitedUntil);
  }

  /* 販売開始時刻（省略可）。指定があり、まだ来ていなければ「発売前」＝表示も購入もさせない。
     省略時は従来どおり（開始ゲートなし＝すぐ販売）。 */
  function startAtOf(p) {
    return parseUntil(p.limitedStartAt);
  }
  function notStarted(p) {
    var s = startAtOf(p);
    return !!(s && new Date() < s);
  }

  /* 販売停止時刻を過ぎた限定品は stock を 0 に落とす。
     こうすると在庫切れバッジ・カートボタン無効化・カート追加時の上限チェックといった
     既存の在庫切れ処理がそのまま効く（限定品専用の販売停止コードを増やさない）。
     表示を消すのは limitedUntil の仕事なので、ここでは消さない。 */
  function closeSales() {
    var now = new Date();
    var changed = false;
    products().forEach(function (p) {
      var total = Number(p.limitedTotal);
      if (!isFinite(total) || total <= 0 || !p.name) return;
      var at = soldOutAtOf(p);
      if (at && now > at && Number(p.stock) !== 0) { p.stock = 0; changed = true; }
    });
    return changed;
  }

  /* 限定キャンペーンが有効な商品を { 商品名: {...} } で返す */
  function activeLimited() {
    var out = {};
    var now = new Date();
    products().forEach(function (p) {
      var total = Number(p.limitedTotal);
      if (!isFinite(total) || total <= 0) return;
      var until = parseUntil(p.limitedUntil);
      if (until && now > until) return;          /* 表示終了＝もう出さない */
      if (!p.name) return;
      /* 発売前(limitedStartAt 未到来)は「予告」として扱う＝カードは見せるが購入は不可。
         upcoming フラグでラベル・購入導線を切り替える。 */
      var start = startAtOf(p);
      var upcoming = !!(start && now < start);

      var stock = Number(p.stock);
      if (!isFinite(stock)) stock = 0;
      var avail = stock;
      if (typeof window.edaAvailable === 'function') {
        var a = window.edaAvailable(p.name, stock);
        if (a !== null) avail = a;
      }
      var at = soldOutAtOf(p);
      out[p.name] = {
        product: p, until: until, soldOutAt: at, total: total, unit: unitOf(p),
        stock: stock, available: avail,
        upcoming: upcoming, startAt: start,      /* 発売前＝予告表示 */
        closed: !!(at && now > at)               /* 販売停止済み（表示は残っている） */
      };
    });
    return out;
  }

  /* もう売らない限定品を { 商品名: {product, hidden} } で返す。
     販売停止時刻を過ぎたもの全部（表示終了済みかどうかは hidden で区別）。
     PDP の購入導線を閉じるのに使う。 */
  function endedLimited() {
    var out = {};
    var now = new Date();
    products().forEach(function (p) {
      var total = Number(p.limitedTotal);
      if (!isFinite(total) || total <= 0 || !p.name) return;
      var at = soldOutAtOf(p);
      if (!at || now <= at) return;
      var until = parseUntil(p.limitedUntil);
      out[p.name] = { product: p, hidden: !!(until && now > until) };
    });
    return out;
  }

  /* まだ発売前の限定品を { 商品名: {product, upcoming, startAt} } で返す。
     product.html?id=… の直リンクを発売前に踏んでも購入させないための判定。 */
  function upcomingLimited() {
    var out = {};
    products().forEach(function (p) {
      var total = Number(p.limitedTotal);
      if (!isFinite(total) || total <= 0 || !p.name) return;
      if (!notStarted(p)) return;
      out[p.name] = { product: p, upcoming: true, startAt: startAtOf(p) };
    });
    return out;
  }

  /* 「◯月◯日（曜）◯:◯◯」表記（発売予定の告知に使う） */
  function fmtDateTime(d) {
    if (!d) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日'
      + '（' + '日月火水木金土'.charAt(d.getDay()) + '）'
      + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* 「◯/◯（曜）」短縮表記（カードの予告リボン用） */
  function fmtDateShort(d) {
    if (!d) return '';
    return (d.getMonth() + 1) + '/' + d.getDate()
      + '（' + '日月火水木金土'.charAt(d.getDay()) + '）';
  }

  /* ===== 動くカウントダウン（残り時間を1秒ごとに更新） =====================
     [.limited-countdown-eda data-eda-deadline="<epoch ms>"] の中身を
     「残り 1日 03:12:45」のように毎秒書き換える。1時間を切ったら .is-urgent。
     設置は applyPdp（PDPの帯）と applyCards（一覧カード）が行う。 */
  function pad2(n) { return ('0' + n).slice(-2); }
  function fmtRemain(ms) {
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600);  s -= h * 3600;
    var m = Math.floor(s / 60);    s -= m * 60;
    var hms = pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    return d > 0 ? (d + '日と' + hms) : hms;
  }
  function tickCountdowns() {
    var now = Date.now();
    document.querySelectorAll('.limited-countdown-eda[data-eda-deadline]').forEach(function (el) {
      var dl = Number(el.getAttribute('data-eda-deadline'));
      if (!isFinite(dl)) { el.textContent = ''; return; }
      var rem = dl - now;
      if (rem <= 0) { el.textContent = '受付終了'; el.classList.remove('is-urgent'); return; }
      el.textContent = '残り ' + fmtRemain(rem);
      el.classList.toggle('is-urgent', rem <= 3600000);   /* 残り1時間以内で強調 */
    });
  }
  var _cdTimer = null;
  function ensureCountdownTicker() {
    ensureCountdownCss();
    if (!_cdTimer) _cdTimer = setInterval(tickCountdowns, 1000);
  }
  function ensureCountdownCss() {
    if (document.getElementById('limited-countdown-css')) return;
    var s = document.createElement('style');
    s.id = 'limited-countdown-css';
    s.textContent =
      '.limited-countdown-eda{display:inline-block;font-variant-numeric:tabular-nums;'
      + 'font-weight:800;letter-spacing:.02em;color:#C8102E;white-space:nowrap}'
      /* PDPの帯は濃い赤地。赤文字＋薄赤背景だと沈んで読めなかったので白ピルにする。
         色はブランドの森緑(#0F3D2E)で、赤い「残り◯セット」と役割を色分けする（2026-08-06）。 */
      + '.limited-banner-text .limited-countdown-eda{margin-left:6px;padding:2px 10px;'
      + 'border-radius:999px;background:#fff;color:#0F3D2E;font-size:.95em;'
      + 'box-shadow:0 1px 3px rgba(0,0,0,.18)}'
      + '.limited-banner-text .limited-countdown-eda.is-urgent{background:#0F3D2E;color:#fff}'
      /* 帯の3行構成（見出し＋値を縦積み） */
      + '.limited-banner-text{display:block}'
      + '.limited-banner-text .lb-row{display:block;line-height:1.9}'
      + '.limited-banner-text .lb-row-head{margin-bottom:2px}'
      + '.limited-banner-text .lb-deadline{margin-left:8px;font-weight:700}'
      + '.limited-banner-text .lb-label{opacity:.85}'
      + '.limited-countdown-eda.is-urgent{animation:edaCdPulse 1s steps(2,start) infinite}'
      + '@keyframes edaCdPulse{50%{opacity:.5}}'
      + '.product-card-img .limited-countdown-eda{position:absolute;left:8px;bottom:8px;'
      + 'z-index:3;padding:2px 9px;border-radius:999px;font-size:11px;'
      + 'background:rgba(17,17,17,.78);color:#fff}'
      + '.product-card-img .limited-countdown-eda.is-urgent{background:rgba(200,16,46,.94);color:#fff}';
    (document.head || document.documentElement).appendChild(s);
  }
  /* カード/帯にカウントダウン要素を用意して締切(soldOutAt)をセット。null で撤去。 */
  function setCountdownEl(host, deadlineAt) {
    if (!host) return;
    var el = host.querySelector(':scope > .limited-countdown-eda');
    if (!deadlineAt) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('span');
      el.className = 'limited-countdown-eda';
      /* 「残り◯セット」がある帯では、その直後に置いて同じ行に並べる。
         末尾(=「なくなり次第終了」の後ろ)だと折り返して別行に落ちるため。 */
      var left = host.querySelector(':scope > .limited-left');
      if (left && left.parentNode === host) left.insertAdjacentElement('afterend', el);
      else host.appendChild(el);
    }
    el.setAttribute('data-eda-deadline', String(deadlineAt.getTime()));
  }

  /* 「残り◯セット」/「◯/◯発売」/「完売しました」/「ただいま他のお客様が確保中」
     bare=true は PDPの帯用。見出し「残りセット数：」が別に付くので
     「残り」を重ねず数量だけ返す（残りセット数：残り20セット を防ぐ）。 */
  function labelFor(info, bare) {
    if (info.upcoming) return fmtDateShort(info.startAt) + '発売';  /* 発売前＝予告 */
    if (info.closed) return '完売しました';       /* 販売停止＝在庫が残っていても完売表示 */
    if (info.available > 0) return (bare ? '' : '残り') + info.available + info.unit;
    /* 在庫はあるが全部が確保中 → 30分で解放されるので「完売」とは書かない */
    return info.stock > 0 ? 'ただいま他のお客様が確保中' : '完売しました';
  }

  function applyState(el, info, bare) {
    el.textContent = labelFor(info, bare);
    el.classList.toggle('is-upcoming', !!info.upcoming);
    el.classList.toggle('is-soldout', !info.upcoming && info.available <= 0);
    el.classList.toggle('is-low', !info.upcoming && info.available > 0 && info.available <= LOW_AT);
  }

  /* ① 期間外のブロックを丸ごと隠す（販促バナーを囲っておけば終了後に自動で消える）

     隠し方は style.display ではなく属性＋!important。
     カテゴリタブ・サブタブ・検索・GASマスター反映（refreshProductCards）が
     あちこちで style.display='' を書き戻すので、インラインで隠すと
     ユーザーがタブを押した瞬間に終了したはずのカードが戻ってしまう。
     期間中は属性を外すだけ＝通常の絞り込みに一切干渉しない。 */
  var ENDED_ATTR = 'data-limited-ended';

  function ensureEndedCss() {
    if (document.getElementById('limited-ended-css')) return;
    var s = document.createElement('style');
    s.id = 'limited-ended-css';
    /* 属性を3回重ねて詳細度を上げている。ページ側に
       `.product-grid, .product-grid.cols-4 { display:flex !important }` のような
       !important 付きクラス指定があり、属性1つ(0,1,0)では負けるため。
       読み込み順に依存しない形で確実に勝たせる。 */
    var sel = '[' + ENDED_ATTR + ']';
    s.textContent = sel + sel + sel + '{display:none!important}';
    (document.head || document.documentElement).appendChild(s);
  }

  function applyScopes(active) {
    ensureEndedCss();
    document.querySelectorAll('[data-limited-scope]').forEach(function (el) {
      if (active[el.getAttribute('data-limited-scope')]) el.removeAttribute(ENDED_ATTR);
      else el.setAttribute(ENDED_ATTR, '');
    });
  }

  /* ② 手書きコピーの中の残数プレースホルダ */
  function applyInline(active) {
    document.querySelectorAll('[data-limited-left]').forEach(function (el) {
      var info = active[el.getAttribute('data-limited-left')];
      if (info) applyState(el, info);
    });
  }

  /* ③ 商品カードにリボンを自動で挿す（キャンペーンごとのHTML追加を不要にする） */
  function applyCards(active) {
    document.querySelectorAll('.product-card').forEach(function (card) {
      var nameEl = card.querySelector('.product-name');
      if (!nameEl) return;
      var info = active[nameEl.textContent.trim()];
      var ribbon = card.querySelector('.limited-left-ribbon');

      if (!info) { if (ribbon) ribbon.remove(); return; }

      if (!ribbon) {
        var host = card.querySelector('.product-card-img') || card;
        host.style.position = host.style.position || 'relative';
        ribbon = document.createElement('span');
        ribbon.className = 'limited-left-ribbon';
        host.appendChild(ribbon);
      }
      applyState(ribbon, info);

      /* 動く残り時間をカード画像に（販売中のみ／発売前・完売時は出さない） */
      var cardImg = card.querySelector('.product-card-img') || card;
      cardImg.style.position = cardImg.style.position || 'relative';
      setCountdownEl(cardImg, (!info.closed && !info.upcoming) ? info.soldOutAt : null);

      /* 発売前(予告)＝カードは見せるが購入は不可。product-buy を CSS で隠し、
         代わりに「◯/◯（曜）発売予定」ラベルを ::after で出す（data 属性で文言を渡す）。
         購入ボタンは他JSが後から生成しうるので、クラス＋CSSで確実に上書きする。 */
      var buy = card.querySelector('.product-buy');
      if (info.upcoming) {
        card.classList.add('limited-upcoming');
        if (buy) buy.setAttribute('data-upcoming-label', fmtDateShort(info.startAt) + '発売予定');
      } else {
        card.classList.remove('limited-upcoming');
        if (buy) buy.removeAttribute('data-upcoming-label');
      }

      /* 販売停止中の見え方を整える。ボタン無効化そのものは stock=0 で自動的に効いている。
         ・既存の「在庫切れ」オーバーレイは外す（左上の「肉の日限定」リボンを覆い隠すうえ、
           右上のリボンと「完売しました」が2つ並んで重複するため）
         ・ボタンの文言だけ「完売しました」に揃える */
      if (info.closed) {
        card.querySelectorAll('.stock-badge-overlay').forEach(function (b) { b.remove(); });
        var btn = card.querySelector('.btn-add-cart');
        if (btn && btn.disabled) btn.textContent = '完売しました';
      }
    });
  }

  /* ④' 締切後の商品詳細ページ＝購入導線ごと閉じる。
     一覧やバナーから消えても product.html?id=… の直リンク（LINE配信・SNS・履歴）は生きているので、
     ここを塞がないと翌日以降も「限定」品が普通に買えてしまう。 */
  var PDP_HIDE = ['#variantSection', '.pdp-qty-section', '.pdp-cta-section',
                  '#pdpStockNote', '#pdpSubscriptionUpsell', '#pdpGiftOption', '#stickyCta'];

  function closePdpSales(state) {
    if (document.getElementById('limitedEndedNote')) return;   /* 二重実行しない */

    PDP_HIDE.forEach(function (sel) {
      var el = document.querySelector(sel);
      /* インライン display:none なので、あとから .show を付けられても出てこない */
      if (el) el.style.display = 'none';
    });

    var anchor = document.querySelector('.pdp-cta-section');
    if (!anchor || !anchor.parentNode) return;
    var note = document.createElement('div');
    note.id = 'limitedEndedNote';
    note.style.cssText = 'margin:18px 0 4px;padding:16px 18px;border-radius:12px;'
      + 'background:#F3F1EC;border:1px solid rgba(15,61,46,.14);'
      + 'font-size:13.5px;line-height:1.9;letter-spacing:.02em;color:#3E4A44;';
    /* 発売前は「発売予定」、販売停止直後は「完売」、表示終了後は「販売終了」 */
    var head, body;
    if (state.upcoming) {
      head = state.startLabel
        ? (state.startLabel + ' 発売予定です')
        : 'まもなく発売予定です';
      body = '数量限定でのご案内です。発売までもうしばらくお待ちください。';
    } else if (state.hidden) {
      head = 'この商品の販売は終了しました';
      body = '期間限定のご案内でした。ありがとうございました。';
    } else {
      head = '完売しました';
      body = 'ご好評につき完売しました。たくさんのご注文をありがとうございました。';
    }
    note.innerHTML = '<b style="display:block;font-weight:800;color:#0F3D2E;margin-bottom:4px">'
      + head + '</b>' + body
      + '<a href="shop.html" style="display:inline-block;margin-top:10px;font-weight:700;color:#0F3D2E;'
      + 'text-decoration:underline;text-underline-offset:3px">ほかの商品を見る →</a>';
    anchor.parentNode.insertBefore(note, anchor);
  }

  /* ④ 商品詳細ページの帯（P027 のようなベタ書きを不要にする） */
  function applyPdp(active, ended, upcoming) {
    var cur = window.__pdpProduct;
    /* 渡すのは商品そのものではなく endedLimited() の判定（hidden を見るため）。
       商品を渡すと state.hidden が常に undefined＝表示終了後も「完売しました」のままになる */
    if (cur && cur.name && upcoming && upcoming[cur.name]) {
      var up = upcoming[cur.name];
      closePdpSales({ upcoming: true, startLabel: fmtDateTime(up.startAt) });
    } else if (cur && cur.name && ended[cur.name]) {
      closePdpSales(ended[cur.name]);
    }

    var host = document.getElementById('limitedBanner');
    if (!host) return;
    var info = cur && cur.name ? active[cur.name] : null;
    if (!info) { host.style.display = 'none'; return; }

    /* 帯に出す締切は「買える最後の時刻」＝ soldOutAt。limitedUntil は表示を消す時刻なので、
       完売後も告知を残すキャンペーンではこれを出すと購入期限を誤って伝えてしまう。
       販売停止後は締切も「なくなり次第終了」も出さない（もう買えないので誤解を招く）。 */
    /* 発売前(予告)は締切も「なくなり次第終了」も出さない（まだ買えないので誤解を招く）。 */
    var deadlineAt = (info.closed || info.upcoming) ? null : info.soldOutAt;
    var deadline = deadlineAt
      ? (deadlineAt.getMonth() + 1) + '/' + deadlineAt.getDate()
        + '（' + '日月火水木金土'.charAt(deadlineAt.getDay()) + '）'
        + deadlineAt.getHours() + ':' + ('0' + deadlineAt.getMinutes()).slice(-2)
        + 'まで'
      : '';
    /* 帯は3行構成（2026-08-06 たろ指定）:
         1行目: [20セット限定] 8/7（金）23:59まで
         2行目: 残りセット数：20セット
         3行目: 残り時間：1日と05:35:59
       1行に詰めると折り返して読みにくかったため、見出し付きで縦に並べる。 */
    host.style.display = 'flex';
    host.innerHTML = '<span class="limited-banner-text">'
      + '<span class="lb-row lb-row-head">'
      + '<span class="limited-banner-badge">' + info.total + info.unit + '限定</span>'
      + (deadline ? '<span class="lb-deadline">' + deadline + '</span>' : '')
      + '</span>'
      + '<span class="lb-row"><span class="lb-label">残りセット数：</span>'
      + '<b class="limited-left" data-limited-left="' + info.product.name.replace(/"/g, '&quot;') + '"></b></span>'
      + (deadlineAt ? '<span class="lb-row lb-row-time"><span class="lb-label">残り時間：</span></span>' : '')
      + '</span>';
    applyState(host.querySelector('.limited-left'), info, true);   /* bare＝「残り」を重ねない */
    setCountdownEl(host.querySelector('.lb-row-time'), deadlineAt);   /* 動く残り時間 */
  }

  function apply() {
    if (!products().length) return false;
    /* 販売停止をまたいだ瞬間（タブを開きっぱなしの人）に在庫切れUIへ切り替える。
       stock を落としただけでは既存の描画は走らないので、一度だけ呼び直す。 */
    if (closeSales() && !redecorating) {
      redecorating = true;
      try { if (typeof window.refreshStockBadges === 'function') window.refreshStockBadges(); }
      finally { redecorating = false; }
    }
    var active = activeLimited();
    applyScopes(active);
    applyInline(active);
    applyCards(active);
    applyPdp(active, endedLimited(), upcomingLimited());
    ensureCountdownTicker();   /* 動く残り時間の毎秒更新を開始（初回のみ） */
    tickCountdowns();          /* 1秒待たずに即描画 */
    return true;
  }

  /* マスター読み込み前に走ることがあるので、取れるまで少しリトライ */
  function boot(tries) {
    if (apply()) return;
    if (tries > 0) setTimeout(function () { boot(tries - 1); }, 200);
  }

  /* products-loader.js（GASライブ在庫）と cart-holds.js（確保数）の更新に相乗り。
     refreshProductCards も必ず包むこと: あちらは published=TRUE のカードに
     style.display='' を書き戻すので、包まないと締切後のカードが最大60秒（次の
     setInterval まで）復活してしまう。products-loader は
     refreshStockBadges → refreshProductCards の順に呼ぶので、後勝ちで消す。 */
  var redecorating = false;

  function hookAround(name) {
    var prev = window[name];
    window[name] = function () {
      /* 先に stock を 0 にしてから既存処理へ渡す。
         GAS が返す生の在庫（販売停止後も残っている）で一瞬「カートに追加」が
         出てしまうのを防ぐ。 */
      closeSales();
      if (typeof prev === 'function') { try { prev.apply(this, arguments); } catch (e) {} }
      apply();
    };
  }
  hookAround('refreshStockBadges');
  hookAround('refreshProductCards');

  /* 初回描画より先に在庫を落としておく。DOMContentLoaded の在庫バッジ処理は
     こちらの boot より先に登録されているので、ここで止めないと販売停止後も
     一瞬「カートに追加」が出る。 */
  closeSales();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(15); });
  } else {
    boot(15);
  }

  window.refreshLimitedStock = apply;
  /* 締切をまたいでもタブを開きっぱなしなら消えるように、1分ごとに見直す */
  setInterval(apply, 60 * 1000);
})();
