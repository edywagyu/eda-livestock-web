/**
 * ============================================================
 *  🎂 誕生日まわりの初期設定を1回で済ませる
 *  2026-09-07
 * ------------------------------------------------------------
 *  Apps Script エディタで setupBirthdayAll を1回だけ▶で実行する。
 *  やることは4つ:
 *    ① 誕生日メッセージのトリガー（毎朝9時）を置く
 *    ② 定期便の印つけのトリガー（毎朝7時）を置く
 *    ③ 定期便の印つけを今すぐ1回まわす（顧客/注文タブに列ができる）
 *    ④ 誕生日メッセージの送信スイッチを ON にする
 *
 *  🔴 この関数を**ファイルの先頭の public 関数**に置いてある。
 *     エディタの関数ドロップダウンは選び直しても確定しないことがあるが、
 *     ファイルを開くとツールバーに「最初の public 関数」が入るため、
 *     このファイルを開くだけで setupBirthdayAll が選ばれる。
 *     （下の確認用は名前の最後に _ を付けて候補から外してある）
 *
 *  冪等: 何度実行してもトリガーは増えず、列も増えない。
 * ============================================================ */

function setupBirthdayAll() {
  var out = {};
  try { out.誕生日メッセージのトリガー = installBirthdayGreetingTrigger(); } catch (e) { out.誕生日メッセージのトリガー = 'ERROR: ' + e.message; }
  try { out.定期便の印のトリガー       = installMarkSubscribersTrigger();   } catch (e) { out.定期便の印のトリガー       = 'ERROR: ' + e.message; }
  try { out.定期便の印を今すぐ         = runMarkSubscribers();              } catch (e) { out.定期便の印を今すぐ         = 'ERROR: ' + e.message; }
  try { out.誕生日メッセージのスイッチ = setBirthdayMsgOn();                } catch (e) { out.誕生日メッセージのスイッチ = 'ERROR: ' + e.message; }

  /* 今の状態も一緒に出す（実行結果は戻り値だと見えないのでログにも書く） */
  out.いまの状態 = birthdaySetupStatus_();
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/* 確認用（末尾 _ なので関数ドロップダウンには出ない）。setupBirthdayAll から呼ばれる。 */
function birthdaySetupStatus_() {
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  return {
    送信スイッチ: cfg('BIRTHDAY_MSG_ENABLED', 'false'),
    誕生日メッセージのトリガー: triggers.indexOf('runBirthdayGreetingLive') >= 0 ? 'あり' : 'なし',
    定期便の印のトリガー: triggers.indexOf('runMarkSubscribers') >= 0 ? 'あり' : 'なし',
    きょうの候補: (function () { try { return birthdayGreeting_('dry'); } catch (e) { return 'ERROR: ' + e.message; } })()
  };
}
