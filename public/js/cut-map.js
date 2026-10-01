/* 江田畜産 — 商品詳細ページ「どの部位ですか？」の牛の部位図（2026-10-01）
   使い方: EDA_CUT_MAP.render(container, productId, cutText)
   ・部位は productId → キーの明示マップで決める（文字列推測に頼らない）
   ・鶏・内臓・複数商品セットは図を出さない（牛の図が嘘になるため）
   ・図はただの模式図。枝肉の実寸比ではない */
window.EDA_CUT_MAP = (function () {
  'use strict';

  /* 区画の定義: キー → [x, y, w, h, 表示名]  (viewBox 0 0 640 360) */
  var REGIONS = {
    neck:      [150, 110,  60, 65, 'ネック'],
    katarosu:  [210, 110,  75, 65, '肩ロース'],
    ribloin:   [285, 110,  70, 65, 'リブロース'],
    sirloin:   [355, 110,  70, 65, 'サーロイン'],
    ranpu:     [425, 110,  62, 55, 'ランプ'],
    ichibo:    [487, 110,  68, 58, 'イチボ'],
    ude:       [150, 175, 135, 83, 'ウデ'],
    bara_kata: [285, 175,  70, 83, 'カタバラ'],
    hire:      [355, 175,  70, 30, 'ヒレ'],
    bara_tomo: [355, 205,  70, 53, 'トモバラ'],
    shintama:  [425, 165,  62, 40, 'シンタマ'],
    uchimomo:  [425, 205,  62, 53, 'ウチモモ'],
    sotomomo:  [487, 168,  68, 90, 'ソトモモ']
  };
  /* スネは前後2本あるので別扱い */
  var SUNE = [[196, 258, 46, 68], [496, 258, 46, 68]];

  /* 商品 → 部位キー。null＝図を出さない商品 */
  var MAP = {
    P001: ['ribloin', 'sirloin'],              /* サーロインステーキ（ロース芯） */
    P002: ['uchimomo', 'ranpu'],               /* 赤身ステーキ */
    P003: ['uchimomo', 'ranpu'],               /* サイコロステーキ */
    P004: ['sotomomo'],                        /* 赤身スライス */
    P005: ['ude', 'katarosu', 'sotomomo'],     /* 切り落とし */
    P006: ['bara_tomo'],                       /* バラ焼肉 */
    P007: null,                                /* ホルモン（小腸）＝内臓 */
    P008: ['sune', 'neck'],                    /* ハンバーグ */
    P009: ['uchimomo', 'sotomomo', 'shintama'],/* ローストビーフ（モモ） */
    P010: ['uchimomo', 'sotomomo', 'shintama'],/* 生ハム（モモ） */
    P010B: ['bara_kata', 'bara_tomo', 'ranpu'],/* ミンチ */
    P017: ['hire'],                            /* ギフト【松】 */
    P018: ['uchimomo', 'ranpu'],               /* ギフト【竹】 */
    P019: ['sune', 'neck'],                    /* ギフト【梅】 */
    P020: ['ribloin', 'sirloin'],              /* 有機JAS サーロイン */
    P021: ['ribloin'],                         /* 有機JAS リブアイ */
    P022: ['hire'],                            /* 有機JAS ヒレ */
    P023: ['ude'],                             /* ミスジステーキ（肩甲骨の内側） */
    P024: ['hire'],                            /* ヒレステーキ */
    P025: ['ude'],                             /* 赤身焼肉 */
    P026: ['katarosu'],                        /* 霜降スライス */
    P027: ['ude', 'bara_tomo'],                /* 肉の日限定セット */
    P028: ['ichibo'],                          /* イチボステーキ */
    P030: ['ude', 'bara_tomo'],                /* 訳あり焼肉2種セット */
    P031: ['katarosu', 'ude', 'sotomomo'],     /* 訳ありスライス2種セット */
    P032: ['hire'],                            /* ヒレサイコロステーキ */
    P033: ['ude', 'bara_tomo'],                /* 会員限定 焼肉2種セット */
    P034: ['katarosu'],                        /* 会員限定 霜降スライス */
    P035: ['shintama'],                        /* カメノコ焼肉 */
    P036: ['shintama'],                        /* シンシン焼肉 */
    P037: ['shintama'],                        /* カメノコ・シンシン焼肉セット */
    P039: ['uchimomo', 'ranpu', 'ude'],        /* 食べ比べA */
    P040: ['uchimomo', 'ranpu', 'ude'],        /* 食べ比べB */
    P041: ['ude', 'katarosu', 'sotomomo'],     /* 訳あり切り落とし */
    P042: ['bara_kata', 'bara_tomo', 'ranpu'], /* 限定ミンチ */
    P043: null,                                /* 不揃い品セット＝5種混在 */
    P049: ['ribloin', 'sirloin'],              /* 刃コラボ（サーロイン） */
    P050: ['uchimomo', 'ranpu']                /* 刃コラボ（赤身） */
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function block(key, on) {
    var r = REGIONS[key];
    if (!r) return '';
    var cls = on ? ' is-on' : '';
    var fs = r[2] < 65 ? 10 : 11;
    return '<g class="cutmap-block' + cls + '">' +
      '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="3"/>' +
      '<text x="' + (r[0] + r[2] / 2) + '" y="' + (r[1] + r[3] / 2 + 4) + '" font-size="' + fs + '">' +
      esc(r[4]) + '</text></g>';
  }

  function suneBlocks(on) {
    var cls = on ? ' is-on' : '';
    return SUNE.map(function (s) {
      return '<g class="cutmap-block' + cls + '">' +
        '<rect x="' + s[0] + '" y="' + s[1] + '" width="' + s[2] + '" height="' + s[3] + '" rx="3"/>' +
        '<text x="' + (s[0] + s[2] / 2) + '" y="' + (s[1] + s[3] / 2 + 4) + '" font-size="11">スネ</text>' +
        '</g>';
    }).join('');
  }

  function buildSvg(keys) {
    var on = {};
    keys.forEach(function (k) { on[k] = true; });
    var body = Object.keys(REGIONS).map(function (k) { return block(k, !!on[k]); }).join('');
    return '' +
      '<svg class="cutmap-svg" viewBox="0 0 640 360" role="img" ' +
      'aria-label="牛の部位図。' + esc(keys.map(function (k) {
        return k === 'sune' ? 'スネ' : (REGIONS[k] ? REGIONS[k][4] : k);
      }).join('、')) + 'の位置">' +
      /* 頭・耳・しっぽ・輪郭 */
      '<g class="cutmap-outline">' +
      '<path d="M152 112 L104 120 Q68 128 58 156 Q50 184 84 192 L152 186 Z"/>' +       /* 頭 */
      '<path d="M112 116 Q100 92 122 90 Q134 102 132 118 Z"/>' +                        /* 耳 */
      '<path d="M66 176 Q58 186 70 190 Q80 192 84 184"/>' +                             /* 鼻づら */
      '<path d="M555 112 Q582 124 578 162 Q575 196 562 210"/>' +                        /* しっぽ */
      '<path d="M150 110 L555 110 L555 258 L150 258 Z"/>' +                             /* 胴の輪郭 */
      '<path d="M190 326 L248 326 M490 326 L548 326"/>' +                               /* 蹄 */
      '</g>' +
      '<g class="cutmap-eye"><circle cx="100" cy="146" r="4"/></g>' +
      body + suneBlocks(!!on.sune) +
      '</svg>';
  }

  var CSS = '' +
    '.cutmap{margin:18px 0 4px}' +
    '.cutmap-svg{width:100%;max-width:520px;height:auto;display:block}' +
    '.cutmap-block rect{fill:#EDE6D8;stroke:#FAF7F0;stroke-width:2}' +
    '.cutmap-block text{fill:#8C8372;text-anchor:middle;font-family:inherit;letter-spacing:.02em}' +
    '.cutmap-block.is-on rect{fill:#0F3D2E;stroke:#FAF7F0}' +
    '.cutmap-block.is-on text{fill:#fff}' +
    '.cutmap-outline path{fill:none;stroke:#C9BFA7;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.cutmap-eye circle{fill:#C9BFA7}' +
    '.cutmap-note{margin:6px 0 0;font-size:12px;color:#8C8372;line-height:1.7}';

  function injectCss() {
    if (document.getElementById('cutmap-css')) return;
    var st = document.createElement('style');
    st.id = 'cutmap-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* container の中に図を描く。対象外の商品なら何もしない（false を返す） */
  function render(container, productId, cutText) {
    if (!container) return false;
    var keys = MAP[productId];
    if (!keys || !keys.length) return false;
    injectCss();
    var names = keys.map(function (k) {
      return k === 'sune' ? 'スネ' : (REGIONS[k] ? REGIONS[k][4] : k);
    });
    var wrap = document.createElement('div');
    wrap.className = 'cutmap';
    wrap.innerHTML = buildSvg(keys) +
      '<p class="cutmap-note">色のついたところが、この商品の部位です' +
      (cutText ? '（' + esc(names.join('・')) + '）' : '') +
      '。図は位置を示すためのもので、実際の大きさの比率とは異なります。</p>';
    container.appendChild(wrap);
    return true;
  }

  return { render: render, regions: REGIONS, map: MAP };
})();
