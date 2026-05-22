import { loadTokens, saveTokens } from "./tokenStore.mjs";

const API_BASE = "https://api.freee.co.jp";
const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";

const EARLY_REFRESH_SEC = 60;

export class FreeeApiError extends Error {
  constructor(status, body, endpoint) {
    const message =
      status === 403
        ? `freee API 403 Forbidden (${endpoint}). 取引先補助権限「従業員として利用する取引先」の不足、または事業所に対する権限不足が原因の可能性があります。2026/07 以降の権限制御強化（partners 系 API）に該当しないかも確認してください。`
        : `freee API ${status} on ${endpoint}: ${stringifyBody(body)}`;
    super(message);
    this.name = "FreeeApiError";
    this.status = status;
    this.body = body;
    this.endpoint = endpoint;
  }
}

function stringifyBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

let cachedTokens = null;

async function ensureTokens() {
  if (!cachedTokens) cachedTokens = await loadTokens();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = (cachedTokens.obtained_at ?? 0) + (cachedTokens.expires_in ?? 0);
  if (!cachedTokens.access_token || expiresAt - EARLY_REFRESH_SEC <= now) {
    cachedTokens = await refreshTokens(cachedTokens);
  }
  return cachedTokens;
}

async function refreshTokens(prev) {
  const clientId = process.env.FREEE_CLIENT_ID;
  const clientSecret = process.env.FREEE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "FREEE_CLIENT_ID / FREEE_CLIENT_SECRET が未設定です。mcp-freee/.env または MCP の env 設定を確認してください。",
    );
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: prev.refresh_token,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `freee トークン更新失敗 (${res.status}): ${stringifyBody(json)}`,
    );
  }
  return await saveTokens({
    ...json,
    obtained_at: Math.floor(Date.now() / 1000),
  });
}

function buildUrl(path, query) {
  const url = new URL(path.startsWith("http") ? path : API_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((vv) => url.searchParams.append(k, vv));
      else url.searchParams.set(k, String(v));
    }
  }
  return url;
}

export async function freeeFetch(method, path, { query, body, retryOn401 = true } = {}) {
  const tokens = await ensureTokens();
  const url = buildUrl(path, query);
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    Accept: "application/json",
    "X-Api-Version": "2020-06-15",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && retryOn401) {
    cachedTokens = await refreshTokens(cachedTokens ?? (await loadTokens()));
    return freeeFetch(method, path, { query, body, retryOn401: false });
  }

  const text = await res.text();
  const parsed = text ? safeJson(text) : null;

  if (res.status === 403) {
    throw new FreeeApiError(403, parsed ?? text, `${method} ${url.pathname}`);
  }
  if (!res.ok) {
    throw new FreeeApiError(res.status, parsed ?? text, `${method} ${url.pathname}`);
  }
  return parsed ?? text;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function resolveCompanyId(explicit) {
  const cid = explicit ?? process.env.FREEE_COMPANY_ID;
  if (!cid) {
    throw new Error(
      "company_id が必要です。引数で渡すか、mcp-freee/.env の FREEE_COMPANY_ID を設定してください。`freee_companies_list` で取得できます。",
    );
  }
  return Number(cid);
}
