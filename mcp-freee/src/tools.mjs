import { freeeFetch, FreeeApiError, resolveCompanyId } from "./freeeClient.mjs";

// Claude Code 側に公開する MCP ツール定義。
// 2026/07 の権限制御強化に備え、partners 系は 403 を明示的にハンドリングする。
//
// 参考: https://developer.freee.co.jp/reference/accounting/reference

export const tools = [
  {
    name: "freee_companies_list",
    description: "freee 事業所の一覧を取得します。初回セットアップ時に company_id を調べる用途。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => freeeFetch("GET", "/api/1/companies"),
  },

  {
    name: "freee_partners_list",
    description:
      "取引先一覧を取得します (GET /api/1/partners)。2026/07 以降は補助権限が無い取引先は応答から除外されます。total_count と返却件数の差分があればその旨もレスポンスに含めます。",
    inputSchema: {
      type: "object",
      properties: {
        company_id: { type: ["integer", "string"], description: "事業所 ID" },
        offset: { type: "integer" },
        limit: { type: "integer", maximum: 3000 },
        keyword: { type: "string" },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      const data = await freeeFetch("GET", "/api/1/partners", {
        query: { company_id, offset: args.offset, limit: args.limit, keyword: args.keyword },
      });
      const note =
        data && typeof data === "object" && Array.isArray(data.partners)
          ? buildPartnersListNote(data)
          : null;
      return note ? { ...data, _note: note } : data;
    },
  },

  {
    name: "freee_partner_get",
    description:
      "取引先を ID 指定で取得 (GET /api/1/partners/{id})。権限が無い場合は 403 となります。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["integer", "string"], description: "取引先 ID" },
        company_id: { type: ["integer", "string"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      return freeeFetch("GET", `/api/1/partners/${encodeURIComponent(args.id)}`, {
        query: { company_id },
      });
    },
  },

  {
    name: "freee_partner_create",
    description: "取引先を新規作成 (POST /api/1/partners)。",
    inputSchema: {
      type: "object",
      properties: {
        company_id: { type: ["integer", "string"] },
        partner: {
          type: "object",
          description:
            "freee API の partner 更新 body。最低 `name` は必須。code/shortcut1/shortcut2/長期、振込先口座などを任意で指定。",
          additionalProperties: true,
        },
      },
      required: ["partner"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      return freeeFetch("POST", "/api/1/partners", {
        body: { company_id, ...args.partner },
      });
    },
  },

  {
    name: "freee_partner_update",
    description:
      "取引先を ID 指定で更新 (PUT /api/1/partners/{id})。権限が無い場合は 403 となります。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["integer", "string"] },
        company_id: { type: ["integer", "string"] },
        partner: { type: "object", additionalProperties: true },
      },
      required: ["id", "partner"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      return freeeFetch("PUT", `/api/1/partners/${encodeURIComponent(args.id)}`, {
        body: { company_id, ...args.partner },
      });
    },
  },

  {
    name: "freee_partner_update_by_code",
    description:
      "取引先コードで取引先を更新 (PUT /api/1/partners/code/{code})。権限が無い場合は 403 となります。",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        company_id: { type: ["integer", "string"] },
        partner: { type: "object", additionalProperties: true },
      },
      required: ["code", "partner"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      return freeeFetch(
        "PUT",
        `/api/1/partners/code/${encodeURIComponent(args.code)}`,
        { body: { company_id, ...args.partner } },
      );
    },
  },

  {
    name: "freee_partner_upsert_by_code",
    description:
      "取引先コードで upsert (PUT /api/1/partners/upsert_by_code)。存在しなければ作成、あれば更新。権限が無い場合は 403。",
    inputSchema: {
      type: "object",
      properties: {
        company_id: { type: ["integer", "string"] },
        partner: {
          type: "object",
          description: "code を含めた更新ボディ",
          additionalProperties: true,
        },
      },
      required: ["partner"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      return freeeFetch("PUT", "/api/1/partners/upsert_by_code", {
        body: { company_id, ...args.partner },
      });
    },
  },

  {
    name: "freee_partner_delete",
    description:
      "取引先を ID 指定で削除 (DELETE /api/1/partners/{id})。権限が無い場合は 403 となります。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: ["integer", "string"] },
        company_id: { type: ["integer", "string"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const company_id = resolveCompanyId(args.company_id);
      return freeeFetch("DELETE", `/api/1/partners/${encodeURIComponent(args.id)}`, {
        query: { company_id },
      });
    },
  },

  {
    name: "freee_request",
    description:
      "任意の freee API エンドポイントを叩く汎用ツール。partners 以外（deals, invoices, items など）が必要な時に使用。レスポンス本文はそのまま返ります。",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
        path: { type: "string", description: "/api/1/... 形式" },
        query: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true },
      },
      required: ["method", "path"],
      additionalProperties: false,
    },
    handler: async (args) =>
      freeeFetch(args.method, args.path, { query: args.query, body: args.body }),
  },
];

function buildPartnersListNote(data) {
  // 2026/07 仕様変更で、権限が無い取引先は応答から除外される。
  // total_count があり、partners 配列より大きい場合は注意喚起のメッセージを付与。
  if (
    typeof data.total_count === "number" &&
    Array.isArray(data.partners) &&
    data.total_count > data.partners.length
  ) {
    return `total_count=${data.total_count} に対して partners=${data.partners.length} 件のみ返却されました。「従業員として利用する取引先」補助権限など、権限不足で一部が除外されている可能性があります (2026/07 freee API 仕様変更)。`;
  }
  return null;
}

export { FreeeApiError };
