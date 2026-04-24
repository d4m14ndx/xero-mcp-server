import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Contact } from "xero-node";
import { getXeroClient, tenantId } from "../client.js";
import {
  PaginationSchema,
  ResponseFormatSchema,
  ResponseFormat,
  compact,
  formatError,
  jsonResult,
  markdownResult,
} from "../common.js";

function contactSummary(c: Contact) {
  return {
    contact_id: c.contactID,
    name: c.name,
    email: c.emailAddress,
    is_customer: c.isCustomer,
    is_supplier: c.isSupplier,
    contact_status: c.contactStatus,
    account_number: c.accountNumber,
    default_currency: c.defaultCurrency,
  };
}

export function registerContactTools(server: McpServer) {
  server.registerTool(
    "xero_search_contacts",
    {
      title: "Search Xero Contacts",
      description: `Search contacts (customers + suppliers) by free-text search term, or fetch by exact filters. Use this before creating invoices/bills when you only know the contact's name — the returned contact_id is needed downstream.`,
      inputSchema: {
        search_term: z
          .string()
          .optional()
          .describe("Free-text search against Name, FirstName, LastName, EmailAddress"),
        where: z
          .string()
          .optional()
          .describe("Raw Xero WHERE clause (e.g. 'Name==\"Acme Ltd\"')"),
        include_archived: z.boolean().default(false),
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
    async ({
      search_term,
      where,
      include_archived,
      page,
      page_size,
      response_format,
    }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getContacts(
          tenantId(),
          undefined,
          where,
          undefined,
          undefined,
          page,
          include_archived,
          undefined,
          search_term,
          page_size,
        );
        const contacts = res.body.contacts ?? [];
        const data = {
          page,
          count: contacts.length,
          contacts: contacts.map(contactSummary),
        };
        if (response_format === ResponseFormat.JSON) return jsonResult(data);
        const lines = [`# Contacts (page ${page}, ${contacts.length} items)`, ""];
        for (const c of contacts) {
          const roles = [
            c.isCustomer ? "customer" : null,
            c.isSupplier ? "supplier" : null,
          ]
            .filter(Boolean)
            .join("/") || "(no role)";
          lines.push(
            `- **${c.name}** (${roles}) — ${c.emailAddress ?? "no email"} — \`${c.contactID}\``,
          );
        }
        return markdownResult(lines.join("\n"), data);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_create_contact",
    {
      title: "Create a Xero Contact",
      description:
        "Create a new contact. A single contact can act as both customer and supplier — that's controlled by whether you send them invoices (ACCREC) or bills (ACCPAY), not by a flag here.",
      inputSchema: {
        name: z.string().min(1).describe("Display name of the contact"),
        email: z.string().email().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        account_number: z
          .string()
          .optional()
          .describe("Internal account number you use to track this contact"),
        default_currency: z.string().length(3).optional().describe("ISO currency code"),
        tax_number: z.string().optional().describe("Tax ID / ABN / VAT number"),
        phone: z
          .string()
          .optional()
          .describe("Default phone number (will be stored as type DEFAULT)"),
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
        const contact: Contact = compact({
          name: params.name,
          emailAddress: params.email,
          firstName: params.first_name,
          lastName: params.last_name,
          accountNumber: params.account_number,
          defaultCurrency: params.default_currency as unknown as Contact["defaultCurrency"],
          taxNumber: params.tax_number,
          phones: params.phone
            ? [
                {
                  phoneType: "DEFAULT" as unknown as import("xero-node").Phone.PhoneTypeEnum,
                  phoneNumber: params.phone,
                },
              ]
            : undefined,
        }) as Contact;
        const res = await client.accountingApi.createContacts(tenantId(), {
          contacts: [contact],
        });
        return jsonResult({ created: res.body.contacts?.[0] ?? null });
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
