import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  currentAuthMode,
  currentTenantInfo,
  getAuthMode,
  hasCredentials,
  reauthorizeOAuth,
  refreshTenantList,
  setCurrentTenant,
} from "../client.js";
import { formatError, jsonResult, markdownResult } from "../common.js";

export function registerTenantTools(server: McpServer) {
  server.registerTool(
    "xero_list_tenants",
    {
      title: "List all Xero organisations authorised under this connection",
      description: `Show every Xero org the current auth grants access to. Use this for bookkeepers / accountants who manage multiple client orgs under one OAuth consent.

In Custom Connection mode, this returns the single connected org.

In OAuth mode, this returns every org granted during consent. Pair with xero_set_current_tenant to switch which org the other tools target.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        if (!hasCredentials()) {
          return markdownResult(
            "Xero credentials not configured. Call `xero_get_setup_help` for setup instructions (free OAuth 2.0 or paid Custom Connection).",
          );
        }
        const tenants = await refreshTenantList();
        const current = currentTenantInfo();
        const mode = getAuthMode();
        return jsonResult({
          auth_mode: mode,
          current_tenant_id: current?.tenant_id ?? null,
          current_tenant_name: current?.tenant_name ?? null,
          count: tenants.length,
          tenants: tenants.map((t) => ({
            ...t,
            is_current: t.tenant_id === current?.tenant_id,
          })),
        });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_get_current_tenant",
    {
      title: "Show which Xero org is currently active",
      description:
        "Report the current auth mode and the tenant all other xero_* tools will target by default. Call this to verify which client's books you're working on before making changes.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const hasCreds = hasCredentials();
      if (!hasCreds) {
        return markdownResult(
          "Xero credentials not configured. Call `xero_get_setup_help` to get set up.",
        );
      }
      let mode: string;
      try {
        mode = getAuthMode();
      } catch (err) {
        mode = `invalid: ${err instanceof Error ? err.message : String(err)}`;
      }
      const current = currentTenantInfo();
      const cached = currentAuthMode();
      return jsonResult({
        configured_auth_mode: mode,
        initialised_auth_mode: cached,
        current_tenant: current,
        credentials_present: hasCreds,
      });
    },
  );

  server.registerTool(
    "xero_set_current_tenant",
    {
      title: "Switch the active Xero organisation (OAuth only)",
      description: `Change which Xero org subsequent xero_* tools target. Use this whenever the user says things like:
  - "switch to <client name>"
  - "I want to work on <client>'s books"
  - "use the <client> Xero now"

Persists to disk — the selection survives restart. Only valid in OAuth mode (Custom Connections are single-tenant).

Workflow for bookkeepers:
  1. xero_list_tenants to see all client orgs
  2. xero_set_current_tenant({tenant_id: "<uuid>"}) to switch
  3. Normal operations (xero_create_invoice, etc.) run against the selected org

If the target isn't in the list, run xero_authorize_new_tenant to re-consent and add new orgs.`,
      inputSchema: {
        tenant_id: z
          .string()
          .uuid()
          .describe(
            "UUID of the Xero org to make active. Must be one returned by xero_list_tenants.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tenant_id }) => {
      try {
        const chosen = await setCurrentTenant(tenant_id);
        return jsonResult({
          switched_to: chosen,
          message: `Active tenant is now ${chosen.tenant_name ?? chosen.tenant_id}.`,
        });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_authorize_new_tenant",
    {
      title: "Add a new Xero organisation via browser consent (OAuth only)",
      description: `Trigger the Xero OAuth consent flow to authorise additional client organisations. Use this when:
  - "I need to add a new Xero client"
  - "Connect <client name>'s books"
  - xero_list_tenants doesn't show the org you want to work with
  - You've gained access to a new Xero org since the initial setup

The server opens the system browser to Xero's consent page. **Tick every org you want to manage** (including ones already authorised, to keep them). Xero issues a fresh token set covering all selected orgs; the existing token file is replaced.

After success, the tool reports which orgs are new, which (if any) are no longer accessible, and the full current tenant list.

Only works in OAuth mode. Custom Connection is single-tenant by design — to add another org under a Custom Connection, you'd need a second paid Custom Connection and a separate MCP install.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        if (!hasCredentials()) {
          return markdownResult(
            "Xero credentials aren't configured yet. Call `xero_get_setup_help` first — standard OAuth 2.0 setup is the one you want for multiple tenants.",
          );
        }
        const result = await reauthorizeOAuth();
        const lines = [
          `# Xero re-authorisation complete`,
          "",
          `Authorised orgs: ${result.current.length}`,
          "",
        ];
        if (result.added.length) {
          lines.push("## Added", "");
          for (const t of result.added) {
            lines.push(
              `- **${t.tenant_name ?? "(unnamed)"}** — \`${t.tenant_id}\``,
            );
          }
          lines.push("");
        }
        if (result.removed.length) {
          lines.push("## No longer accessible", "");
          for (const t of result.removed) {
            lines.push(
              `- ${t.tenant_name ?? "(unnamed)"} — \`${t.tenant_id}\``,
            );
          }
          lines.push("");
        }
        if (!result.added.length && !result.removed.length) {
          lines.push("No changes — same tenants as before.", "");
        }
        lines.push(
          "## All orgs currently authorised",
          "",
          ...result.current.map(
            (t) => `- ${t.tenant_name ?? "(unnamed)"} — \`${t.tenant_id}\``,
          ),
          "",
          "Call `xero_set_current_tenant` with a tenant_id to switch the active org.",
        );
        return markdownResult(lines.join("\n"), result);
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
