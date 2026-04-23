import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Invoice } from "xero-node";
import { getXeroClient, TENANT_ID } from "../client.js";
import {
  compact,
  formatError,
  formatMoney,
  jsonResult,
  markdownResult,
  ResponseFormat,
  ResponseFormatSchema,
} from "../common.js";

/**
 * Billable expenses tracking.
 *
 * Xero's "Assign expense to customer" feature in the UI is NOT exposed via the
 * public API. This module implements the same workflow using a local JSON store:
 *
 *   1. `xero_flag_bill_line_as_billable` — record a bill line as billable to a client
 *   2. `xero_list_billable_expenses` — see pending/billed expenses
 *   3. `xero_generate_invoice_from_billable_expenses` — create an ACCREC invoice
 *      for a client that invoices all their pending billable expenses
 */

interface BillableExpenseRecord {
  id: string; // uuid-like, just a timestamp+counter
  bill_invoice_id: string; // Xero invoice_id of the bill (ACCPAY)
  bill_number: string | null;
  bill_line_item_id: string | null;
  client_contact_id: string;
  client_name: string | null;
  description: string;
  quantity: number;
  unit_amount: number; // cost as recorded on the bill
  markup_percent: number;
  billable_amount: number; // unit_amount * quantity * (1 + markup/100)
  currency: string | null;
  account_code: string | null; // defaults used on the sales invoice line
  tax_type: string | null;
  status: "pending" | "billed";
  billed_invoice_id?: string;
  billed_invoice_number?: string;
  billed_at?: string;
  created_at: string;
}

interface Store {
  version: 1;
  expenses: BillableExpenseRecord[];
}

const STORE_PATH = path.join(os.homedir(), ".xero-mcp", "billable-expenses.json");

async function loadStore(): Promise<Store> {
  try {
    const raw = await fs.promises.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!parsed.expenses) parsed.expenses = [];
    return parsed;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, expenses: [] };
    throw e;
  }
}

async function saveStore(store: Store): Promise<void> {
  await fs.promises.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
  await fs.promises.rename(tmp, STORE_PATH);
}

function newId(): string {
  return `be_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function computeBillable(
  unit_amount: number,
  quantity: number,
  markup_percent: number,
): number {
  const raw = unit_amount * quantity * (1 + markup_percent / 100);
  return Math.round(raw * 100) / 100;
}

export function registerBillableTools(server: McpServer) {
  server.registerTool(
    "xero_flag_bill_line_as_billable",
    {
      title: "Flag a bill line as a billable client expense",
      description: `Record that a line on a supplier bill is billable back to a client. Stored in a local JSON file (~/.xero-mcp/billable-expenses.json) — Xero's public API does not expose the native "Assign to customer" feature.

Later, call xero_generate_invoice_from_billable_expenses for a client to roll all their pending billable expenses into an invoice.

Required: bill_invoice_id (the Xero UUID of the ACCPAY bill), client_contact_id, description, unit_amount.
If bill_line_item_id is omitted, the expense is associated with the bill generally (useful when the bill has one line or when flagging the whole bill).`,
      inputSchema: {
        bill_invoice_id: z
          .string()
          .uuid()
          .describe("UUID of the Xero bill (ACCPAY invoice) this line is on"),
        bill_line_item_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Line item ID on the bill (obtained from xero_get_invoice). If omitted, applies to the bill as a whole.",
          ),
        client_contact_id: z
          .string()
          .uuid()
          .describe("Xero contact UUID of the client this expense is billable to"),
        description: z
          .string()
          .min(1)
          .describe(
            "Description to appear on the future client invoice (e.g. 'AWS hosting for project X, March 2026')",
          ),
        quantity: z.number().positive().default(1),
        unit_amount: z
          .number()
          .positive()
          .describe("Unit cost (tax-exclusive) as on the bill"),
        markup_percent: z
          .number()
          .min(-100)
          .max(500)
          .default(0)
          .describe(
            "Markup percentage to add when re-billing to the client (0 = pass-through, 20 = 20% markup)",
          ),
        currency: z.string().length(3).optional(),
        account_code: z
          .string()
          .optional()
          .describe(
            "Revenue account code to use on the client invoice line (defaults to the org's default sales account if omitted)",
          ),
        tax_type: z
          .string()
          .optional()
          .describe(
            "Tax type for the client invoice line (e.g. 'OUTPUT'). Defaults to 'OUTPUT' for AU orgs.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const store = await loadStore();

        // Enrich with bill + contact metadata if accessible
        let bill_number: string | null = null;
        let client_name: string | null = null;
        try {
          const client = await getXeroClient();
          const billRes = await client.accountingApi.getInvoice(
            TENANT_ID,
            params.bill_invoice_id,
          );
          bill_number = billRes.body.invoices?.[0]?.invoiceNumber ?? null;
        } catch {
          // non-fatal — the flag still gets saved
        }
        try {
          const client = await getXeroClient();
          const contactRes = await client.accountingApi.getContact(
            TENANT_ID,
            params.client_contact_id,
          );
          client_name = contactRes.body.contacts?.[0]?.name ?? null;
        } catch {
          // non-fatal
        }

        const record: BillableExpenseRecord = {
          id: newId(),
          bill_invoice_id: params.bill_invoice_id,
          bill_number,
          bill_line_item_id: params.bill_line_item_id ?? null,
          client_contact_id: params.client_contact_id,
          client_name,
          description: params.description,
          quantity: params.quantity,
          unit_amount: params.unit_amount,
          markup_percent: params.markup_percent,
          billable_amount: computeBillable(
            params.unit_amount,
            params.quantity,
            params.markup_percent,
          ),
          currency: params.currency ?? null,
          account_code: params.account_code ?? null,
          tax_type: params.tax_type ?? null,
          status: "pending",
          created_at: new Date().toISOString(),
        };

        store.expenses.push(record);
        await saveStore(store);
        return jsonResult({ flagged: record, store_path: STORE_PATH });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_list_billable_expenses",
    {
      title: "List pending or billed client expenses",
      description:
        "List locally-tracked billable expenses. Filter by client, status, or bill.",
      inputSchema: {
        client_contact_id: z.string().uuid().optional(),
        status: z.enum(["pending", "billed", "all"]).default("pending"),
        bill_invoice_id: z.string().uuid().optional(),
        response_format: ResponseFormatSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ client_contact_id, status, bill_invoice_id, response_format }) => {
      try {
        const store = await loadStore();
        let expenses = store.expenses;
        if (client_contact_id)
          expenses = expenses.filter((e) => e.client_contact_id === client_contact_id);
        if (bill_invoice_id)
          expenses = expenses.filter((e) => e.bill_invoice_id === bill_invoice_id);
        if (status !== "all") expenses = expenses.filter((e) => e.status === status);
        const data = {
          count: expenses.length,
          total_billable: Math.round(
            expenses.reduce((sum, e) => sum + e.billable_amount, 0) * 100,
          ) / 100,
          expenses,
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [
          `# Billable expenses (${status}): ${expenses.length}`,
          "",
          `**Total billable**: ${formatMoney(data.total_billable)}`,
          "",
        ];
        for (const e of expenses) {
          lines.push(
            `- [${e.status}] ${e.client_name ?? e.client_contact_id} — ${e.description}`,
          );
          lines.push(
            `    ${e.quantity} × ${formatMoney(e.unit_amount)} + ${e.markup_percent}% = **${formatMoney(e.billable_amount)}** (bill ${e.bill_number ?? e.bill_invoice_id})`,
          );
        }
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_generate_invoice_from_billable_expenses",
    {
      title: "Create a sales invoice from pending billable expenses",
      description: `Generate a Xero ACCREC invoice for a client that includes all their pending billable expenses.

Workflow:
  1. Loads pending expenses for the given client_contact_id from the local store
  2. Creates a Xero sales invoice with one line per expense (using each expense's billable_amount including markup)
  3. On success, marks those expenses as 'billed' locally (recording the new invoice_id)

By default the invoice is created as DRAFT for review. Pass status='AUTHORISED' to approve immediately.`,
      inputSchema: {
        client_contact_id: z
          .string()
          .uuid()
          .describe("Client UUID to invoice. Only their pending expenses are included."),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        reference: z.string().optional(),
        status: z.enum(["DRAFT", "SUBMITTED", "AUTHORISED"]).default("DRAFT"),
        default_account_code: z
          .string()
          .optional()
          .describe(
            "Fallback revenue account_code for any expenses that don't have one set (e.g. '200')",
          ),
        default_tax_type: z
          .string()
          .optional()
          .describe("Fallback tax_type (e.g. 'OUTPUT')"),
        dry_run: z
          .boolean()
          .default(false)
          .describe(
            "If true, just show what would be invoiced without creating the invoice or touching the store",
          ),
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
        const store = await loadStore();
        const pending = store.expenses.filter(
          (e) => e.client_contact_id === params.client_contact_id && e.status === "pending",
        );
        if (pending.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No pending billable expenses for contact ${params.client_contact_id}.`,
              },
            ],
            isError: true,
          };
        }

        const lineItems = pending.map((e) => ({
          description: e.description,
          quantity: 1, // billable_amount already incorporates quantity + markup
          unitAmount: e.billable_amount,
          accountCode: e.account_code ?? params.default_account_code,
          taxType: e.tax_type ?? params.default_tax_type,
        }));

        const missingAccount = lineItems.find((li) => !li.accountCode);
        if (missingAccount) {
          return {
            content: [
              {
                type: "text",
                text: `Some expenses have no account_code set, and no default_account_code was provided. Pass default_account_code (e.g. '200' for sales).`,
              },
            ],
            isError: true,
          };
        }

        if (params.dry_run) {
          return jsonResult({
            dry_run: true,
            would_invoice_count: pending.length,
            would_total: Math.round(
              pending.reduce((sum, e) => sum + e.billable_amount, 0) * 100,
            ) / 100,
            expense_ids: pending.map((e) => e.id),
            lines: lineItems,
          });
        }

        const client = await getXeroClient();
        const invoicePayload = compact({
          type: "ACCREC" as unknown as Invoice.TypeEnum,
          contact: { contactID: params.client_contact_id },
          lineItems,
          date: params.date,
          dueDate: params.due_date,
          reference: params.reference,
          status: params.status as unknown as Invoice.StatusEnum,
        }) as Invoice;

        const res = await client.accountingApi.createInvoices(TENANT_ID, {
          invoices: [invoicePayload],
        });
        const created = res.body.invoices?.[0];
        if (!created?.invoiceID) {
          return {
            content: [
              { type: "text", text: "Xero accepted the request but returned no invoice." },
            ],
            isError: true,
          };
        }

        // Mark expenses as billed
        const billedAt = new Date().toISOString();
        for (const e of pending) {
          const idx = store.expenses.findIndex((s) => s.id === e.id);
          if (idx >= 0) {
            store.expenses[idx] = {
              ...store.expenses[idx],
              status: "billed",
              billed_invoice_id: created.invoiceID,
              billed_invoice_number: created.invoiceNumber ?? undefined,
              billed_at: billedAt,
            };
          }
        }
        await saveStore(store);

        return jsonResult({
          invoice: {
            invoice_id: created.invoiceID,
            invoice_number: created.invoiceNumber,
            status: created.status,
            total: created.total,
            amount_due: created.amountDue,
          },
          marked_billed: pending.length,
        });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_unflag_billable_expense",
    {
      title: "Remove or un-bill a billable expense record",
      description:
        "Delete a local billable expense record by id, or revert a 'billed' one back to 'pending' (e.g. if the invoice was voided). Does NOT touch Xero.",
      inputSchema: {
        expense_id: z.string().min(1).describe("The local expense id (e.g. 'be_xxxxx')"),
        mode: z
          .enum(["delete", "revert_to_pending"])
          .default("delete"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ expense_id, mode }) => {
      try {
        const store = await loadStore();
        const idx = store.expenses.findIndex((e) => e.id === expense_id);
        if (idx < 0) {
          return {
            content: [{ type: "text", text: `No expense found with id ${expense_id}` }],
            isError: true,
          };
        }
        let removed: BillableExpenseRecord | null = null;
        if (mode === "delete") {
          removed = store.expenses.splice(idx, 1)[0];
        } else {
          store.expenses[idx] = {
            ...store.expenses[idx],
            status: "pending",
            billed_invoice_id: undefined,
            billed_invoice_number: undefined,
            billed_at: undefined,
          };
          removed = store.expenses[idx];
        }
        await saveStore(store);
        return jsonResult({ ok: true, mode, record: removed });
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
