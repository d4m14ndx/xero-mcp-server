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

const server = new McpServer({
  name: "xero-mcp-server",
  version: "0.3.0",
});

registerInvoiceTools(server);
registerPaymentTools(server);
registerBankTools(server);
registerContactTools(server);
registerReferenceTools(server);
registerAttachmentTools(server);
registerBillableTools(server);

async function main() {
  if (!process.env.XERO_CLIENT_ID || !process.env.XERO_CLIENT_SECRET) {
    console.error(
      "ERROR: XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set. See README for setup.",
    );
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("xero-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
