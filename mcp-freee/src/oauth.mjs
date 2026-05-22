#!/usr/bin/env node
// freee OAuth2 認可コード → リフレッシュトークン保存 ヘルパー
//
// 使い方:
//   1. mcp-freee/.env に FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI を入れる
//   2. このスクリプトを起動: `npm run auth`
//   3. 表示された URL をブラウザで開き、freee にログイン → アプリ連携を許可
//   4. リダイレクト先に表示される `code=...` の値を貼り付ける
//   5. .freee-tokens.json が生成される
//
// redirect_uri に urn:ietf:wg:oauth:2.0:oob を使うと、code がブラウザ上に直接表示されます。

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { saveTokens, tokenFilePath } from "./tokenStore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotenv(resolve(HERE, "..", ".env"));

const AUTH_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";

const clientId = process.env.FREEE_CLIENT_ID;
const clientSecret = process.env.FREEE_CLIENT_SECRET;
const redirectUri =
  process.env.FREEE_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";

if (!clientId || !clientSecret) {
  console.error("FREEE_CLIENT_ID / FREEE_CLIENT_SECRET が未設定です。mcp-freee/.env を確認してください。");
  process.exit(1);
}

const authorizeUrl = new URL(AUTH_URL);
authorizeUrl.searchParams.set("client_id", clientId);
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("response_type", "code");

console.log("\n=== freee OAuth 認可フロー ===");
console.log("以下の URL をブラウザで開いて、アプリ連携を許可してください。\n");
console.log(authorizeUrl.toString());
console.log("");

const rl = createInterface({ input: stdin, output: stdout });
const code = (await rl.question("リダイレクト先に表示された認可コード(code): ")).trim();
rl.close();

if (!code) {
  console.error("認可コードが空でした。中断します。");
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: clientId,
  client_secret: clientSecret,
  code,
  redirect_uri: redirectUri,
});

const res = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});

const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("トークン取得に失敗しました:", res.status, JSON.stringify(json));
  process.exit(1);
}

const saved = await saveTokens({ ...json, obtained_at: Math.floor(Date.now() / 1000) });
console.log("\nOK. 保存先:", tokenFilePath());
console.log("有効期限(秒):", saved.expires_in, "/ scope:", saved.scope ?? "(none)");

function loadDotenv(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
