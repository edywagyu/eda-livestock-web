#!/usr/bin/env node
// freee OAuth2 認可コード → リフレッシュトークン保存 ヘルパー
//
// 使い方:
//   1. mcp-freee/.env に FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI を入れる
//   2. `npm run auth` を起動
//   3. 表示された URL をブラウザで開き、freee にログイン → アプリ連携を許可
//
// FREEE_REDIRECT_URI に応じて以下の 2 モードを自動で切り替えます:
//   - urn:ietf:wg:oauth:2.0:oob → ブラウザ上に表示された code を CLI に貼り付ける
//   - http://localhost:PORT/... → そのポートで一時 HTTP サーバを立て、code を自動受信

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
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

const localCallback = parseLocalCallback(redirectUri);
const code = localCallback ? await waitForLocalCode(localCallback) : await askCodeFromStdin();

if (!code) {
  console.error("認可コードが取得できませんでした。中断します。");
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
console.log("動作確認: `npm run check` で freee API への接続を試せます。");

async function askCodeFromStdin() {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question("リダイレクト先に表示された認可コード(code): ")).trim();
  rl.close();
  return answer;
}

function parseLocalCallback(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return null;
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host, port, pathname: u.pathname || "/" };
  } catch {
    return null;
  }
}

async function waitForLocalCode({ host, port, pathname }) {
  console.log(`http://${host}:${port}${pathname} で認可コードを待機します...`);
  return await new Promise((resolveCode, rejectCode) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== pathname) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`freee 認可エラー: ${error}`);
        server.close();
        rejectCode(new Error(`freee authorize error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("code パラメータがありません");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<html><body><h2>OK</h2><p>認可コードを受信しました。CLI に戻ってください。</p></body></html>",
      );
      server.close();
      resolveCode(code);
    });
    server.on("error", rejectCode);
    server.listen(port, host);
  });
}

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
