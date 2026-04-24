import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTenantTools } from "../src/tools/tenants.js";

function captureTools(server: McpServer) {
  const map = new Map<
    string,
    { handler: (args: unknown) => Promise<unknown> }
  >();
  const original = server.registerTool.bind(server);
  // @ts-expect-error wrapping
  server.registerTool = (name: string, config: Record<string, unknown>, handler: unknown) => {
    map.set(name, { handler: handler as (args: unknown) => Promise<unknown> });
    return original(name, config, handler);
  };
  return map;
}

const ENV_KEYS = [
  "XERO_CLIENT_ID",
  "XERO_CLIENT_SECRET",
  "XERO_AUTH_MODE",
  "XERO_TENANT_ID",
];

describe("tenant tools — no credentials", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("xero_list_tenants returns setup-help pointer", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerTenantTools(server);
    const result = (await tools.get("xero_list_tenants")!.handler({})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain("xero_get_setup_help");
  });

  it("xero_get_current_tenant returns setup-help pointer", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerTenantTools(server);
    const result = (await tools.get("xero_get_current_tenant")!.handler({})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toContain("xero_get_setup_help");
  });
});

describe("xero_set_current_tenant in custom_connection mode", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    // Custom connection is default; providing creds isn't needed since the
    // handler errors before hitting Xero.
    process.env.XERO_CLIENT_ID = "x";
    process.env.XERO_CLIENT_SECRET = "y";
    process.env.XERO_AUTH_MODE = "custom_connection";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns an actionable error (not a crash)", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerTenantTools(server);
    const result = (await tools.get("xero_set_current_tenant")!.handler({
      tenant_id: "a8908f1c-4f2b-4b8e-9c8d-1234567890ab",
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("custom_connection mode");
  });
});
