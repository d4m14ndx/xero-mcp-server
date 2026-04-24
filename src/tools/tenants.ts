import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  currentAuthMode,
  currentTenantInfo,
  getAuthMode,
  hasCredentials,
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
      description: `Change which Xero org subsequent xero_* tools target by default. Persists to disk so the selection survives restart.

Only valid in OAuth mode — Custom Connections are single-tenant by design.

Workflow for bookkeepers:
  1. xero_list_tenants to see all client orgs
  2. xero_set_current_tenant({tenant_id: "<uuid>"}) to switch
  3. Normal operations (xero_create_invoice, etc.) run against the selected org
  4. Or: pass tenant_id as a parameter to individual tools for explicit targeting without switching`,
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
}
