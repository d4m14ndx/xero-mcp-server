import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BankTransaction } from "xero-node";
import { getXeroClient, tenantId } from "../client.js";
import {
  LineItemSchema,
  PaginationSchema,
  ResponseFormatSchema,
  ResponseFormat,
  compact,
  formatError,
  formatMoney,
  jsonResult,
  markdownResult,
  toXeroLineItem,
} from "../common.js";

const BANK_TXN_TYPES = ["RECEIVE", "SPEND"] as const;

export function registerBankTools(server: McpServer) {
  server.registerTool(
    "xero_list_bank_transactions",
    {
      title: "List Bank Transactions",
      description: `List spend-money / receive-money bank transactions. These are direct money movements NOT tied to an invoice (for invoice-linked payments use xero_list_payments).

Use this to see what's been reconciled or created against a bank account. Filter with a where clause like 'BankAccount.AccountID==guid("<uuid>")' to scope to one bank account.`,
      inputSchema: {
        where: z.string().optional().describe("Raw Xero WHERE clause"),
        order: z.string().optional().describe("Raw Xero ORDER clause"),
        modified_since: z.string().datetime().optional(),
        ...PaginationSchema,
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ where, order, modified_since, page, page_size, response_format }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getBankTransactions(
          tenantId(),
          modified_since ? new Date(modified_since) : undefined,
          where,
          order,
          page,
          undefined,
          page_size,
        );
        const txns = res.body.bankTransactions ?? [];
        const data = {
          page,
          count: txns.length,
          transactions: txns.map((t) => ({
            bank_transaction_id: t.bankTransactionID,
            type: t.type,
            status: t.status,
            is_reconciled: t.isReconciled,
            date: t.date,
            reference: t.reference,
            contact: t.contact?.name,
            bank_account: t.bankAccount?.name ?? t.bankAccount?.accountID,
            total: t.total,
            currency: t.currencyCode,
          })),
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [
          `# Bank Transactions (page ${page}, ${txns.length} items)`,
          "",
        ];
        for (const t of txns) {
          lines.push(
            `- ${t.date}  **${t.type}**  ${formatMoney(t.total, t.currencyCode as string | undefined)}  ${t.contact?.name ?? "—"}  [${t.isReconciled ? "reconciled" : "unreconciled"}]${t.reference ? `  ref: ${t.reference}` : ""}`,
          );
        }
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_create_bank_transaction",
    {
      title: "Create a Spend/Receive Money Bank Transaction",
      description: `Create a direct bank transaction — spend money (SPEND) or receive money (RECEIVE) not tied to an invoice. This is how you record ad-hoc bank feed items like bank fees, interest, owner draws, or miscellaneous income.

Required: type (SPEND or RECEIVE), bank_account_id, line_items (at least one), contact_id.

To then reconcile this against a real bank-feed statement line, use the Xero web UI or set is_reconciled=true if you've already confirmed the match.`,
      inputSchema: {
        type: z
          .enum(BANK_TXN_TYPES)
          .describe("SPEND = money leaving the bank, RECEIVE = money into the bank"),
        bank_account_id: z
          .string()
          .uuid()
          .describe(
            "UUID of the bank account. Use xero_list_accounts with type='BANK' to find.",
          ),
        contact_id: z
          .string()
          .uuid()
          .describe("Xero contact UUID (who you paid or received from)"),
        line_items: z.array(LineItemSchema).min(1),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Transaction date YYYY-MM-DD (defaults to today)"),
        reference: z.string().optional(),
        is_reconciled: z
          .boolean()
          .optional()
          .describe("Mark as reconciled in Xero immediately"),
        line_amount_type: z
          .enum(["Exclusive", "Inclusive", "NoTax"])
          .default("Exclusive"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await getXeroClient();
        const txn: BankTransaction = compact({
          type: params.type as unknown as BankTransaction.TypeEnum,
          contact: { contactID: params.contact_id },
          bankAccount: { accountID: params.bank_account_id },
          lineItems: params.line_items.map(toXeroLineItem),
          date: params.date,
          reference: params.reference,
          isReconciled: params.is_reconciled,
          lineAmountTypes:
            params.line_amount_type as unknown as BankTransaction["lineAmountTypes"],
        }) as BankTransaction;
        const res = await client.accountingApi.createBankTransactions(tenantId(), {
          bankTransactions: [txn],
        });
        return jsonResult({ created: res.body.bankTransactions?.[0] ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_mark_bank_transaction_reconciled",
    {
      title: "Mark a Bank Transaction as Reconciled",
      description: `Flip an existing bank transaction's is_reconciled flag to true (or false). Use after confirming a transaction matches a real bank-feed statement line.

Note: Xero's full bank-reconciliation UI (matching statement-line to transaction) is not fully exposed via the public API — most sophisticated reconciliation requires the Xero web app. This tool handles the common case of confirming reconciliation on an existing spend/receive transaction.`,
      inputSchema: {
        bank_transaction_id: z.string().uuid(),
        is_reconciled: z
          .boolean()
          .default(true)
          .describe("true to mark reconciled, false to unreconcile"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ bank_transaction_id, is_reconciled }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.updateBankTransaction(
          tenantId(),
          bank_transaction_id,
          {
            bankTransactions: [
              { isReconciled: is_reconciled } as unknown as BankTransaction,
            ],
          },
        );
        return jsonResult({ updated: res.body.bankTransactions?.[0] ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
