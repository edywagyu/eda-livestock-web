/**
 * STAFF PIN セットアップ（1回だけ実行）
 *
 * 使い方:
 *   1. GAS エディタを開く
 *   2. このファイルを丸ごとペースト（既存ファイルに追記でもOK）
 *   3. 上のドロップダウンで `setupStaffPin` を選択 → ▶ 実行
 *   4. 「実行ログ」に "STAFF_PIN set to 1104" と出れば成功
 *   5. このファイルは削除しても、PIN は Script Properties に永続保存されます
 */
function setupStaffPin() {
  PropertiesService.getScriptProperties().setProperty('STAFF_PIN', '1104');
  Logger.log('✅ STAFF_PIN set to 1104');
}

/**
 * 現在の PIN を確認したい時用（オプション）
 */
function checkStaffPin() {
  var pin = PropertiesService.getScriptProperties().getProperty('STAFF_PIN');
  Logger.log('Current STAFF_PIN: ' + (pin || '(未設定 — デフォルト 1234 にフォールバック)'));
}
