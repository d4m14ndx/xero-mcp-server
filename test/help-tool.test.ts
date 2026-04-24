import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHelpTools } from "../src/tools/help.js";

interface Registered {
  handler: (args: unknown) => Promise<unknown>;
  config: Record<string, unknown>;
}

function captureTools(
  server: McpServer,
): Map<string, Registered> {
  const map = new Map<string, Registered>();
  const original = server.registerTool.bind(server);
  // @ts-expect-error wrapping
  server.registerTool = (name: string, config: Record<string, unknown>, handler: unknown) => {
    map.set(name, { config, handler: handler as Registered["handler"] });
    return original(name, config, handler);
  };
  return map;
}

describe("xero_get_setup_help", () => {
  const ENV_KEYS = ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_AUTH_MODE"];
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

  it("returns content even with no credentials", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerHelpTools(server);
    const help = tools.get("xero_get_setup_help");
    expect(help).toBeDefined();
    const result = await help!.handler({ mode: "both" });
    expect(result).toBeDefined();
    const r = result as { content: Array<{ text: string }> };
    expect(r.content[0].text).toContain("Xero MCP setup");
    expect(r.content[0].text).toContain("credentials **not configured**");
  });

  it("shows only free guide when mode=free", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerHelpTools(server);
    const result = (await tools.get("xero_get_setup_help")!.handler({
      mode: "free",
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("standard OAuth 2.0");
    expect(result.content[0].text).not.toContain("Custom Connection");
  });

  it("shows only paid guide when mode=paid", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerHelpTools(server);
    const result = (await tools.get("xero_get_setup_help")!.handler({
      mode: "paid",
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("Custom Connection");
    expect(result.content[0].text).not.toContain("standard OAuth 2.0");
  });

  it("reports credentials present when env is set", async () => {
    process.env.XERO_CLIENT_ID = "x";
    process.env.XERO_CLIENT_SECRET = "y";
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerHelpTools(server);
    const result = (await tools.get("xero_get_setup_help")!.handler({
      mode: "both",
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("credentials **present**");
  });

  it("reports the configured auth mode", async () => {
    process.env.XERO_AUTH_MODE = "oauth";
    const server = new McpServer({ name: "t", version: "0" });
    const tools = captureTools(server);
    registerHelpTools(server);
    const result = (await tools.get("xero_get_setup_help")!.handler({
      mode: "both",
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toContain("auth mode = `oauth`");
  });
});
