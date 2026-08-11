#!/usr/bin/env bash
# ============================================================
#  江田畜産 Web/GAS ワンコマンドデプロイ
#  使い方:  bash DEPLOY.sh
#  これ1本で「フロント(GitHub Pages)」+「裏側(GAS)」を両方反映します。
#  途中でブラウザが開いたら Google で「許可」を押すだけ。
# ============================================================
set -u

REPO="/Users/tomokieda/AI - CLAUDE CODE/eda-livestock-web"
GAS_DIR="$REPO/gas"
DEPLOY_ID="AKfycbxFfdz-H6VcwSypiEFaW1uoPVgkgMfGZbMsMcgIk8KZMUY8_4q-JKU06dnQfd1D6ARcOQ"
EXEC_URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"
EXPECT_VER="2026.05.31c"

# node/clasp の PATH（このMacの node 設置場所）
export PATH="/Users/tomokieda/.local-node/node-v22.13.0-darwin-arm64/bin:$PATH"

cd "$REPO" || { echo "❌ リポジトリが見つかりません: $REPO"; exit 1; }

echo "================================================================"
echo " STEP 0  変更内容の確認"
echo "================================================================"
git status --short
echo ""
echo "----- 変更ファイルの差分（要点）-----"
git --no-pager diff --stat
echo ""
read -r -p "この内容でデプロイします。よろしいですか? [y/N] " ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "中止しました。"; exit 0;;
esac

echo ""
echo "================================================================"
echo " STEP 1  フロント（マイページ/SW）を GitHub Pages へ反映"
echo "================================================================"
git add mypage.html sw.js staff.html gas/Code.gs
if git diff --cached --quiet; then
  echo "（コミットする変更なし。スキップ）"
else
  git commit -m "fix(backend): LINE follow webhook + coupon fallback/retry + webhook idempotency/verify + customerLookup IDORガード

- LINE友だち追加→自動で顧客行作成&ウェルカム(LIFFボタン2つ)
- 定期便50%OFF: STRIPE_COUPON_50OFF フォールバック(FIRST50)+失敗時クーポン無しで再試行
- Stripe webhook: event.id を Stripe API で再検証し偽造拒否 / 二重課金(3倍)防止
- customer_lookup: email検証 + LINE UID照合ガード(ENFORCE_LOOKUP_UID で有効化) + 監査ログ
- mypage: customer_lookup に line_uid を同送
- diag_dedupe_orders: 既存の重複注文行を集計/削除する診断エンドポイント
- sw v056 / ping version 2026.05.31c

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  echo "→ push 中..."
  git push origin main && echo "✅ フロント push 完了（GitHub Pages へ反映開始。数分で本番化）" \
                       || { echo "❌ push 失敗。上のエラーを確認してください。"; exit 1; }
fi

echo ""
echo "================================================================"
echo " STEP 2  裏側（GAS / Code.gs）を本番デプロイ"
echo "================================================================"
cd "$GAS_DIR" || { echo "❌ gas ディレクトリが無い: $GAS_DIR"; exit 1; }

# 認証チェック（期限切れなら login）
if clasp deployments 2>&1 | grep -qiE "Could not read API credentials|not logged in|Invalid"; then
  echo "🔑 GAS のログインが必要です。ブラウザが開くので Google で「許可」を押してください..."
  clasp login
fi

echo "→ ソースをアップロード（clasp push）..."
clasp push -f || { echo "❌ clasp push 失敗"; exit 1; }

echo "→ 本番デプロイ更新（clasp deploy）..."
clasp deploy -i "$DEPLOY_ID" -d "v2026.05.31c backend fixes" || { echo "❌ clasp deploy 失敗"; exit 1; }
echo "✅ GAS デプロイ完了"

echo ""
echo "================================================================"
echo " STEP 3  反映確認（自動 verify）"
echo "================================================================"
echo "→ ping でバージョン確認（期待値: ${EXPECT_VER}）"
PING=$(curl -s -L "${EXEC_URL}?action=ping")
echo "$PING"
if echo "$PING" | grep -q "$EXPECT_VER"; then
  echo "✅ 本番が ${EXPECT_VER} になりました。裏側の修正が反映済みです。"
else
  echo "⚠️  まだ古いバージョンが返っています（キャッシュの可能性）。1〜2分後にこのURLを再確認:"
  echo "    ${EXEC_URL}?action=ping"
fi

echo ""
echo "================================================================"
echo " STEP 4  3倍課金の重複行クリーンアップ（まず集計だけ）"
echo "================================================================"
echo "→ 重複注文行を集計（削除はまだしません）..."
curl -s -L "${EXEC_URL}?action=diag_dedupe_orders"
echo ""
echo ""
echo "↑ duplicates の件数を確認してください。"
echo "   削除して良ければ、次の1行を実行（実削除します）:"
echo "   curl -s -L \"${EXEC_URL}?action=diag_dedupe_orders&apply=1\""
echo ""
echo "================================================================"
echo " 完了。残りは LINE コンソールの手作業（TOM_やることリスト.md 参照）"
echo "================================================================"
