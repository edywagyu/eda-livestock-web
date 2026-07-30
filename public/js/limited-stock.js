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

  /* 「残り◯セット」/「完売しました」/「ただいま他のお客様が確保中」 */
  function labelFor(info) {
    if (info.closed) return '完売しました';       /* 販売停止＝在庫が残っていても完売表示 */
    if (info.available > 0) return '残り' + info.available + info.unit;
    /* 在庫はあるが全部が確保中 → 30分で解放されるので「完売」とは書かない */
    return info.stock > 0 ? 'ただいま他のお客様が確保中' : '完売しました';
  }

  function applyState(el, info) {
    el.textContent = labelFor(info);
    el.classList.toggle('is-soldout', info.available <= 0);
    el.classList.toggle('is-low', info.available > 0 && info.available <= LOW_AT);
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
    /* 販売停止直後は「完売」、表示終了後（＝一覧からも消えたあと）は「販売終了」 */
    var head = state.hidden ? 'この商品の販売は終了しました' : '完売しました';
    var body = state.hidden
      ? '期間限定のご案内でした。ありがとうございました。'
      : 'ご好評につき完売しました。たくさんのご注文をありがとうございました。';
    note.innerHTML = '<b style="display:block;font-weight:800;color:#0F3D2E;margin-bottom:4px">'
      + head + '</b>' + body
      + '<a href="shop.html" style="display:inline-block;margin-top:10px;font-weight:700;color:#0F3D2E;'
      + 'text-decoration:underline;text-underline-offset:3px">ほかの商品を見る →</a>';
    anchor.parentNode.insertBefore(note, anchor);
  }

  /* ④ 商品詳細ページの帯（P027 のようなベタ書きを不要にする） */
  function applyPdp(active, ended) {
    var cur = window.__pdpProduct;
    /* 渡すのは商品そのものではなく endedLimited() の判定（hidden を見るため）。
       商品を渡すと state.hidden が常に undefined＝表示終了後も「完売しました」のままになる */
    if (cur && cur.name && ended[cur.name]) closePdpSales(ended[cur.name]);

    var host = document.getElementById('limitedBanner');
    if (!host) return;
    var info = cur && cur.name ? active[cur.name] : null;
    if (!info) { host.style.display = 'none'; return; }

    /* 帯に出す締切は「買える最後の時刻」＝ soldOutAt。limitedUntil は表示を消す時刻なので、
       完売後も告知を残すキャンペーンではこれを出すと購入期限を誤って伝えてしまう。
       販売停止後は締切も「なくなり次第終了」も出さない（もう買えないので誤解を招く）。 */
    var deadlineAt = info.closed ? null : info.soldOutAt;
    var deadline = deadlineAt
      ? (deadlineAt.getMonth() + 1) + '/' + deadlineAt.getDate()
        + '（' + '日月火水木金土'.charAt(deadlineAt.getDay()) + '）'
        + deadlineAt.getHours() + ':' + ('0' + deadlineAt.getMinutes()).slice(-2)
        + 'まで ／ '
      : '';
    host.style.display = 'flex';
    host.innerHTML = '<span class="limited-banner-badge">' + info.total + info.unit + '限定</span>'
      + '<span class="limited-banner-text">' + deadline
      + '<b class="limited-left" data-limited-left="' + info.product.name.replace(/"/g, '&quot;') + '"></b>'
      + (info.closed ? '' : ' なくなり次第終了') + '</span>';
    applyState(host.querySelector('.limited-left'), info);
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
    applyPdp(active, endedLimited());
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
