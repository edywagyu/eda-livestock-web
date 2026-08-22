/* 顧客名簿（LINE連携）自動更新 ＋ カゴ落ち復帰列の実態反映  2026-08-01 (重複まとめ版) */
var ROSTER_SNS_ID = '1KKCIYgWr2rvESSXTcsuqlAFDs0WlRX0j9A79l2iZut4';
var ROSTER_TAB    = '顧客名簿（LINE連携）';
var ROSTER_TZ     = 'Asia/Tokyo';
var CART_LOG_TAB  = 'カゴ落ち_送信ログ';

function setupRosterAutomation(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'refreshLineCustomerRoster') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshLineCustomerRoster').timeBased().everyDays(1).atHour(7).create();
  var a = refreshLineCustomerRoster();
  var b = backfillCartTruth();
  return '完了 / ' + a + ' / ' + b;
}

function rosterOrdersByUid_(){
  var db = ss();
  var os = db.getSheetByName('orders'); if (!os) return {};
  var d = os.getDataRange().getValues(); if (d.length < 2) return {};
  var H = d[0];
  var oP=H.indexOf('placed_at'), oM=H.indexOf('metadata_json'),
      oD=H.indexOf('destinations_json'), oIt=H.indexOf('items_json'),
      oTot=H.indexOf('total');
  var map = {};
  for (var r=1; r<d.length; r++){
    var uid=''; try{ var m=JSON.parse(d[r][oM]||'{}'); uid=String(m.line_uid||'').trim(); }catch(e){}
    if (!uid) continue;
    var pt = d[r][oP] ? new Date(d[r][oP]) : null; if (!pt || isNaN(pt.getTime())) continue;
    (map[uid]=map[uid]||[]).push({ pt:pt, items:rosterItems_(d[r][oD], d[r][oIt]), total:Number(d[r][oTot])||0 });
  }
  return map;
}

function rosterItems_(destJson, itemsJson){
  var parts=[];
  try{
    (JSON.parse(destJson||'[]')||[]).forEach(function(dst){
      (dst.items||[]).forEach(function(it){
        var t=it.title||it.name||''; var q=it.qty||it.quantity||1;
        if (t) parts.push(t+'×'+q);
      });
    });
  }catch(e){}
  if (!parts.length){
    try{
      (JSON.parse(itemsJson||'[]')||[]).forEach(function(it){
        var t=it.title||it.name||''; var q=it.qty||it.quantity||1;
        if (t) parts.push(t+'×'+q);
      });
    }catch(e){}
  }
  return parts.join(' / ');
}

function refreshLineCustomerRoster(){
  var db = ss();
  var cs = db.getSheetByName('customers'); if (!cs) return 'customersタブ なし';
  var cd = cs.getDataRange().getValues(); if (cd.length < 2) return 'customers 空';
  var cH = cd[0];
  function ci(n){ return cH.indexOf(n); }
  var iUid=ci('line_uid'), iName=ci('name'), iLn=ci('line_name'), iPh=ci('phone'),
      iZip=ci('zip'), iAddr=ci('address'), iCnt=ci('order_count'),
      iSpent=ci('total_spent'), iLink=ci('linked_at');
  if (iUid < 0) return 'customersに line_uid列なし';

  var ordByUid = rosterOrdersByUid_();

  function fuller(a,b){ a=(a==null?'':String(a)); b=(b==null?'':String(b)); return b.length>a.length ? b : a; }

  var byUid = {};
  for (var r=1; r<cd.length; r++){
    var uid = String(cd[r][iUid]||'').trim(); if (!uid) continue;
    var e = byUid[uid] || { name:'', ln:'', ph:'', addr:'', cnt:0, spent:0, link:'' };
    e.name  = fuller(e.name,  iName>=0 ? cd[r][iName] : '');
    e.ln    = fuller(e.ln,    iLn>=0   ? cd[r][iLn]   : '');
    e.ph    = fuller(e.ph,    iPh>=0   ? cd[r][iPh]   : '');
    var addr = ((iZip>=0?(cd[r][iZip]||''):'') + ' ' + (iAddr>=0?(cd[r][iAddr]||''):'')).trim();
    e.addr  = fuller(e.addr, addr);
    e.cnt   = Math.max(e.cnt,   iCnt>=0  ? (Number(cd[r][iCnt])||0)  : 0);
    e.spent = Math.max(e.spent, iSpent>=0? (Number(cd[r][iSpent])||0): 0);
    if (!e.link && iLink>=0 && cd[r][iLink]) e.link = Utilities.formatDate(new Date(cd[r][iLink]), ROSTER_TZ, 'yyyy/MM/dd');
    byUid[uid] = e;
  }

  var rows = [];
  Object.keys(byUid).forEach(function(uid){
    var e = byUid[uid];
    var os = (ordByUid[uid]||[]).slice().sort(function(a,b){ return a.pt - b.pt; });
    var detail = os.map(function(o){
      return Utilities.formatDate(o.pt, ROSTER_TZ, 'M/d') + '：' + (o.items||'(明細なし)');
    }).join('\n');
    rows.push([ e.name, e.ln, e.ph, e.addr, e.cnt, e.spent, detail, e.link ]);
  });
  rows.sort(function(a,b){ return (b[5]||0) - (a[5]||0); });

  var sns = SpreadsheetApp.openById(ROSTER_SNS_ID);
  var sh = sns.getSheetByName(ROSTER_TAB) || sns.insertSheet(ROSTER_TAB);
  sh.clearContents();
  var header = ['名前','LINE表示名','電話番号','郵便番号・住所','購入回数','累計購入額','購入明細（日付・商品）','LINE連携日'];
  sh.getRange(1,1,1,header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2,1,rows.length,header.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1,1,1,header.length).setBackground('#0F3D2E').setFontColor('#FFFFFF');
  return '顧客名簿 更新 ' + rows.length + '名';
}

function backfillCartTruth(){
  var sh = ss().getSheetByName(CART_LOG_TAB); if (!sh) return 'ログなし';
  var d = sh.getDataRange().getValues(); if (d.length < 2) return 'ログ空';
  var ordersByUid = cartOrdersByUid_();
  var n=0;
  for (var r=1; r<d.length; r++){
    if (d[r][6]) continue;
    var uid = String(d[r][1]||'').trim(); if (!uid) continue;
    var abandonAt = d[r][3] ? new Date(d[r][3]) : null;
    var sentAt    = d[r][0] ? new Date(d[r][0]) : null;
    var arr = ordersByUid[uid] || [];
    var buys = abandonAt ? arr.filter(function(pt){ return pt >= abandonAt; }) : [];
    if (buys.length){
      var beforeSend = sentAt && buys.some(function(pt){ return pt < sentAt; });
      sh.getRange(r+1, 7).setValue(beforeSend ? '購入済み（配信前・誤送信）' : '✓復帰（配信後に購入）');
      sh.getRange(r+1, 8).setValue(d[r][4]||'');
      n++;
    }
  }
  return '復帰列 更新 ' + n + '件';
}