import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Payment } from "xero-node";
import { getXeroClient, tenantId } from "../client.js";
import {
  compact,
  formatError,
  jsonResult,
  ResponseFormatSchema,
  ResponseFormat,
  markdownResult,
  formatMoney,
} from "../common.js";

export function registerPaymentTools(server: McpServer) {
  server.registerTool(
    "xero_create_payment",
    {
      title: "Record a Payment Against an Invoice or Bill",
      description: `Record a payment applying money to an existing AR invoice (ACCREC) or AP bill (ACCPAY).

The payment will appear as already-applied in Xero against the target invoice, reducing amount_due. If the bank_account matches a real bank account, the payment will also appear as a transaction ready to reconcile against a real bank statement line.

Required: invoice_id, account_id (the bank/cash account the money moved through), amount, date.`,
      inputSchema: {
        invoice_id: z.string().uuid().describe("UUID of the invoice or bill being paid"),
        account_id: z
          .string()
          .uuid()
          .describe(
            "UUID of the bank/cash account the money moved through. Use xero_list_accounts with type='BANK'.",
          ),
        amount: z.number().positive().describe("Amount of the payment"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Date of payment YYYY-MM-DD"),
        reference: z
          .string()
          .optional()
          .describe("Payment reference (shown on bank rec and remittance)"),
        is_reconciled: z
          .boolean()
          .optional()
          .describe(
            "Mark as reconciled immediately (bypasses bank rec screen). Use carefully.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ invoice_id, account_id, amount, date, reference, is_reconciled }) => {
      try {
        const client = await getXeroClient();
        const payment: Payment = compact({
          invoice: { invoiceID: invoice_id },
          account: { accountID: account_id },
          amount,
          date,
          reference,
          isReconciled: is_reconciled,
        }) as Payment;
        const res = await client.accountingApi.createPayments(tenantId(), {
          payments: [payment],
        });
        return jsonResult({ created: res.body.payments?.[0] ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_list_payments",
    {
      title: "List Xero Payments",
      description:
        "List payments with optional filters. Payments are records applying money to invoices, bills, credit notes, or over/prepayments.",
      inputSchema: {
        where: z.string().optional().describe("Raw Xero WHERE clause"),
        order: z.string().optional().describe("Raw Xero ORDER clause"),
        modified_since: z.string().datetime().optional(),
        page: z.number().int().min(1).default(1),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ where, order, modified_since, page, response_format }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getPayments(
          tenantId(),
          modified_since ? new Date(modified_since) : undefined,
          where,
          order,
          page,
        );
        const payments = res.body.payments ?? [];
        const data = {
          page,
          count: payments.length,
          payments: payments.map((p) => ({
            payment_id: p.paymentID,
            invoice_number: p.invoice?.invoiceNumber,
            invoice_id: p.invoice?.invoiceID,
            account_code: p.account?.code,
            amount: p.amount,
            currency_rate: p.currencyRate,
            date: p.date,
            reference: p.reference,
            status: p.status,
            is_reconciled: p.isReconciled,
          })),
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [`# Payments (page ${page}, ${payments.length} items)`, ""];
        for (const p of payments) {
          lines.push(
            `- ${p.date}  ${formatMoney(p.amount)}  ${p.invoice?.invoiceNumber ?? "(no invoice)"}  [${p.status}]${p.reference ? `  ref: ${p.reference}` : ""}`,
          );
        }
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
