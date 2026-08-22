# 経営/スタッフページ ライブ運用ガイド

最終更新: 2026-05-24

このドキュメントは、`dashboard.html`（経営）と `staff.html`（現場）を **デモ表示 → 実データ表示** に切り替えるための運用手順です。

---

## 🎯 ゴール

| ページ | URL | 表示すべき実データ |
|--------|-----|------------------|
| 経営ダッシュボード | `/dashboard.html` | 売上・MRR・LINE友だち数・アンケート集計 |
| スタッフ管理 | `/staff.html` | 今日の注文数・発送数・在庫低品目・売上 |

両方とも **同一 GAS Web App** に接続：
```
https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec
```

---

## ✅ 1. 接続確認（30秒）

ブラウザで以下を開く：

```
https://script.google.com/macros/s/AKfycbx7u3D5mMFGW4FMTLy5eeH6BjOtnSuzIzEmjtHu5hy7O8YcPpeou3DJyyesuffDHTFFyQ/exec?action=ping
```

| レスポンス | 状態 |
|-----------|------|
| `{"ok":true, ...}` | ✅ GAS 生存 |
| `{"ok":false, "error":"..."}` | ⚠️ GAS は動いてるが `ping` action 未実装 |
| HTML エラー / 403 | ❌ GAS デプロイの「アクセスできるユーザー」が「全員（匿名）」になっていない |

---

## 📊 2. dashboard.html (経営側) で実データを出す

### A. 既定で接続する
今回の修正で **GAS URL がコードに既定値として組み込まれた** ため、何もせずに URL を開けば実データを試行します。

サイドバー下部の同期バッジを確認：
- 🟢「GAS 接続OK · HH:MM:SS」← OK
- 🔴「GAS 接続失敗 (HTTP xxx) — 接続復旧までデモ表示」← 対処必要

### B. 必要な GAS action 一覧

dashboard.html が呼び出す GAS action：

| action | 用途 | レスポンス例 |
|--------|------|------------|
| `ping` | 接続確認 | `{ok:true}` |
| `dashboard` | オーバービュー | `{overview:{revenue, orders, avg, activeSub, mrr, line, ...}, recentOrders:[...], survey:{...}}` |
| `orders` | 注文一覧 | `{orders:[{num, date, customer, items, total, payment, shipping, mode}, ...]}` |
| `subscriptions` | 定期便メンバー | `{subs:[{name, plan, start, next, total, status}, ...]}` |
| `customers` | 顧客 CRM | `{customers:[{name, email, phone, total, last, segment, line, survey}, ...]}` |
| `survey_responses` | アンケート集計 | `{survey:{organic:{}, source:{}, meats:{}}, count}` |
| `quiz_responses` | 診断クイズ集計 | `{quiz:{fam:{}, freq:{}, budget:{}}, count}` |

**1つでも未実装なら、そのタブだけデモ値が残ります**（他は実データ）。

---

## 📱 3. staff.html (現場側) で実データを出す

### A. ログイン
1. PIN `1234` を入力 → GAS の `staff_login` 確認 → 成功すれば **ライブモード**
2. GAS が応答しない／success:false なら自動で **デモモード** へフォールバック

画面上部の帯：
- 🟢「ライブ運用中 — GAS 接続OK」← 実データ表示中
- 🟡「デモモード」← サンプル表示
- 🔴「GAS 接続失敗」← 対処必要

帯の右側「**接続テスト**」ボタンで再判定可能（リロード不要）。

### B. 必要な GAS action 一覧

| action | 用途 |
|--------|------|
| `ping` | 接続確認 |
| `staff_login` | PIN 認証 `?pin=1234` → `{success:true}` |
| `staff_dashboard` | 今日のKPI `{todayOrders, todayShip, tomorrowShip, pendingShip, todayRevenue, lowStock}` |
| `staff_analytics` | PV/CVR 分析 |
| `staff_orders` | 注文一覧（発送処理用） |
| `staff_ship` | 発送完了マーク (POST) |
| `staff_inventory` | 在庫一覧 |
| `staff_update_stock` | 在庫変更 (POST) |
| `staff_line_blast` | LINE一斉配信 (POST) |
| `staff_product_save/delete` | 商品マスター編集 |
| `staff_subscription_save/delete` | 定期便メンバー編集 |
| `staff_gift_save/delete` | ギフト商品編集 |
| `staff_rewards_save` | リワード設定 |
| `staff_weekly_menu_save` | 週次メニュー編集 |
| `staff_flow_toggle` | LINE自動シナリオON/OFF |

---

## 🛠 4. GAS 側で実装すべき関数のテンプレート

GAS のエディタで以下を `Code.gs` に追加（足りないものだけ）：

```javascript
function doGet(e) {
  const action = e.parameter.action;
  const SHEET_ID = '1tNbIvsTkqrJiWtgpKCHevs_qeVjfNny0FPEsqTtxruM'; // ★ 実際のスプシID
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let out;
  try {
    if (action === 'ping')              out = { ok: true, ts: Date.now() };
    else if (action === 'staff_login')  out = handleStaffLogin(e.parameter.pin, ss);
    else if (action === 'staff_dashboard') out = handleStaffDashboard(ss);
    else if (action === 'dashboard')    out = handleDashboard(ss);
    else if (action === 'orders')       out = handleOrders(ss);
    else if (action === 'subscriptions') out = handleSubscriptions(ss);
    else if (action === 'customers')    out = handleCustomers(ss);
    else if (action === 'survey_responses') out = handleSurveyResponses(ss);
    else if (action === 'quiz_responses')   out = handleQuizResponses(ss);
    // ...他のアクションも同じ要領で
    else out = { ok: false, error: 'unknown action: ' + action };
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// ====== STAFF: 今日のKPI ======
function handleStaffDashboard(ss) {
  const orders = ss.getSheetByName('orders').getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
  let todayOrders = 0, todayShip = 0, tomorrowShip = 0, pendingShip = 0, todayRevenue = 0;
  for (let i = 1; i < orders.length; i++) {
    const row = orders[i];
    const orderDate = Utilities.formatDate(new Date(row[1]), 'JST', 'yyyy-MM-dd');
    const shipDate  = Utilities.formatDate(new Date(row[5]), 'JST', 'yyyy-MM-dd');
    if (orderDate === today) { todayOrders++; todayRevenue += Number(row[4]) || 0; }
    if (shipDate === today && row[6] === '発送済') todayShip++;
    if (row[6] === '未発送') pendingShip++;
  }
  const inventory = ss.getSheetByName('inventory').getDataRange().getValues();
  let lowStock = 0;
  for (let i = 1; i < inventory.length; i++) {
    if (Number(inventory[i][2]) < 5) lowStock++;  // 在庫5未満
  }
  return { todayOrders, todayShip, tomorrowShip, pendingShip, todayRevenue, lowStock };
}

// ====== 経営: オーバービュー ======
function handleDashboard(ss) {
  const orders = ss.getSheetByName('orders').getDataRange().getValues();
  const subs   = ss.getSheetByName('subscriptions').getDataRange().getValues();
  const customers = ss.getSheetByName('customers').getDataRange().getValues();
  // 当月売上集計
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let revenue = 0, count = 0;
  for (let i = 1; i < orders.length; i++) {
    if (new Date(orders[i][1]) >= monthStart) {
      revenue += Number(orders[i][4]) || 0;
      count++;
    }
  }
  const avg = count ? Math.round(revenue / count) : 0;
  // アクティブ定期便
  const activeSub = subs.filter((r, i) => i > 0 && r[5] === 'active').length;
  const mrr = subs.reduce((sum, r, i) => i > 0 && r[5] === 'active' ? sum + (Number(r[6]) || 0) : sum, 0);
  return {
    overview: {
      revenue, revenueDelta: 12, orders: count, avg,
      activeSub, subDelta: 6, mrr,
      line: customers.filter((r, i) => i > 0 && r[6]).length,
      lineDelta: 0, lineConvRate: 0,
      quiz: 0, quizDelta: 0, quizRate: 0
    },
    recentOrders: orders.slice(1, 6).map(r => ({
      num: r[0], customer: r[2], total: Number(r[4]) || 0, status: r[6] || 'pending'
    })),
    survey: { organic: {}, source: {}, meats: {} }
  };
}

// 他のハンドラも同じ要領で実装
```

---

## 🚨 5. トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| dashboard で「GAS 接続失敗」 | GAS デプロイの公開設定 | GAS エディタ → デプロイ → ウェブアプリ → アクセスできるユーザー: 全員 |
| dashboard で一部タブだけデモ | 該当 action が未実装 | 上の action 一覧で対象を確認 → GAS に handler を追加 |
| staff で「ライブ運用中」表示なのに数値が「—」 | `staff_dashboard` action が `{ok:false}` を返している | GAS エディタの実行ログを確認、エラーを修正 |
| staff PIN 1234 でデモから抜けられない | `staff_login` action 未実装 | GAS に `handleStaffLogin` を追加し、`{success:true}` を返すように |
| CORS エラー | GAS のレスポンスヘッダ問題 | `ContentService.createTextOutput(...).setMimeType(JSON)` を使う（HtmlServiceは NG） |

---

## 📋 6. 運用開始までのチェックリスト

- [ ] GAS Web App が公開（匿名アクセス可）でデプロイ済み
- [ ] `?action=ping` で `{ok:true}` が返る
- [ ] 必要な Sheets タブ（`orders`/`subscriptions`/`customers`/`inventory`/`survey`/`quiz`）が存在
- [ ] 各タブのヘッダ行が GAS ハンドラの想定列順と一致
- [ ] `dashboard.html` を開いてサイドバー下部が「GAS 接続OK」表示
- [ ] `staff.html` PIN 1234 → 帯が「🟢 ライブ運用中」表示
- [ ] 「今日の状況」KPI が0以外（注文1件以上ある日に確認）
- [ ] 「接続テスト」ボタンで再判定可能
- [ ] スマホ（iOS Safari）でも同じ表示

---

## 💡 デモモードを意図的に使いたい時

- `staff.html` の「🎭 デモを試す（PIN不要）」ボタンから入る
- `mypage.html?demo=1` でマイページのデモ
- これらは **お客さん/スタッフ向け説明会用**。本番運用では使わない
