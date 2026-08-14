/* ============================================================
   eda-i18n.js — 英語表示の切り替え（2026-08-12）
   ------------------------------------------------------------
   方針:
   - ページを増やさない。同じ HTML に英訳を data-en として持たせ、
     その場で差し替える（別 URL の英語版ページを作らない＝更新漏れを防ぐ）。
   - 対象は「テキストだけを持つ要素」に限る。子要素ごと innerHTML を
     入れ替えるとイベントや画像が壊れるため、付与時に必ずリーフを選ぶ。
   - 状態は localStorage('eda-lang') と ?lang=en で保持。共有もできる。
   ============================================================ */
(function () {
  var KEY = 'eda-lang';
  var ATTR_MAP = [
    ['data-en-placeholder', 'placeholder'],
    ['data-en-aria', 'aria-label'],
    ['data-en-title', 'title'],
    ['data-en-alt', 'alt']
  ];

  function currentLang() {
    var q = null;
    try { q = new URLSearchParams(location.search).get('lang'); } catch (e) {}
    if (q === 'en' || q === 'ja') {
      try { localStorage.setItem(KEY, q); } catch (e) {}
      return q;
    }
    try { return localStorage.getItem(KEY) || 'ja'; } catch (e) { return 'ja'; }
  }

  function apply(lang) {
    var en = lang === 'en';
    document.documentElement.setAttribute('lang', en ? 'en' : 'ja');
    document.body && document.body.classList.toggle('lang-en', en);

    var nodes = document.querySelectorAll('[data-en]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      /* 初回に日本語を退避しておく（HTML を書き換えても戻せるように） */
      if (!el.hasAttribute('data-ja')) {
        el.setAttribute('data-ja', el.innerHTML.trim());
      }
      var next = en ? el.getAttribute('data-en') : el.getAttribute('data-ja');
      if (next != null && el.innerHTML.trim() !== next) el.innerHTML = next;
    }

    /* 属性（placeholder / aria-label / title / alt） */
    for (var m = 0; m < ATTR_MAP.length; m++) {
      var dataAttr = ATTR_MAP[m][0], realAttr = ATTR_MAP[m][1];
      var els = document.querySelectorAll('[' + dataAttr + ']');
      for (var j = 0; j < els.length; j++) {
        var e2 = els[j];
        var keep = 'data-ja-' + realAttr;
        if (!e2.hasAttribute(keep)) e2.setAttribute(keep, e2.getAttribute(realAttr) || '');
        e2.setAttribute(realAttr, en ? e2.getAttribute(dataAttr) : e2.getAttribute(keep));
      }
    }

    /* 言語スイッチャーの現在地表示 */
    var btn = document.querySelector('.lang-switch-btn');
    if (btn) btn.setAttribute('aria-label', en ? 'Language / 言語' : '言語 / Language');
  }

  /* ---- JS があとから描画する文言（カート・在庫・配送予定）----
     これらは HTML に無いので data-en を付けられない。EN のときだけ
     テキストを置き換える。日本語へ戻すときは再描画に任せる。 */
  var DYN = [
    [/^カートに追加$/, 'Add to cart'],
    [/^カートに追加\s*(¥[\d,]+)$/, 'Add to cart $1'],
    [/^追加しました\s*✓$/, 'Added ✓'],
    [/^(\d+)点$/, '$1 item(s)'],
    [/^あと(¥[\d,]+)で送料無料$/, '$1 more for free shipping'],
    [/^送料無料でお届けします！$/, 'Shipping is on us.'],
    [/^売り切れ$/, 'Sold out'],
    [/^在庫あり$/, 'In stock'],
    [/^残り(\d+)点$/, 'Only $1 left'],
    [/^カートを見る$/, 'View cart'],
    [/^最短\s*(\d+)月(\d+)日（.）\s*にお届け$/, 'Earliest delivery: $1/$2'],
    [/^最短\s*(\d+)月(\d+)日（.）$/, '$1/$2 (earliest)'],
    /* モバイルメニューは mobile-menu.js が組み立てるので data-en を置けない */
    [/^ショップ$/, 'Shop'],
    [/^オーガニック$/, 'Organic'],
    [/^会社案内$/, 'About'],
    [/^海外展開$/, 'Global'],
    [/^お取扱店$/, 'Stockists'],
    [/^記事$/, 'Journal'],
    [/^お問い合わせ$/, 'Contact'],
    [/^マイページ$/, 'My Page'],
    [/^定期便を申込$/, 'Start a subscription'],
    [/^商談予約 \/ Book$/, 'Book a meeting'],
    [/^LINE で相談$/, 'Ask us on LINE'],
    [/^電話$/, 'Call us'],
    [/^メール$/, 'Email'],
    [/^赤身ステーキ$/, 'Lean steak'],
    [/^(\d+)つ$/, '$1 pack'],
    /* 配送日時の <option>（value は触らないので選択結果は変わらない） */
    [/^指定なし（最短）$/, 'No preference (earliest)'],
    [/^指定なし$/, 'No preference'],
    [/^午前中（〜12:00）$/, 'Morning (until 12:00)'],
    [/^(\d{2}):(\d{2}) - (\d{2}):(\d{2})（推奨）$/, '$1:$2 - $3:$4 (recommended)'],
    [/^(\d+)月(\d+)日（(.)）\s*〔最短〕$/, function (m, mo, d, w) {
      return d + ' ' + (MON[+mo - 1] || mo) + ' (' + (WD[w] || w) + ') — earliest';
    }],
    [/^(\d+)月(\d+)日（(.)）$/, function (m, mo, d, w) {
      return d + ' ' + (MON[+mo - 1] || mo) + ' (' + (WD[w] || w) + ')';
    }],
    [/^最短\s*(.+?)\s*にお届け$/, 'Earliest delivery: $1'],
    /* 「最短 <strong>日付</strong> にお届け」のようにタグで分断される場合 */
    [/^最短\s*$/, 'Earliest delivery '],
    [/^\s*にお届け$/, ''],
    [/^指定なしの場合、最短日でお届けします$/, 'With no preference, we ship on the earliest date.']
  ];
  var DYN_SCOPE = '.cart-drawer, .sticky-cart-bar, .btn-add-cart, .product-card, .delivery-estimate, .pdp-cta, .cart-shipping-note, .eda-mm-drawer';

  /* 子タグをまたぐ動的文言は innerHTML 単位で置換する */
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var WD = { '日':'Sun', '月':'Mon', '火':'Tue', '水':'Wed', '木':'Thu', '金':'Fri', '土':'Sat' };
  var DYN_HTML = [
    [/^あと\s*<strong>(¥[\d,]+)<\/strong>\s*で送料無料$/,
      function (m, yen) { return '<strong>' + yen + '</strong> more for free shipping'; }],
    [/^(\d+)月(\d+)日（(.)）$/,
      function (m, mo, d, w) { return d + ' ' + (MON[+mo - 1] || mo) + ' (' + (WD[w] || w) + ')'; }],
    [/^最短\s*<strong>(\d+)月(\d+)日（(.)）<\/strong>\s*にお届け$/,
      function (m, mo, d, w) {
        return 'Earliest delivery <strong>' + d + ' ' + (MON[+mo - 1] || mo) + ' (' + (WD[w] || w) + ')</strong>';
      }]
  ];

  function translateHtmlUnits(scope) {
    var els = scope.querySelectorAll ? scope.querySelectorAll('*') : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.children.length > 2) continue;
      var h = el.innerHTML.trim();
      if (!h || h.length > 160) continue;
      for (var k = 0; k < DYN_HTML.length; k++) {
        if (DYN_HTML[k][0].test(h)) {
          el.innerHTML = h.replace(DYN_HTML[k][0], DYN_HTML[k][1]);
          break;
        }
      }
    }
  }

  function translateDynamic(root) {
    if (currentLang() !== 'en') return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll ? scope.querySelectorAll(DYN_SCOPE) : [];
    var list = [];
    if (scope.matches && scope.matches(DYN_SCOPE)) list.push(scope);
    for (var i = 0; i < nodes.length; i++) list.push(nodes[i]);
    for (var k = 0; k < list.length; k++) {
      translateHtmlUnits(list[k]);
      var walker = document.createTreeWalker(list[k], NodeFilter.SHOW_TEXT, null);
      var tn;
      while ((tn = walker.nextNode())) {
        var t = tn.textContent.trim();
        if (!t) continue;
        for (var d = 0; d < DYN.length; d++) {
          if (DYN[d][0].test(t)) {
            tn.textContent = tn.textContent.replace(t, t.replace(DYN[d][0], DYN[d][1]));
            break;
          }
        }
      }
    }
  }

  function observe() {
    if (!window.MutationObserver) return;
    var busy = false;
    var mo = new MutationObserver(function () {
      /* 追加ノード単位だと <option> のように DYN_SCOPE 外の要素を取りこぼす。
         走査は安いので、まとめて 1 フレーム後に全体へ当て直す。
         busy で自分の書き換えによる再発火を止める（無限ループ防止）。 */
      if (busy || currentLang() !== 'en') return;
      busy = true;
      requestAnimationFrame(function () {
        apply('en');
        translateDynamic(document);
        busy = false;
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function setLang(lang) {
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    apply(lang);
    translateDynamic(document);
  }

  /* 言語メニューのクリックを引き取る（各ページの旧ハンドラより先に処理する） */
  function bind() {
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a[data-lang]');
      if (!a) return;
      var lang = a.getAttribute('data-lang');
      if (lang !== 'en' && lang !== 'ja') return;
      ev.preventDefault();
      ev.stopPropagation();
      var dd = a.closest('.lang-dropdown');
      if (dd) dd.hidden = true;
      setLang(lang);
    }, true);
  }

  function init() {
    apply(currentLang());
    translateDynamic(document);
    bind();
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.EdaI18n = { set: setLang, get: currentLang };
})();
