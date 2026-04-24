import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Invoice } from "xero-node";
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

const INVOICE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "AUTHORISED",
  "PAID",
  "VOIDED",
  "DELETED",
] as const;

type InvoiceDoc = "ACCREC" | "ACCPAY";

function invoiceSummary(inv: Invoice) {
  return {
    invoice_id: inv.invoiceID,
    invoice_number: inv.invoiceNumber,
    type: inv.type,
    status: inv.status,
    contact: inv.contact?.name ?? inv.contact?.contactID,
    date: inv.date,
    due_date: inv.dueDate,
    reference: inv.reference,
    currency: inv.currencyCode,
    sub_total: inv.subTotal,
    total_tax: inv.totalTax,
    total: inv.total,
    amount_due: inv.amountDue,
    amount_paid: inv.amountPaid,
  };
}

function invoicesMarkdown(
  kind: "Invoices" | "Bills",
  invoices: Invoice[],
  page: number,
): string {
  if (!invoices.length) return `No ${kind.toLowerCase()} found on page ${page}.`;
  const lines = [`# ${kind} (page ${page}, ${invoices.length} items)`, ""];
  for (const inv of invoices) {
    lines.push(
      `## ${inv.invoiceNumber ?? "(no number)"} — ${inv.contact?.name ?? "(no contact)"}`,
    );
    lines.push(`- **ID**: ${inv.invoiceID}`);
    lines.push(`- **Status**: ${inv.status}`);
    lines.push(`- **Date**: ${inv.date}  **Due**: ${inv.dueDate ?? "—"}`);
    lines.push(
      `- **Total**: ${formatMoney(inv.total, inv.currencyCode as string | undefined)}  **Due**: ${formatMoney(inv.amountDue)}  **Paid**: ${formatMoney(inv.amountPaid)}`,
    );
    if (inv.reference) lines.push(`- **Reference**: ${inv.reference}`);
    lines.push("");
  }
  return lines.join("\n");
}

const ListSchema = z
  .object({
    statuses: z
      .array(z.enum(INVOICE_STATUSES))
      .optional()
      .describe("Filter by status (DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED)"),
    contact_ids: z
      .array(z.string().uuid())
      .optional()
      .describe("Filter to specific contact UUIDs"),
    invoice_numbers: z
      .array(z.string())
      .optional()
      .describe("Filter to specific invoice numbers (e.g. ['INV-0001'])"),
    modified_since: z
      .string()
      .datetime()
      .optional()
      .describe("ISO 8601 datetime — only return invoices modified after this"),
    where: z
      .string()
      .optional()
      .describe(
        "Raw Xero WHERE clause (e.g. \"Status==\\\"AUTHORISED\\\" AND Date>=DateTime(2025,01,01)\")",
      ),
    order: z
      .string()
      .optional()
      .describe("Raw Xero ORDER clause (e.g. 'Date DESC')"),
    ...PaginationSchema,
    response_format: ResponseFormatSchema,
  })
  .strict();

const LineItemsSchema = z
  .array(LineItemSchema)
  .min(1)
  .describe("At least one line item describing what is being invoiced");

const CreateInvoiceSchema = z
  .object({
    contact_id: z
      .string()
      .uuid()
      .describe("Xero contact UUID. Use xero_search_contacts or xero_create_contact to get one."),
    line_items: LineItemsSchema,
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Invoice issue date YYYY-MM-DD (defaults to today)"),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Payment due date YYYY-MM-DD"),
    invoice_number: z
      .string()
      .optional()
      .describe("Override invoice number (otherwise Xero auto-generates)"),
    reference: z.string().optional().describe("Customer-facing reference"),
    status: z
      .enum(["DRAFT", "SUBMITTED", "AUTHORISED"])
      .default("DRAFT")
      .describe(
        "Initial status. DRAFT = editable, AUTHORISED = approved and sendable. Default DRAFT for safety.",
      ),
    line_amount_type: z
      .enum(["Exclusive", "Inclusive", "NoTax"])
      .default("Exclusive")
      .describe("Whether unit_amount figures include tax, exclude tax, or have no tax"),
    currency_code: z
      .string()
      .length(3)
      .optional()
      .describe("ISO currency code. Defaults to org base currency."),
    branding_theme_id: z.string().uuid().optional(),
  })
  .strict();

const CreateBillSchema = CreateInvoiceSchema.extend({
  planned_payment_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Planned date to pay the bill YYYY-MM-DD"),
  // Bills do not accept invoice_number override normally but Xero allows it.
}).strict();

function buildInvoicePayload(
  docType: InvoiceDoc,
  params: z.infer<typeof CreateInvoiceSchema> & { planned_payment_date?: string },
): Invoice {
  return compact({
    type: docType as unknown as Invoice.TypeEnum,
    contact: { contactID: params.contact_id },
    lineItems: params.line_items.map(toXeroLineItem),
    date: params.date,
    dueDate: params.due_date,
    invoiceNumber: params.invoice_number,
    reference: params.reference,
    status: params.status as unknown as Invoice.StatusEnum,
    lineAmountTypes: params.line_amount_type as unknown as Invoice["lineAmountTypes"],
    currencyCode: params.currency_code as unknown as Invoice["currencyCode"],
    brandingThemeID: params.branding_theme_id,
    plannedPaymentDate: params.planned_payment_date,
  }) as Invoice;
}

export function registerInvoiceTools(server: McpServer) {
  server.registerTool(
    "xero_list_invoices",
    {
      title: "List Xero Invoices (Accounts Receivable)",
      description: `List sales invoices (ACCREC / money owed to you) with optional filters.

Returns up to page_size invoices matching the filters. Supports filtering by status, contact, invoice number, or a raw Xero WHERE clause. Does NOT return bills — use xero_list_bills for ACCPAY.

Common usage:
  - Unpaid invoices: statuses=['AUTHORISED']
  - Recent activity: modified_since='2026-04-01T00:00:00Z'
  - By customer: contact_ids=['<uuid>']

Returns: { invoices: [...], page, count }.`,
      inputSchema: ListSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await getXeroClient();
        const baseWhere = 'Type=="ACCREC"';
        const where = params.where ? `${baseWhere} AND (${params.where})` : baseWhere;
        const res = await client.accountingApi.getInvoices(
          tenantId(),
          params.modified_since ? new Date(params.modified_since) : undefined,
          where,
          params.order,
          undefined,
          params.invoice_numbers,
          params.contact_ids,
          params.statuses as string[] | undefined,
          params.page,
          undefined,
          undefined,
          undefined,
          undefined,
          params.page_size,
        );
        const invoices = res.body.invoices ?? [];
        const data = {
          page: params.page,
          count: invoices.length,
          invoices: invoices.map(invoiceSummary),
        };
        return params.response_format === ResponseFormat.JSON
          ? jsonResult(data)
          : markdownResult(invoicesMarkdown("Invoices", invoices, params.page), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_get_invoice",
    {
      title: "Get a Xero Invoice by ID or Number",
      description:
        "Fetch a single invoice (ACCREC or ACCPAY) with full line items, payments, and history. Accepts either a UUID invoice_id or the invoice_number (e.g. 'INV-0042').",
      inputSchema: {
        invoice_id_or_number: z
          .string()
          .min(1)
          .describe("Xero invoice UUID or invoice number (e.g. INV-0042)"),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ invoice_id_or_number, response_format }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getInvoice(
          tenantId(),
          invoice_id_or_number,
        );
        const invoice = res.body.invoices?.[0];
        if (!invoice) {
          return {
            content: [
              {
                type: "text",
                text: `No invoice found for '${invoice_id_or_number}'.`,
              },
            ],
            isError: true,
          };
        }
        return response_format === ResponseFormat.JSON
          ? jsonResult(invoice)
          : markdownResult(invoicesMarkdown("Invoices", [invoice], 1), invoice);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_create_invoice",
    {
      title: "Create a Sales Invoice (ACCREC)",
      description: `Create a new sales invoice (money owed TO the organisation).

Status defaults to DRAFT so nothing is sent automatically. Use status='AUTHORISED' to immediately approve the invoice for payment/sending.

Required: contact_id (use xero_search_contacts first if you only have a name), line_items (at least one, each needs description + unit_amount + account_code).

Returns the created invoice including its generated invoice_number and invoice_id.`,
      inputSchema: CreateInvoiceSchema.shape,
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
        const payload = buildInvoicePayload("ACCREC", params);
        const res = await client.accountingApi.createInvoices(tenantId(), {
          invoices: [payload],
        });
        const created = res.body.invoices?.[0];
        return jsonResult({ created: created ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_update_invoice",
    {
      title: "Update a Xero Invoice",
      description: `Update an existing invoice by ID. Commonly used to:
  - Approve a DRAFT invoice (status='AUTHORISED')
  - Void an invoice (status='VOIDED' — only allowed if no payments)
  - Replace the line items
  - Change the due date or reference

Only fields you pass are changed; unsupplied fields remain untouched on the Xero side.`,
      inputSchema: {
        invoice_id: z.string().uuid().describe("Xero invoice UUID"),
        status: z
          .enum(["DRAFT", "SUBMITTED", "AUTHORISED", "VOIDED", "DELETED"])
          .optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        reference: z.string().optional(),
        line_items: z.array(LineItemSchema).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ invoice_id, status, due_date, reference, line_items }) => {
      try {
        const client = await getXeroClient();
        const update: Invoice = compact({
          status: status as unknown as Invoice.StatusEnum | undefined,
          dueDate: due_date,
          reference,
          lineItems: line_items?.map(toXeroLineItem),
        }) as Invoice;
        const res = await client.accountingApi.updateInvoice(tenantId(), invoice_id, {
          invoices: [update],
        });
        return jsonResult({ updated: res.body.invoices?.[0] ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  // Bills (ACCPAY)
  server.registerTool(
    "xero_list_bills",
    {
      title: "List Xero Bills (Accounts Payable)",
      description:
        "List supplier bills (ACCPAY / money you owe) with optional filters. Same filter semantics as xero_list_invoices but scoped to ACCPAY.",
      inputSchema: ListSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const client = await getXeroClient();
        const baseWhere = 'Type=="ACCPAY"';
        const where = params.where ? `${baseWhere} AND (${params.where})` : baseWhere;
        const res = await client.accountingApi.getInvoices(
          tenantId(),
          params.modified_since ? new Date(params.modified_since) : undefined,
          where,
          params.order,
          undefined,
          params.invoice_numbers,
          params.contact_ids,
          params.statuses as string[] | undefined,
          params.page,
          undefined,
          undefined,
          undefined,
          undefined,
          params.page_size,
        );
        const invoices = res.body.invoices ?? [];
        const data = {
          page: params.page,
          count: invoices.length,
          bills: invoices.map(invoiceSummary),
        };
        return params.response_format === ResponseFormat.JSON
          ? jsonResult(data)
          : markdownResult(invoicesMarkdown("Bills", invoices, params.page), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_create_bill",
    {
      title: "Create a Supplier Bill (ACCPAY)",
      description: `Create a new supplier bill (money the organisation OWES).

Status defaults to DRAFT. Use 'AUTHORISED' to approve for payment. Typically expense account_codes start with '4' or '5' (consult xero_list_accounts).`,
      inputSchema: CreateBillSchema.shape,
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
        const payload = buildInvoicePayload("ACCPAY", params);
        const res = await client.accountingApi.createInvoices(tenantId(), {
          invoices: [payload],
        });
        return jsonResult({ created: res.body.invoices?.[0] ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
