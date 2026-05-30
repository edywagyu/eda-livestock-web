#!/usr/bin/env python3
"""
江田畜産 LINE リッチメニュー v3 登録スクリプト（6ボタン・父の日対応）
--------------------------------------------------------------
使い方:
  export LINE_CHANNEL_ACCESS_TOKEN="YOUR_TOKEN_HERE"
  python3 setup_richmenu_v3.py

動作:
  1. リッチメニュー定義を作成 (6分割: 単品/定期便/クーポン/マイページ/配送/父の日)
  2. 画像 richmenu_v3.png をアップロード (2500x1686)
  3. デフォルトリッチメニューに設定

全ボタンは LIFF 経由 (LINEログイン引き継ぎ)。
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
SITE = 'https://www.eda-livestock.com'   # 本番 canonical（www）。apex は 301 で www へ転送される
LIFF_ID = '1657458587-mz1dR9e6'          # LIFF アプリ ID（Endpoint URL = SITE に設定）
IMAGE_PATH = os.path.join(os.path.dirname(__file__), 'richmenu_v3.png')

def url(path):
    """通常 Web URL (直リンク)"""
    return f'{SITE}/{path}'

def liff_url(path):
    """LIFF URL（LINE ログイン引き継ぎ・会員価格/自動ログイン）。
    GAS ボット・領収書メールと同じ形式。LINE が Endpoint URL(=SITE) に解決する。
    🔴 前提: LINE Developers Console の LIFF Endpoint URL を canonical www
       (https://www.eda-livestock.com) に設定しておくこと。apex のままだと 301 転送で
       LINE OAuth が redirect_uri を弾き 400「リクエストを処理できません」になる。"""
    return f'https://liff.line.me/{LIFF_ID}/{path}'

def api_call(method, path, data=None):
    url = f'{API}/{path}'
    headers = {'Authorization': f'Bearer {TOKEN}'}
    body = None
    if data is not None:
        headers['Content-Type'] = 'application/json'
        body = json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"❌ API Error {e.code}: {e.read().decode()}")
        sys.exit(1)

# ============================================================
# Step 1: リッチメニュー定義（6分割 2500x1686）
#   列幅: 833 / 834 / 833   行高: 843 / 843
# ============================================================
print("📋 Step 1: リッチメニュー定義を作成 (6ボタン)...")

W, H = 2500, 1686
C1, C2, C3 = 833, 834, 833           # 列幅
RH = 843                              # 行高
X0, X1, X2 = 0, 833, 1667            # 列開始X
Y0, Y1 = 0, 843                       # 行開始Y

richmenu_def = {
    "size": {"width": W, "height": H},
    "selected": True,
    "name": "江田畜産 EC メニュー v3 (父の日)",
    "chatBarText": "メニュー",
    "areas": [
        # --- 上段: 買う・続ける・お得（全て LIFF＝LINEログイン引き継ぎ・会員価格） ---
        {"bounds": {"x": X0, "y": Y0, "width": C1, "height": RH},
         "action": {"type": "uri", "label": "単品注文", "uri": liff_url('shop.html')}},
        {"bounds": {"x": X1, "y": Y0, "width": C2, "height": RH},
         "action": {"type": "uri", "label": "定期便", "uri": liff_url('subscription.html')}},
        {"bounds": {"x": X2, "y": Y0, "width": C3, "height": RH},
         "action": {"type": "uri", "label": "クーポン", "uri": liff_url('mypage.html?tab=rewards')}},
        # --- 下段: 管理・確認・父の日 ---
        {"bounds": {"x": X0, "y": Y1, "width": C1, "height": RH},
         "action": {"type": "uri", "label": "マイページ", "uri": liff_url('mypage.html')}},
        {"bounds": {"x": X1, "y": Y1, "width": C2, "height": RH},
         "action": {"type": "uri", "label": "配送情報", "uri": liff_url('mypage.html?tab=orders')}},
        {"bounds": {"x": X2, "y": Y1, "width": C3, "height": RH},
         "action": {"type": "uri", "label": "父の日", "uri": liff_url('fathers-day.html')}},
    ]
}

result = api_call('POST', 'richmenu', richmenu_def)
richmenu_id = result.get('richMenuId')
print(f"   ✅ richMenuId: {richmenu_id}")

# ============================================================
# Step 2: 画像アップロード
# ============================================================
print("🖼️  Step 2: 画像をアップロード...")
if not os.path.exists(IMAGE_PATH):
    print(f"❌ 画像が見つかりません: {IMAGE_PATH}")
    sys.exit(1)

with open(IMAGE_PATH, 'rb') as f:
    image_data = f.read()

upload_url = f'https://api-data.line.me/v2/bot/richmenu/{richmenu_id}/content'
headers = {'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'image/png'}
req = urllib.request.Request(upload_url, data=image_data, headers=headers, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print(f"   ✅ 画像アップロード完了 ({len(image_data)/1024:.0f} KB)")
except urllib.error.HTTPError as e:
    print(f"❌ 画像アップロード失敗 {e.code}: {e.read().decode()}")
    sys.exit(1)

# ============================================================
# Step 3: デフォルトに設定
# ============================================================
print("⭐ Step 3: デフォルトリッチメニューに設定...")
default_url = f'{API}/user/all/richmenu/{richmenu_id}'
req = urllib.request.Request(default_url, data=b'',
                             headers={'Authorization': f'Bearer {TOKEN}'}, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print(f"   ✅ デフォルト設定完了")
except urllib.error.HTTPError as e:
    print(f"❌ デフォルト設定失敗 {e.code}: {e.read().decode()}")
    sys.exit(1)

print()
print("=" * 56)
print("🎉 リッチメニュー v3 (父の日) 設定完了!")
print(f"   richMenuId: {richmenu_id}")
print("   上段: 単品注文 / 定期便 / クーポン")
print("   下段: マイページ / 配送情報 / 父の日")
print("=" * 56)
