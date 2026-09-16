/* ============================================================
   VIP内・割引客セグメントの自動判定  2026-09-05
   「値引き＋セット」の金額比率が45%以上の人を自動で拾い出す。

   ・Shopify（旧サイト）は自動取得できないので、SNS運用管理シートの
     「Shopify購入_スナップショット」タブに置いた実測値を読む（月1回 手で更新）。
   ・新EC（このDB）は orders の items_json × products の price で毎日自動計算。
   ・結果は SNS運用管理シートの「VIP_割引客判定」タブに毎日書き直す（手で書いても翌日消える）。
   関連: 顧客セグメントタブ(gid=622720756) A73以降に基準と経緯を記載。
   ============================================================ */
var VIPSEG_SNS_ID    = '1KKCIYgWr2rvESSXTcsuqlAFDs0WlRX0j9A79l2iZut4';
var VIPSEG_SNAP_TAB  = 'Shopify購入_スナップショット';
var VIPSEG_OUT_TAB   = 'VIP_割引客判定';
var VIPSEG_THRESHOLD = 0.45;   // ここを変えれば判定ラインが変わる
var VIPSEG_TZ        = 'Asia/Tokyo';

/* 「値引き」＝訳あり・不揃い・数量限定・限定・◯%オフ・まとめ買い。
   ギフト（松/竹/梅）は定価商品なので除外する。 */
function vipsegIsDiscountOnly_(title){
  var t = String(title || '');
  if (/【松】|【竹】|【梅】|ギフト/.test(t)) return false;
  return /訳あり|不揃い|数量限定|限定|オフ|まとめ買い|％オフ/.test(t);
}
/* 「値引き＋セット」＝上に「◯◯セット」を足したもの（判定に使うのはこちら）。 */
function vipsegIsDiscountWithSet_(title){
  var t = String(title || '');
  if (/【松】|【竹】|【梅】|ギフト/.test(t)) return false;
  return vipsegIsDiscountOnly_(t) || /セット/.test(t);
}
function vipsegKey_(name){
  return String(name || '').replace(/[\s　]/g, '').trim();
}

/* 初回だけ：スナップショットタブを作り、2026-09-05 に手で取った実測値を流し込む。
   以後はこのタブが正。人を足す/月次で取り直すときはこのタブに貼るだけでよい。 */
function vipsegSeedRows_(){
  return [
['清田伊津子','有機たまご｜10個',11800],['清田伊津子','（商品名なし・削除済み商品）',10115],['清田伊津子','豪華訳ありセット',7890],['清田伊津子','【訳あり】特盛和牛ミンチ',6800],['清田伊津子','モツ鍋セット',5980],['清田伊津子','和牛ミンチ',5500],['清田伊津子','【梅】有機たまご & 無農薬米ｾｯﾄ',4800],['清田伊津子','【訳あり】切り落とし/800g',4680],['清田伊津子','【訳あり】バラ焼肉',4590],['清田伊津子','赤身焼肉',4560],['清田伊津子','霜降スライス',3700],['清田伊津子','【訳あり商品】赤身切り落とし',3600],['清田伊津子','平飼い鶏セット',3000],['清田伊津子','赤身スライス',2600],['清田伊津子','和牛生ハム',1250],
['向野美歌','ヒレステーキ',23275],['向野美歌','赤身スライス',19600],['向野美歌','和牛ハラミ',14400],['向野美歌','ミスジステーキ',13250],['向野美歌','バラ焼肉',11630],['向野美歌','江田和牛ハンバーグ',8560],['向野美歌','赤身焼肉',8500],['向野美歌','霜降スライス',6700],['向野美歌','平飼い鶏ムネ',5960],['向野美歌','有機たまご｜10個',4800],['向野美歌','【訳あり品】カルビ焼肉',4000],['向野美歌','赤身ステーキ',3600],['向野美歌','平飼い鶏モモ',3360],['向野美歌','平飼い鶏肉セット',2250],['向野美歌','（商品名なし・削除済み商品）',2125],
['中川幸子','赤身ステーキ',39500],['中川幸子','ヒレステーキ',27550],['中川幸子','【訳あり商品】ヒレステーキ',12950],['中川幸子','和牛ミンチ',7720],['中川幸子','赤身ステーキ【10％オフ】',7000],['中川幸子','赤身焼肉',5400],['中川幸子','霜降スライス',4800],['中川幸子','【訳あり】バラ焼肉',4050],['中川幸子','バラ焼肉',3250],['中川幸子','和牛切り落とし',3200],['中川幸子','江田和牛ハンバーグ',3040],['中川幸子','平飼い鶏セット',3000],['中川幸子','平飼い鶏モモ',2432],['中川幸子','薄切ロースステーキ',2200],['中川幸子','平飼い鶏ミンチ',2000],['中川幸子','平飼い鶏ムネ',1280],
['鈴木慈子','平飼い鶏肉セット',12330],['鈴木慈子','赤身焼肉',6400],['鈴木慈子','和牛ミンチ',6400],['鈴木慈子','和牛切り落とし',6100],['鈴木慈子','バラ焼肉',4600],['鈴木慈子','平飼い鶏モモ',3680],['鈴木慈子','江田和牛ハンバーグ',3250],['鈴木慈子','【数量限定】平飼い鶏肉セット',3180],['鈴木慈子','平飼い鶏セット',3000],['鈴木慈子','平飼い鶏ムネ',1280],
['釡野彬仁','赤身焼肉',10300],['釡野彬仁','【訳あり】バラ焼肉',7150],['釡野彬仁','【訳あり商品】ミスジステーキ',6650],['釡野彬仁','ミスジステーキ',5980],['釡野彬仁','【訳あり商品】サーロステーキ',5700],['釡野彬仁','江田和牛焼肉セット',5500],['釡野彬仁','赤身ステーキ',5400],['釡野彬仁','和牛ミンチ',4050],['釡野彬仁','サイコロステーキ',4000],['釡野彬仁','【限定】赤身×バラ焼肉セット',3980],['釡野彬仁','平飼い鶏肉セット',3650],['釡野彬仁','バラ焼肉',3250],['釡野彬仁','和牛ホルモン',760],
['水間大輔','赤身ステーキ',25840],['水間大輔','【訳あり】赤身ステーキ 3つセット',7500],['水間大輔','赤身焼肉',3800],['水間大輔','【訳あり】バラ焼肉',1500],['水間大輔','和牛ホルモン',780],
['上原亜由子','サーロステーキ',31200],['上原亜由子','ヒレステーキ',14250],['上原亜由子','霜降スライス',9990],['上原亜由子','【訳あり商品】霜降スライス',8880],['上原亜由子','和牛ローストビーフ/約300g',7400],['上原亜由子','赤身スライス',7020],['上原亜由子','平飼い鶏モモ',3712],['上原亜由子','和牛生ハム',1250],
['都丸理恵','豪華訳ありセット',22990],['都丸理恵','霜降スライス',11460],['都丸理恵','サーロステーキ',9600],['都丸理恵','和牛ハラミ',5700],['都丸理恵','サイコロステーキ',5154],['都丸理恵','薄切ロースステーキ',4400],['都丸理恵','赤身焼肉',4320],['都丸理恵','バラ焼肉',3600],['都丸理恵','和牛切り落とし',3200],
['三輪瑞江','【訳あり】バラ焼肉',12400],['三輪瑞江','和牛切り落とし',7200],['三輪瑞江','バラ焼肉',4500],['三輪瑞江','平飼い鶏肉セット',4180],['三輪瑞江','【訳あり商品】赤身切り落とし',3600],['三輪瑞江','江田和牛ハンバーグセット',2400],
['三浦峰子','平飼い鶏肉セット',9440],['三浦峰子','和牛切り落とし',3600],['三浦峰子','和牛ミンチ',2700],['三浦峰子','赤身スライス',2000],['三浦峰子','平飼い鶏ムネ',1280],
['藤本孝','【竹】ステーキ & ハンバーグｾｯﾄ',9800],['藤本孝','平飼い鶏セット',8000],['藤本孝','不揃い品セット',7980],['藤本孝','モツ鍋セット',5980],['藤本孝','和牛タン',5800],['藤本孝','（卵）レギュラープラン',4500],['藤本孝','【訳あり商品】有機たまご｜30個',2700],['藤本孝','赤身焼肉',2400],['藤本孝','和牛ミンチ',2000],['藤本孝','和牛ホルモン',1800],['藤本孝','平飼い鶏ムネ',1280],['藤本孝','有機たまご｜10個',720]
  ];
}

function vipsegGetSnapSheet_(sns){
  var sh = sns.getSheetByName(VIPSEG_SNAP_TAB);
  if (!sh){
    sh = sns.insertSheet(VIPSEG_SNAP_TAB);
    sh.getRange(1,1,1,4).setValues([['名前','商品名','金額(総売上高)','メモ']]);
    sh.getRange(1,1,1,4).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() < 2){
    var seed = vipsegSeedRows_();
    sh.getRange(2,1,seed.length,3).setValues(seed);
    sh.getRange(2,4).setValue('2026-09-05 Shopify管理画面「顧客名別の売上」レポート(全期間)から取得。月1回ここを取り直す。');
  }
  return sh;
}

/* 新EC: 商品名(+バリエーション)→価格 */
function vipsegPriceMap_(){
  var ps = ss().getSheetByName('products');
  var map = { full:{}, name:{} };
  if (!ps) return map;
  var d = ps.getDataRange().getValues(); if (d.length < 2) return map;
  var H = d[0];
  var iN = H.indexOf('name'), iV = H.indexOf('variant'), iP = H.indexOf('price');
  if (iN < 0 || iP < 0) return map;
  for (var r=1; r<d.length; r++){
    var n = String(d[r][iN]||'').trim(); if (!n) continue;
    var p = Number(d[r][iP]) || 0; if (!p) continue;
    map.full[n + '||' + String(d[r][iV]||'').trim()] = p;
    if (!map.name[n]) map.name[n] = p;
  }
  return map;
}

function updateVipDiscountSegment(){
  var sns  = SpreadsheetApp.openById(VIPSEG_SNS_ID);
  var snap = vipsegGetSnapSheet_(sns);
  var agg  = {};   // key -> 集計
  function bucket_(name){
    var k = vipsegKey_(name);
    if (!agg[k]) agg[k] = { name:String(name||'').trim(), sTot:0, sD1:0, sD2:0, eTot:0, eD1:0, eD2:0, miss:0 };
    return agg[k];
  }

  /* ① Shopify（スナップショット） */
  var sv = snap.getDataRange().getValues();
  for (var i=1; i<sv.length; i++){
    var nm = sv[i][0], ti = sv[i][1], am = Number(sv[i][2]) || 0;
    if (!vipsegKey_(nm) || !am) continue;
    var b = bucket_(nm);
    b.sTot += am;
    if (vipsegIsDiscountOnly_(ti))    b.sD1 += am;
    if (vipsegIsDiscountWithSet_(ti)) b.sD2 += am;
  }

  /* ② 新EC（orders × products） */
  var pm = vipsegPriceMap_();
  var os = ss().getSheetByName('orders');
  if (os){
    var d = os.getDataRange().getValues();
    var H = d[0];
    var oN = H.indexOf('customer_name'), oI = H.indexOf('items_json'), oS = H.indexOf('payment_status');
    for (var r=1; r<d.length; r++){
      var st = String(d[r][oS]||'');
      if (st !== 'paid' && st !== 'shipped') continue;
      var nm2 = String(d[r][oN]||'').trim(); if (!vipsegKey_(nm2)) continue;
      var items = [];
      try { items = JSON.parse(d[r][oI] || '[]') || []; } catch(e){ items = []; }
      if (!items.length) continue;
      var b2 = bucket_(nm2);
      for (var j=0; j<items.length; j++){
        var it = items[j];
        var t  = String(it.title || it.name || '').trim();
        var q  = Number(it.qty || it.quantity || 0) || 0;
        if (!t || !q) continue;
        var pr = pm.full[t + '||' + String(it.variant||'').trim()] || pm.name[t] || 0;
        if (!pr){ b2.miss += q; continue; }   // 価格が引けない商品は分母からも外す
        var amt = pr * q;
        b2.eTot += amt;
        if (vipsegIsDiscountOnly_(t))    b2.eD1 += amt;
        if (vipsegIsDiscountWithSet_(t)) b2.eD2 += amt;
      }
    }
  }

  /* ③ 書き出し */
  var rows = [];
  for (var k in agg){
    var a = agg[k];
    var tot = a.sTot + a.eTot; if (!tot) continue;
    var r1 = (a.sD1 + a.eD1) / tot;
    var r2 = (a.sD2 + a.eD2) / tot;
    rows.push([ a.name, a.sTot, a.eTot, tot, a.sD1 + a.eD1, r1, a.sD2 + a.eD2, r2,
                (r2 >= VIPSEG_THRESHOLD ? '✓ 割引客' : ''), a.miss ? a.miss + '点' : '' ]);
  }
  rows.sort(function(x,y){ return y[7] - x[7]; });

  var out = sns.getSheetByName(VIPSEG_OUT_TAB);
  if (!out) out = sns.insertSheet(VIPSEG_OUT_TAB);
  out.clear();
  var stamp = Utilities.formatDate(new Date(), VIPSEG_TZ, 'yyyy/MM/dd HH:mm');
  out.getRange(1,1,1,10).setValues([[
    'VIP内・割引客判定（自動・毎日更新／手で書き換えても翌日消えます）', '', '', '', '', '', '', '',
    '基準: 「値引き+セット」' + Math.round(VIPSEG_THRESHOLD*100) + '%以上', '更新: ' + stamp ]]);
  out.getRange(2,1,1,10).setValues([[
    '名前','Shopify金額','新EC金額','合計','値引きのみ額','値引きのみ率','値引き+セット額','値引き+セット率','判定','価格不明で除外' ]]);
  if (rows.length) out.getRange(3,1,rows.length,10).setValues(rows);
  out.getRange(2,1,1,10).setFontWeight('bold');
  out.setFrozenRows(2);
  out.getRange(3,2,Math.max(rows.length,1),3).setNumberFormat('¥#,##0');
  out.getRange(3,5,Math.max(rows.length,1),1).setNumberFormat('¥#,##0');
  out.getRange(3,7,Math.max(rows.length,1),1).setNumberFormat('¥#,##0');
  out.getRange(3,6,Math.max(rows.length,1),1).setNumberFormat('0%');
  out.getRange(3,8,Math.max(rows.length,1),1).setNumberFormat('0%');
  out.getRange(rows.length + 4, 1).setValue(
    'Shopify＝「' + VIPSEG_SNAP_TAB + '」タブの実測値（自動取得できないため月1回 手で取り直す）。' +
    '新EC＝orders の明細×products の価格で毎日自動計算。どちらも送料・手数料を含まない商品代のみ。' +
    '割引＝【訳あり】【訳あり商品】【数量限定】【限定】【◯%オフ】不揃い品・まとめ買い。これに「◯◯セット」を足したものが「値引き+セット」。' +
    '【松】【竹】【梅】のギフトセットは定価扱いで除外。');

  var hit = rows.filter(function(r){ return r[8]; }).length;
  try { log('vip_discount_segment', { rows: rows.length, hit: hit }); } catch(e){}
  return '完了 / ' + rows.length + '人を判定 / ' + hit + '人が' + Math.round(VIPSEG_THRESHOLD*100) + '%以上';
}

/* 1回だけ実行する用: 毎朝7時10分のトリガーを付けて、その場で1回まわす。 */
function setupVipDiscountSegment(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'updateVipDiscountSegment') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('updateVipDiscountSegment').timeBased().everyDays(1).atHour(7).nearMinute(10).create();
  return updateVipDiscountSegment();
}
