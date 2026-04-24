import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInvoiceTools } from "../src/tools/invoices.js";
import { registerPaymentTools } from "../src/tools/payments.js";
import { registerBankTools } from "../src/tools/bank.js";
import { registerContactTools } from "../src/tools/contacts.js";
import { registerReferenceTools } from "../src/tools/reference.js";
import { registerAttachmentTools } from "../src/tools/attachments.js";
import { registerBillableTools } from "../src/tools/billable.js";
import { registerHelpTools } from "../src/tools/help.js";
import { registerTenantTools } from "../src/tools/tenants.js";

interface RegisteredInfo {
  name: string;
  hasTitle: boolean;
  hasDescription: boolean;
  hasAnnotations: boolean;
}

function spyOnRegisterTool(server: McpServer): RegisteredInfo[] {
  const registered: RegisteredInfo[] = [];
  const original = server.registerTool.bind(server);
  // @ts-expect-error - we're intentionally wrapping
  server.registerTool = (name: string, config: Record<string, unknown>, handler: unknown) => {
    registered.push({
      name,
      hasTitle: typeof config.title === "string" && config.title.length > 0,
      hasDescription:
        typeof config.description === "string" && config.description.length > 0,
      hasAnnotations: !!config.annotations,
    });
    return original(name, config, handler);
  };
  return registered;
}

describe("tool registration", () => {
  it("registers the expected total number of tools", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registered = spyOnRegisterTool(server);
    registerHelpTools(server);
    registerTenantTools(server);
    registerReferenceTools(server);
    registerContactTools(server);
    registerInvoiceTools(server);
    registerPaymentTools(server);
    registerBankTools(server);
    registerAttachmentTools(server);
    registerBillableTools(server);

    // 1 help + 3 tenant + 3 reference + 2 contact + 6 invoices/bills + 2 payments
    // + 3 bank + 2 attachments + 4 billable = 26
    expect(registered).toHaveLength(26);
  });

  it("every tool follows the MCP quality checklist", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registered = spyOnRegisterTool(server);
    registerHelpTools(server);
    registerTenantTools(server);
    registerReferenceTools(server);
    registerContactTools(server);
    registerInvoiceTools(server);
    registerPaymentTools(server);
    registerBankTools(server);
    registerAttachmentTools(server);
    registerBillableTools(server);

    for (const r of registered) {
      expect(r.name, `${r.name} should have snake_case tool name`).toMatch(
        /^[a-z][a-z0-9_]*$/,
      );
      expect(r.name, `${r.name} should have xero_ prefix`).toMatch(/^xero_/);
      expect(r.hasTitle, `${r.name} missing title`).toBe(true);
      expect(r.hasDescription, `${r.name} missing description`).toBe(true);
      expect(r.hasAnnotations, `${r.name} missing annotations`).toBe(true);
    }
  });

  it("registers all required tool categories", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registered = spyOnRegisterTool(server);
    registerHelpTools(server);
    registerTenantTools(server);
    registerReferenceTools(server);
    registerContactTools(server);
    registerInvoiceTools(server);
    registerPaymentTools(server);
    registerBankTools(server);
    registerAttachmentTools(server);
    registerBillableTools(server);
    const names = registered.map((r) => r.name);

    // Setup + multi-tenant
    expect(names).toContain("xero_get_setup_help");
    expect(names).toContain("xero_list_tenants");
    expect(names).toContain("xero_get_current_tenant");
    expect(names).toContain("xero_set_current_tenant");

    // Core Xero ops
    expect(names).toContain("xero_create_invoice");
    expect(names).toContain("xero_create_bill");
    expect(names).toContain("xero_create_payment");
    expect(names).toContain("xero_create_bank_transaction");
    expect(names).toContain("xero_attach_file_to_invoice_or_bill");

    // Billable expenses
    expect(names).toContain("xero_flag_bill_line_as_billable");
    expect(names).toContain("xero_generate_invoice_from_billable_expenses");
  });

  it("does not register duplicate names", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registered = spyOnRegisterTool(server);
    registerHelpTools(server);
    registerTenantTools(server);
    registerReferenceTools(server);
    registerContactTools(server);
    registerInvoiceTools(server);
    registerPaymentTools(server);
    registerBankTools(server);
    registerAttachmentTools(server);
    registerBillableTools(server);

    const names = registered.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
