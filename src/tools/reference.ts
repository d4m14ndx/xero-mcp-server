import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getXeroClient, TENANT_ID } from "../client.js";
import {
  ResponseFormatSchema,
  ResponseFormat,
  formatError,
  jsonResult,
  markdownResult,
} from "../common.js";

const ACCOUNT_TYPES = [
  "BANK",
  "CURRENT",
  "CURRLIAB",
  "DEPRECIATN",
  "DIRECTCOSTS",
  "EQUITY",
  "EXPENSE",
  "FIXED",
  "INVENTORY",
  "LIABILITY",
  "NONCURRENT",
  "OTHERINCOME",
  "OVERHEADS",
  "PREPAYMENT",
  "REVENUE",
  "SALES",
  "TERMLIAB",
  "PAYG",
] as const;

export function registerReferenceTools(server: McpServer) {
  server.registerTool(
    "xero_list_accounts",
    {
      title: "List Chart of Accounts",
      description: `List accounts from the chart of accounts. Returns account codes, names, types, and tax types. Essential for creating invoices/bills — each line item needs an account_code from this list.

Filter by type='BANK' to get bank accounts (their account_id is what you pass to xero_create_payment).`,
      inputSchema: {
        type: z
          .enum(ACCOUNT_TYPES)
          .optional()
          .describe("Filter by account type (BANK, REVENUE, EXPENSE, etc.)"),
        where: z.string().optional(),
        order: z.string().optional(),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ type, where, order, response_format }) => {
      try {
        const client = await getXeroClient();
        const finalWhere = [type ? `Type=="${type}"` : null, where]
          .filter(Boolean)
          .join(" AND ");
        const res = await client.accountingApi.getAccounts(
          TENANT_ID,
          undefined,
          finalWhere || undefined,
          order,
        );
        const accounts = res.body.accounts ?? [];
        const data = {
          count: accounts.length,
          accounts: accounts.map((a) => ({
            account_id: a.accountID,
            code: a.code,
            name: a.name,
            type: a.type,
            tax_type: a.taxType,
            status: a.status,
            description: a.description,
            enable_payments_to_account: a.enablePaymentsToAccount,
            bank_account_number: a.bankAccountNumber,
            currency_code: a.currencyCode,
          })),
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [`# Accounts (${accounts.length})`, ""];
        for (const a of accounts) {
          lines.push(
            `- \`${a.code ?? "—"}\`  **${a.name}**  [${a.type}]  tax: ${a.taxType ?? "—"}  id: \`${a.accountID}\``,
          );
        }
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_list_tax_rates",
    {
      title: "List Tax Rates",
      description:
        "List tax rates configured for the organisation. The tax_type value (e.g. 'OUTPUT', 'INPUT2', 'NONE') is what you pass as tax_type on line items.",
      inputSchema: {
        where: z.string().optional(),
        order: z.string().optional(),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ where, order, response_format }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getTaxRates(TENANT_ID, where, order);
        const rates = res.body.taxRates ?? [];
        const data = {
          count: rates.length,
          tax_rates: rates.map((r) => ({
            name: r.name,
            tax_type: r.taxType,
            status: r.status,
            effective_rate: r.effectiveRate,
            display_tax_rate: r.displayTaxRate,
            report_tax_type: r.reportTaxType,
            can_apply_to_expenses: r.canApplyToExpenses,
            can_apply_to_revenue: r.canApplyToRevenue,
          })),
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [`# Tax Rates (${rates.length})`, ""];
        for (const r of rates) {
          lines.push(
            `- **${r.name}** — tax_type: \`${r.taxType}\`  rate: ${r.effectiveRate ?? r.displayTaxRate ?? "—"}%  [${r.status}]`,
          );
        }
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_get_organisation",
    {
      title: "Get Organisation Details",
      description:
        "Fetch the connected Xero organisation's metadata — name, legal name, base currency, country, financial year start, tax type, timezone. Call this once at the start of a session to understand the tenant context.",
      inputSchema: {
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getOrganisations(TENANT_ID);
        const org = res.body.organisations?.[0];
        if (!org) {
          return {
            content: [{ type: "text", text: "No organisation returned." }],
            isError: true,
          };
        }
        const data = {
          name: org.name,
          legal_name: org.legalName,
          short_code: org.shortCode,
          organisation_id: org.organisationID,
          country_code: org.countryCode,
          base_currency: org.baseCurrency,
          timezone: org.timezone,
          financial_year_end_month: org.financialYearEndMonth,
          financial_year_end_day: org.financialYearEndDay,
          tax_number: org.taxNumber,
          organisation_type: org.organisationType,
          organisation_status: org.organisationStatus,
          edition: org.edition,
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [
          `# ${org.name}`,
          "",
          `- **Legal name**: ${org.legalName ?? "—"}`,
          `- **Country**: ${org.countryCode}`,
          `- **Base currency**: ${org.baseCurrency}`,
          `- **Timezone**: ${org.timezone}`,
          `- **Financial year end**: ${org.financialYearEndDay}/${org.financialYearEndMonth}`,
          `- **Edition**: ${org.edition}`,
          `- **Status**: ${org.organisationStatus}`,
        ];
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
