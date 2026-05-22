#!/usr/bin/env python3
"""
江田畜産 LINE リッチメニュー v2 登録スクリプト
----------------------------------------------
使い方:
  export LINE_CHANNEL_ACCESS_TOKEN="YOUR_TOKEN_HERE"
  python3 setup_richmenu_v2.py

動作:
  1. リッチメニュー定義を作成 (2分割: A注文する / B会員ページ)
  2. 画像をアップロード
  3. デフォルトリッチメニューに設定
"""
import json
import os
import sys
import urllib.request
import urllib.error

TOKEN = os.environ.get('LINE_CHANNEL_ACCESS_TOKEN', '')
if not TOKEN:
    print("❌ LINE_CHANNEL_ACCESS_TOKEN を環境変数にセットしてください")
    print("   export LINE_CHANNEL_ACCESS_TOKEN='YOUR_TOKEN'")
    sys.exit(1)

API = 'https://api.line.me/v2/bot'
LIFF_ID = '1657458587-mz1dR9e6'
IMAGE_PATH = os.path.join(os.path.dirname(__file__), 'richmenu_v2.png')

def api_call(method, path, data=None, content_type='application/json'):
    """LINE Messaging API 呼び出し"""
    url = f'{API}/{path}'
    headers = {'Authorization': f'Bearer {TOKEN}'}

    if data and content_type == 'application/json':
        headers['Content-Type'] = 'application/json'
        body = json.dumps(data).encode()
    elif data:
        headers['Content-Type'] = content_type
        body = data
    else:
        body = None

    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()
        print(f"❌ API Error {e.code}: {err_body}")
        sys.exit(1)

# ============================================================
# Step 1: リッチメニュー定義を作成
# ============================================================
print("📋 Step 1: リッチメニュー定義を作成...")

richmenu_def = {
    "size": {"width": 2500, "height": 843},
    "selected": True,
    "name": "江田畜産 EC メニュー v2",
    "chatBarText": "メニュー",
    "areas": [
        {
            # A: 注文する (左半分)
            "bounds": {"x": 0, "y": 0, "width": 1250, "height": 843},
            "action": {
                "type": "uri",
                "label": "注文する",
                "uri": f"https://liff.line.me/{LIFF_ID}?page=shop"
            }
        },
        {
            # B: 会員ページ (右半分)
            "bounds": {"x": 1250, "y": 0, "width": 1250, "height": 843},
            "action": {
                "type": "uri",
                "label": "会員ページ",
                "uri": f"https://liff.line.me/{LIFF_ID}"
            }
        }
    ]
}

result = api_call('POST', 'richmenu', richmenu_def)
richmenu_id = result.get('richMenuId')
print(f"   ✅ richMenuId: {richmenu_id}")

# ============================================================
# Step 2: 画像をアップロード
# ============================================================
print("🖼️  Step 2: リッチメニュー画像をアップロード...")

if not os.path.exists(IMAGE_PATH):
    print(f"❌ 画像が見つかりません: {IMAGE_PATH}")
    print("   先に python3 create_richmenu_v2.py を実行してください")
    sys.exit(1)

with open(IMAGE_PATH, 'rb') as f:
    image_data = f.read()

# 画像アップロードは別エンドポイント
upload_url = f'https://api-data.line.me/v2/bot/richmenu/{richmenu_id}/content'
headers = {
    'Authorization': f'Bearer {TOKEN}',
    'Content-Type': 'image/png'
}
req = urllib.request.Request(upload_url, data=image_data, headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print(f"   ✅ 画像アップロード完了 ({len(image_data) / 1024:.0f} KB)")
except urllib.error.HTTPError as e:
    err_body = e.read().decode()
    print(f"❌ 画像アップロード失敗 {e.code}: {err_body}")
    sys.exit(1)

# ============================================================
# Step 3: デフォルトリッチメニューに設定
# ============================================================
print("⭐ Step 3: デフォルトリッチメニューに設定...")

default_url = f'{API}/user/all/richmenu/{richmenu_id}'
headers = {'Authorization': f'Bearer {TOKEN}'}
req = urllib.request.Request(default_url, data=b'', headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print(f"   ✅ デフォルトリッチメニュー設定完了")
except urllib.error.HTTPError as e:
    err_body = e.read().decode()
    print(f"❌ デフォルト設定失敗 {e.code}: {err_body}")
    sys.exit(1)

print()
print("=" * 50)
print("🎉 リッチメニュー v2 設定完了!")
print(f"   richMenuId: {richmenu_id}")
print(f"   A (左): 注文する → LIFF → shop.html (会員状態)")
print(f"   B (右): 会員ページ → LIFF → mypage.html")
print("=" * 50)
