/**
 * ============================================================
 *  カゴ落ちLINEリマインド（特典なし・在庫/締切訴求）
 *  2026-07-28 追加 / 自己完結・既存関数(cfg, sendLinePush, ss, sheet)を流用
 * ------------------------------------------------------------
 *  仕組み:
 *   - events の begin_checkout（line_uid付き）を拾い、その後 purchase/orders が
 *     無い＝カゴ落ちの LINE連携済みユーザーを抽出。
 *   - 決済開始から CART_DELAY_MIN 分以上経過＆未購入なら 1通だけ push。
 *   - 夜間(CART_QUIET_START〜CART_QUIET_END時)は送らず、翌朝トリガーが拾う。
 *   - 同一 line_uid へ CART_COOLDOWN_H 時間は再送しない（二重送信防止）。
 *   - 結果は events DB「カゴ落ち_送信ログ」＋ SNS運用管理「LINE_カゴ落ち施策」に記録。
 *
 *  安全設計:
 *   - 既存コードには一切触れない（新規ファイル/新規関数のみ）。
 *   - 実送信は CART_RECOVERY_ENABLED === 'true' の時だけ。既定は false。
 *   - runCartRecoveryDry() はいつでも安全（送らず候補リストのみ出力）。
 *
 *  Script Properties（任意・未設定なら既定値）:
 *   CART_RECOVERY_ENABLED   実送信ON/OFF   （既定 'false'）
 *   CART_DELAY_MIN          何分後に送るか （既定 60）
 *   CART_LOOKBACK_H         何時間前まで対象（既定 24）
 *   CART_QUIET_START        夜間開始(時)   （既定 22）
 *   CART_QUIET_END          夜間終了(時)   （既定 8）
 *   CART_COOLDOWN_H         再送禁止(時間) （既定 48）
 *   CART_RECOVERY_URL       誘導先URL      （既定 https://www.eda-livestock.com/checkout.html）
 * ============================================================ */

var CART_SNS_SHEET_ID   = '1KKCIYgWr2rvESSXTcsuqlAFDs0WlRX0j9A79l2iZut4'; // SNS運用管理_江田畜産
var CART_SENT_SHEET      = 'カゴ落ち_送信ログ';       // events DB 側（詳細）
var CART_CAND_SHEET      = 'カゴ落ち_送信候補';       // events DB 側（ドライラン出力）
var CART_SHISAKU_TAB     = 'LINE_カゴ落ち施策';       // SNS運用管理 側（人が見る施策ログ）
var CART_SHISAKU_NAME    = 'カゴ落ち1時間後リマインド（特典なし・在庫/締切訴求）';

function cart_num_(key, def){ var v = cfg(key); v = (v===''||v==null)?null:Number(v); return (v==null||isNaN(v))?def:v; }
function cart_now_(){ return new Date(); }
function cart_ymd_(d){ return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); }
function cart_stamp_(d){ return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'); }

/* ---- 本番ON/OFF（手動）---- */
function setCartRecoveryOn(){  PropertiesService.getScriptProperties().setProperty('CART_RECOVERY_ENABLED','true');  return 'CART_RECOVERY_ENABLED=' + PropertiesService.getScriptProperties().getProperty('CART_RECOVERY_ENABLED'); }
function setCartRecoveryOff(){ PropertiesService.getScriptProperties().setProperty('CART_RECOVERY_ENABLED','false'); return 'CART_RECOVERY_ENABLED=' + PropertiesService.getScriptProperties().getProperty('CART_RECOVERY_ENABLED'); }

/* ---- 手動エントリポイント ---- */
function runCartRecoveryDry(){ try{ setupCartShisakuTab(); }catch(e){ log('cart_setup_err',{e:e.message}); } return cartRecovery_('dry'); }   // 送らず候補だけ出す（安全）＋施策タブ担保
function runCartRecoveryLive(){ return cartRecovery_('live'); } // 実送信（ENABLED=true必須）

/* ---- 1時間トリガー設置（1回だけ実行）---- */
function installCartRecoveryTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'runCartRecoveryLive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runCartRecoveryLive').timeBased().everyHours(1).create();
  return 'installed: runCartRecoveryLive 1時間毎';
}

/* ============================================================
   本体
   ============================================================ */
function cartRecovery_(mode){
  var now = cart_now_();
  var DELAY   = cart_num_('CART_DELAY_MIN', 60);
  var LOOKB   = cart_num_('CART_LOOKBACK_H', 24);
  var QS      = cart_num_('CART_QUIET_START', 22);
  var QE      = cart_num_('CART_QUIET_END', 8);
  var COOL    = cart_num_('CART_COOLDOWN_H', 48);
  var enabled = String(cfg('CART_RECOVERY_ENABLED','false')) === 'true';

  var sh = ss().getSheetByName('events');
  if (!sh) return { ok:false, error:'events sheet なし' };
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return { ok:true, candidates:0, note:'events 空' };
  var H = data[0];
  var iTs=H.indexOf('ts'), iType=H.indexOf('event_type'), iSid=H.indexOf('session_id'),
      iPid=H.indexOf('product_id'), iVal=H.indexOf('value'), iMeta=H.indexOf('meta_json');

  // 収集
  var begins = [];                 // カゴ落ち候補（line_uid付き begin_checkout）
  var purchaseBySession = {};      // session_id -> 最新 purchase ts
  for (var r=1; r<data.length; r++){
    var row = data[r], type = row[iType];
    var ts = row[iTs] instanceof Date ? row[iTs] : new Date(row[iTs]);
    if (!ts || isNaN(ts.getTime())) continue;
    if (type === 'purchase'){
      var sid = String(row[iSid]||'');
      if (sid && (!purchaseBySession[sid] || ts > purchaseBySession[sid])) purchaseBySession[sid] = ts;
    } else if (type === 'begin_checkout'|| type === 'add_to_cart'){
      var meta = {}; try { meta = JSON.parse(row[iMeta]||'{}'); } catch(e){}
      var uid = String(meta.line_uid||'').trim();
      if (!uid) continue; // 未連携は送れない
      begins.push({ ts:ts, sid:String(row[iSid]||''), uid:uid,
                    value:Number(row[iVal])||0, pid:String(row[iPid]||'') });
    }
  }

  // orders から line_uid の購入時刻（session跨ぎの復帰も検知）
  var ordersByUid = cartOrdersByUid_();
  // customers から表示名
  var nameByUid = cartNamesByUid_();
  // 送信済み（クールダウン＆二重送信防止）
  var lastSentByUid = cartLastSentByUid_();

  // line_uid 単位で最新のカゴ落ちだけ残す
  var latestByUid = {};
  begins.forEach(function(b){ if (!latestByUid[b.uid] || b.ts > latestByUid[b.uid].ts) latestByUid[b.uid] = b; });

  var quiet = (now.getHours() >= QS || now.getHours() < QE); // JST（プロジェクトTZ=東京）
  var cand = [];
  Object.keys(latestByUid).forEach(function(uid){
    var b = latestByUid[uid];
    var ageMin = (now - b.ts) / 60000;
    if (ageMin < DELAY) return;             // まだ早い
    if (ageMin > LOOKB*60) return;          // 古すぎ
    // 復帰判定: 同session の purchase、または orders に開始後の注文
    var recovered = (purchaseBySession[b.sid] && purchaseBySession[b.sid] >= b.ts);
    if (!recovered && ordersByUid[uid]) {
      recovered = ordersByUid[uid].some(function(pt){ return pt >= b.ts; });
    }
    if (recovered) return;
    // クールダウン
    var last = lastSentByUid[uid];
    if (last && (now - last) < COOL*3600000) return;
    cand.push({ uid:uid, name:(nameByUid[uid]||''), ts:b.ts, value:b.value,
                ageMin:Math.round(ageMin), pid:b.pid });
  });

  // ---- ドライラン: 候補を書き出すだけ ----
  if (mode !== 'live'){
    cartWriteCandidates_(cand, quiet);
    return { ok:true, mode:'dry', candidates:cand.length, quietNow:quiet,
             sample:cand.slice(0,5).map(function(c){return {name:c.name||c.uid.slice(0,6), amount:c.value, ageMin:c.ageMin};}) };
  }

  // ---- 実送信 ----
  if (!enabled) return { ok:true, mode:'live', sent:0, skipped:'CART_RECOVERY_ENABLED!=true（未有効化のため送信せず）', candidates:cand.length };
  if (quiet)    return { ok:true, mode:'live', sent:0, skipped:'夜間帯のため送信せず（翌朝トリガーが送る）', candidates:cand.length };

  var url = cfg('CART_RECOVERY_URL', 'https://www.eda-livestock.com/checkout.html');
  var sentRows = [], names = [], ok=0;
  cand.forEach(function(c){
    var msg = cartBuildMessage_(c.name, url);
    var res = sendLinePush(c.uid, msg);   // 既存ヘルパ（LINE_CHANNEL_TOKEN使用）
    if (res) ok++;
    if (c.name) names.push(c.name);
    sentRows.push([ cart_stamp_(now), c.uid, c.name||'', cart_stamp_(c.ts), c.value, res?'成功':'失敗', '', '' ]);
  });
  if (sentRows.length) cartAppendSentLog_(sentRows);
  if (sentRows.length) cartUpsertShisaku_(now, cand.length, ok, names);
  return { ok:true, mode:'live', sent:ok, of:cand.length };
}

/* ============================================================
   メッセージ（特典なし・在庫/締切訴求・単一CTA）
   ============================================================ */
function cartBuildMessage_(name, url){
  var hello = name ? (name + 'さん、') : '';
  var text =
    hello + '先ほどはカゴにお肉を入れていただきありがとうございます🥩\n' +
    'もし「クーポンの使い方がわからない」「お支払い方法で迷う」など、お困りのことがあれば、このままメッセージで気軽に教えてください。すぐにお手伝いします🙌';
  // クリック計測は既存の c.html 経由（msg=cart_recovery）
  var tracked = 'https://www.eda-livestock.com/c.html?to=' + encodeURIComponent(url) +
                '&msg=cart_recovery&l=reminder1';
  return [{
    type:'template', altText:'お買い物でお困りではないですか？🐃',
    template:{ type:'buttons', text: text.slice(0,160),
      actions:[{ type:'uri', label:'カゴを見る', uri: tracked }] }
  }];
}

/* ============================================================
   補助: orders / customers / 送信ログ
   ============================================================ */
function cartOrdersByUid_(){
  var map = {};
  var sh = ss().getSheetByName('orders'); if (!sh) return map;
  var d = sh.getDataRange().getValues(); if (d.length<2) return map;
  var H=d[0], ip=H.indexOf('placed_at');
  var iu=H.indexOf('line_uid');       // usually absent in orders (-1)
  var im=H.indexOf('metadata_json');  // line_uid lives inside metadata_json
  if (ip<0) return map;
  for (var r=1;r<d.length;r++){
    var uid='';
    if (iu>=0) uid=String(d[r][iu]||'').trim();
    if (!uid && im>=0){ try{ var m=JSON.parse(d[r][im]||'{}'); uid=String(m.line_uid||'').trim(); }catch(e){} }
    if (!uid) continue;
    var pt=d[r][ip]?new Date(d[r][ip]):null; if(!pt||isNaN(pt.getTime())) continue;
    (map[uid]=map[uid]||[]).push(pt);
  }
  return map;
}function cartNamesByUid_(){
  var map = {};
  var sh = ss().getSheetByName('customers'); if(!sh) return map;
  var d = sh.getDataRange().getValues(); if(d.length<2) return map;
  var H=d[0], iu=H.indexOf('line_uid'), iln=H.indexOf('line_name'), inm=H.indexOf('name');
  for (var r=1;r<d.length;r++){
    var uid=String(d[r][iu]||'').trim(); if(!uid) continue;
    var nm = (iln>=0 && d[r][iln]) ? d[r][iln] : (inm>=0 ? d[r][inm] : '');
    if (nm) map[uid]=String(nm);
  }
  return map;
}
function cartLastSentByUid_(){
  var map={};
  var sh = ss().getSheetByName(CART_SENT_SHEET); if(!sh) return map;
  var d = sh.getDataRange().getValues(); if(d.length<2) return map;
  // 0:送信日時 1:line_uid
  for (var r=1;r<d.length;r++){
    var uid=String(d[r][1]||'').trim(); if(!uid) continue;
    var t=d[r][0]?new Date(d[r][0]):null; if(!t||isNaN(t.getTime())) continue;
    if(!map[uid]||t>map[uid]) map[uid]=t;
  }
  return map;
}
function cartAppendSentLog_(rows){
  var sh = sheet(CART_SENT_SHEET, ['送信日時','line_uid','表示名','カゴ落ち時刻','金額','送信結果','復帰','復帰売上']);
  sh.getRange(sh.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
}
function cartWriteCandidates_(cand, quiet){
  var sh = sheet(CART_CAND_SHEET, ['抽出日時','line_uid','表示名','カゴ落ち時刻','金額','経過(分)','夜間?']);
  if (sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,7).clearContent();
  if (!cand.length) return;
  var now = cart_now_();
  var vals = cand.map(function(c){
    return [ cart_stamp_(now), c.uid, c.name||'', cart_stamp_(c.ts), c.value, c.ageMin, quiet?'夜間(翌朝送信)':'' ];
  });
  sh.getRange(2,1,vals.length,7).setValues(vals);
}

/* SNS運用管理「LINE_カゴ落ち施策」に “その日1行” で upsert（人が見る施策ログ）*/
function cartUpsertShisaku_(now, candN, okN, names){
  try{
    var s = SpreadsheetApp.openById(CART_SNS_SHEET_ID);
    var sh = s.getSheetByName(CART_SHISAKU_TAB);
    if (!sh){ sh = s.insertSheet(CART_SHISAKU_TAB); sh.appendRow(['日付','施策内容','実装した顧客','結果']); sh.setFrozenRows(1); }
    var day = cart_ymd_(now);
    var d = sh.getDataRange().getValues();
    var rowIdx = -1;
    for (var r=1;r<d.length;r++){ if (cart_ymd_(new Date(d[r][0]))===day && String(d[r][1]).indexOf('カゴ落ち')===0) { rowIdx=r+1; break; } }
    var who = (names.length? (names.slice(0,20).join('、') + (names.length>20?' 他':'')) : '（表示名なし）') + '（' + candN + '名）';
    var result = '送信 ' + okN + '/' + candN + '件成功・復帰は追跡中';
    if (rowIdx<0){ sh.appendRow([day, CART_SHISAKU_NAME, who, result]); }
    else { sh.getRange(rowIdx,3).setValue(who); sh.getRange(rowIdx,4).setValue(result); }
  }catch(e){ log('cart_shisaku_error',{error:e.message}); }
}

/* SNS運用管理「LINE_カゴ落ち施策」タブを用意し、初回の説明行を入れる（手動1回）*/
function setupCartShisakuTab(){
  var s = SpreadsheetApp.openById(CART_SNS_SHEET_ID);
  var sh = s.getSheetByName(CART_SHISAKU_TAB);
  if (!sh){ sh = s.insertSheet(CART_SHISAKU_TAB); }
  if (sh.getLastRow() < 1 || String(sh.getRange(1,1).getValue()) !== '日付'){
    sh.clear();
    sh.getRange(1,1,1,4).setValues([['日付','施策内容','実装した顧客','結果']]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,4).setFontWeight('bold').setBackground('#0F3D2E').setFontColor('#FFFFFF');
    sh.setColumnWidth(1,110); sh.setColumnWidth(2,360); sh.setColumnWidth(3,340); sh.setColumnWidth(4,340);
  }
  var day = cart_ymd_(cart_now_());
  var d = sh.getDataRange().getValues();
  for (var r=1;r<d.length;r++){ if (String(d[r][1]).indexOf('カゴ落ち')===0) return '既に行あり（追記なし）'; }
  sh.appendRow([ day, CART_SHISAKU_NAME,
    '（本日 記録開始・該当者はまだ0名）',
    'ドライラン確認OK／本番送信は未有効化（CART_RECOVERY_ENABLED=false）。以後の実送信ぶんはこの行に自動追記。' ]);
  return 'setup済み: ' + CART_SHISAKU_TAB;
}

/* 送信せず“候補だけ”毎時更新する監視トリガー（本番送信の前段・安全）*/
function installCartRecoveryDryTrigger(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    var f=t.getHandlerFunction(); if (f==='runCartRecoveryDry'||f==='runCartRecoveryLive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runCartRecoveryDry').timeBased().everyHours(1).create();
  return 'installed: runCartRecoveryDry 1時間毎（送信なし・候補監視）';
}

/* 後追い: 送信後 CART_COOLDOWN_H 内に購入したか判定して「復帰」を埋める（任意・手動/日次）*/
function updateCartRecoveryResults_(){
  var sh = ss().getSheetByName(CART_SENT_SHEET); if(!sh) return 'ログなし';
  var d = sh.getDataRange().getValues(); if(d.length<2) return '空';
  var ordersByUid = cartOrdersByUid_();
  var filled=0;
  for (var r=1;r<d.length;r++){
    if (d[r][6]) continue;                       // 既に判定済み
    var uid=String(d[r][1]||'').trim(); if(!uid) continue;
    var sentAt=d[r][0]?new Date(d[r][0]):null; if(!sentAt) continue;
    var arr=ordersByUid[uid]||[];
    var hit=arr.some(function(pt){ return pt>=sentAt; });
    if (hit){ sh.getRange(r+1,7).setValue('✓復帰'); filled++; }
    else if ((cart_now_()-sentAt) > 72*3600000){ sh.getRange(r+1,7).setValue('—'); } // 3日で締め
  }
  return '更新 '+filled+'件';
}
