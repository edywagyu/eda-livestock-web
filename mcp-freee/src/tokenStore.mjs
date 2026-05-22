import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(HERE, "..", ".freee-tokens.json");

export function tokenFilePath() {
  return process.env.FREEE_TOKEN_FILE
    ? resolve(process.env.FREEE_TOKEN_FILE)
    : DEFAULT_PATH;
}

export async function loadTokens() {
  const path = tokenFilePath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.refresh_token) {
      throw new Error(`refresh_token missing in ${path}`);
    }
    return parsed;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `freee token file not found at ${path}. Run \`npm run auth\` in mcp-freee/ first.`,
      );
    }
    throw err;
  }
}

export async function saveTokens(tokens) {
  const path = tokenFilePath();
  await mkdir(dirname(path), { recursive: true });
  const payload = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_in: tokens.expires_in,
    obtained_at: tokens.obtained_at ?? Math.floor(Date.now() / 1000),
    token_type: tokens.token_type ?? "bearer",
    scope: tokens.scope,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return payload;
}
