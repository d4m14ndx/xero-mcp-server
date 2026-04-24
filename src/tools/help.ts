import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAuthMode, hasCredentials } from "../client.js";
import { markdownResult } from "../common.js";

const FREE_GUIDE = `## Free setup — standard OAuth 2.0 (recommended for single-user or bookkeepers)

Free Xero dev plan. Works with **any number of Xero organisations** — one consent can grant access to all client orgs you already work with in Xero.

1. Sign in at https://developer.xero.com/app/manage as a user who has access to the orgs you want to manage.
2. **New app → Web app.** Give it a name (e.g. "Claude MCP") and any company URL.
3. **Redirect URI**: set to \`http://localhost:5555/callback\` (matches this server's default). Add other ports later only if you override the default.
4. **Scopes** — add all of these:
   - \`accounting.transactions\`
   - \`accounting.contacts\`
   - \`accounting.settings.read\`
   - \`accounting.attachments\`
   - \`offline_access\` (**required** — grants the refresh token)
5. Copy the **Client ID** and **Client Secret** (shown once on creation).
6. In your MCP client config, set:
   \`\`\`
   XERO_AUTH_MODE=oauth
   XERO_CLIENT_ID=<your client id>
   XERO_CLIENT_SECRET=<your client secret>
   \`\`\`
7. Restart the MCP client. The first tool call that needs Xero will open your browser to consent. **Pick multiple orgs** if you want the tool to manage them all.
8. Tokens persist to \`~/.xero-mcp/oauth-tokens.json\` — refresh tokens rotate automatically and survive 60 days of inactivity.

**Multi-tenant**: after consent, use \`xero_list_tenants\` to see all authorised orgs and \`xero_set_current_tenant\` to switch between them. Every tool also accepts an optional \`tenant_id\` parameter for per-call targeting.`;

const PAID_GUIDE = `## Paid setup — Xero Custom Connection (single org, no browser)

~USD $10/mo per connection. Best for a single-org deployment where you don't want any browser consent flow.

1. Sign in at https://developer.xero.com/app/manage as a Xero org **admin** for the org you want to connect.
2. **New app → Custom connection.** Name it, select the org.
3. **Scopes** — add:
   - \`accounting.transactions\`
   - \`accounting.contacts\`
   - \`accounting.settings.read\`
   - \`accounting.attachments\`
4. Save. Copy the **Client ID** and **Client Secret** (shown once).
5. Xero emails the admin; the admin must click the approval link to activate the connection.
6. In your MCP client config, set:
   \`\`\`
   XERO_CLIENT_ID=<your client id>
   XERO_CLIENT_SECRET=<your client secret>
   \`\`\`
   (\`XERO_AUTH_MODE\` defaults to \`custom_connection\`, no need to set it.)
7. Restart the MCP client. Done — no browser flow.

**Single-tenant**: Custom Connections are scoped to one org. To manage multiple orgs, use the free OAuth setup instead.`;

export function registerHelpTools(server: McpServer) {
  server.registerTool(
    "xero_get_setup_help",
    {
      title: "Show Xero MCP setup instructions",
      description: `Return step-by-step instructions for setting up Xero credentials. Use when:
  - The user asks how to install / configure the Xero MCP
  - Another xero_* tool returned 'credentials not configured'
  - The user asks how to use this tool for multiple client orgs (bookkeeping)

Two paths documented: (1) free standard OAuth 2.0 — supports multiple orgs via one consent, recommended for bookkeepers; (2) paid Custom Connection — single org, no browser.

Reports the server's current auth mode and whether credentials are present.`,
      inputSchema: {
        mode: z
          .enum(["both", "free", "paid"])
          .default("both")
          .describe(
            "Which setup path to show. 'free' = OAuth 2.0 (multi-org), 'paid' = Custom Connection (single org).",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ mode }) => {
      let currentMode: string;
      try {
        currentMode = getAuthMode();
      } catch (err) {
        currentMode = `(invalid: ${err instanceof Error ? err.message : String(err)})`;
      }
      const credsPresent = hasCredentials();

      const sections: string[] = [
        "# Xero MCP setup",
        "",
        `**Current server state**: auth mode = \`${currentMode}\`, credentials ${credsPresent ? "**present**" : "**not configured**"}.`,
        "",
      ];

      if (mode === "free" || mode === "both") sections.push(FREE_GUIDE, "");
      if (mode === "paid" || mode === "both") sections.push(PAID_GUIDE, "");

      if (mode === "both") {
        sections.push(
          "## Which one should I pick?",
          "",
          "- **One Xero org, want zero-friction**: paid Custom Connection.",
          "- **Multiple Xero orgs (bookkeepers, accountants)**: free OAuth 2.0 — one consent covers them all. Use `xero_list_tenants` and `xero_set_current_tenant` to switch between client books.",
          "- **Trying it out**: free OAuth 2.0.",
          "",
        );
      }

      sections.push(
        "## After setup",
        "",
        "- Call `xero_get_organisation` to confirm the connected org.",
        "- Call `xero_list_tenants` (OAuth mode) to see all authorised orgs.",
        "- Call `xero_get_current_tenant` to verify which one is active.",
        "- Repo / source: https://github.com/d4m14ndx/xero-mcp-server",
      );

      return markdownResult(sections.join("\n"));
    },
  );
}
