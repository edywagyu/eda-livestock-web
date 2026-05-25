#!/bin/bash
# Tom の事故再発防止フックを有効化するスクリプト
# 使い方: bash setup-safety-hooks.sh
#
# Clone 直後の人 + Tom 自身が 1 回だけ実行すれば、
# このリポジトリでの危険な commit を git が自動で警告するようになります。

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
GIT_DIR="$(git rev-parse --git-dir)"  # worktree でも正しく解決される
SRC="$REPO_ROOT/.git-hooks/pre-commit"
DST="$GIT_DIR/hooks/pre-commit"
mkdir -p "$GIT_DIR/hooks"

if [ ! -f "$SRC" ]; then
  echo "❌ $SRC が存在しません。先にこのリポジトリの最新を pull してください。"
  exit 1
fi

cp "$SRC" "$DST"
chmod +x "$DST"

echo "✅ pre-commit hook 設置完了"
echo "   今後、以下を検知して commit を中断します:"
echo "   1. scripts/build.py の再追加"
echo "   2. ROOT HTML から 500行以上の削除"
echo "   3. 「四代目」表記の混入"
echo ""
echo "詳細は CLAUDE.md を参照"
