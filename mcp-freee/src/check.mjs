#!/usr/bin/env node
// 接続スモークテスト。GET /api/1/companies を叩いて、
// 認証情報・リフレッシュトークン・通信経路に問題が無いことを確認する。
//
//   cd mcp-freee && npm run check

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotenv(resolve(HERE, "..", ".env"));

const { freeeFetch, FreeeApiError } = await import("./freeeClient.mjs");

try {
  const res = await freeeFetch("GET", "/api/1/companies");
  const companies = Array.isArray(res?.companies) ? res.companies : [];
  console.log("OK. freee API への接続に成功しました。");
  console.log(`事業所数: ${companies.length}`);
  for (const c of companies) {
    console.log(`  - id=${c.id}  ${c.display_name ?? c.name ?? "(no name)"}`);
  }
  if (!process.env.FREEE_COMPANY_ID && companies.length === 1) {
    console.log(
      `\nヒント: mcp-freee/.env に FREEE_COMPANY_ID=${companies[0].id} を追加すると、` +
        `各ツール呼び出しで company_id 引数を省略できます。`,
    );
  }
} catch (err) {
  if (err instanceof FreeeApiError) {
    console.error(`NG. freee API エラー (${err.status}):`);
    console.error(err.message);
  } else {
    console.error("NG. 接続に失敗しました:");
    console.error(err.message ?? err);
  }
  process.exit(1);
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
