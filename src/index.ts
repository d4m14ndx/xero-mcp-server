#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerInvoiceTools } from "./tools/invoices.js";
import { registerPaymentTools } from "./tools/payments.js";
import { registerBankTools } from "./tools/bank.js";
import { registerContactTools } from "./tools/contacts.js";
import { registerReferenceTools } from "./tools/reference.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerBillableTools } from "./tools/billable.js";
import { registerHelpTools } from "./tools/help.js";
import { registerTenantTools } from "./tools/tenants.js";

const server = new McpServer({
  name: "xero-mcp-server",
  version: "0.4.0",
});

// Help + tenant tools register first so they're discoverable even when the
// server starts without credentials.
registerHelpTools(server);
registerTenantTools(server);

registerInvoiceTools(server);
registerPaymentTools(server);
registerBankTools(server);
registerContactTools(server);
registerReferenceTools(server);
registerAttachmentTools(server);
registerBillableTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const hasCreds = !!(
    process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET
  );
  console.error(
    `xero-mcp-server running on stdio. Credentials ${hasCreds ? "present" : "NOT configured — call xero_get_setup_help for instructions"}.`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
