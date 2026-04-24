import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Client tests — isolate module state by dynamically importing for each test
 * and restoring env vars between runs.
 */

const ENV_KEYS = [
  "XERO_CLIENT_ID",
  "XERO_CLIENT_SECRET",
  "XERO_AUTH_MODE",
  "XERO_TENANT_ID",
  "XERO_SCOPES",
  "XERO_OAUTH_REDIRECT_URI",
] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = savedEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("hasCredentials", () => {
  it("returns false when neither env var is set", async () => {
    const { hasCredentials } = await import("../src/client.js");
    expect(hasCredentials()).toBe(false);
  });

  it("returns false when only one is set", async () => {
    process.env.XERO_CLIENT_ID = "x";
    const { hasCredentials } = await import("../src/client.js");
    expect(hasCredentials()).toBe(false);
  });

  it("returns true when both are set", async () => {
    process.env.XERO_CLIENT_ID = "x";
    process.env.XERO_CLIENT_SECRET = "y";
    const { hasCredentials } = await import("../src/client.js");
    expect(hasCredentials()).toBe(true);
  });
});

describe("getAuthMode", () => {
  it("defaults to custom_connection when unset", async () => {
    const { getAuthMode } = await import("../src/client.js");
    expect(getAuthMode()).toBe("custom_connection");
  });

  it("returns oauth when XERO_AUTH_MODE=oauth", async () => {
    process.env.XERO_AUTH_MODE = "oauth";
    const { getAuthMode } = await import("../src/client.js");
    expect(getAuthMode()).toBe("oauth");
  });

  it("normalises case", async () => {
    process.env.XERO_AUTH_MODE = "OAuth";
    const { getAuthMode } = await import("../src/client.js");
    expect(getAuthMode()).toBe("oauth");
  });

  it("throws on invalid value", async () => {
    process.env.XERO_AUTH_MODE = "nonsense";
    const { getAuthMode } = await import("../src/client.js");
    expect(() => getAuthMode()).toThrow(/Invalid XERO_AUTH_MODE/);
  });
});

describe("tenantId()", () => {
  it("returns empty string by default (pre-init)", async () => {
    const { tenantId } = await import("../src/client.js");
    expect(tenantId()).toBe("");
  });

  it("returns the override when provided", async () => {
    const { tenantId } = await import("../src/client.js");
    expect(tenantId("abc-123")).toBe("abc-123");
  });

  it("ignores empty-string override", async () => {
    const { tenantId } = await import("../src/client.js");
    expect(tenantId("")).toBe("");
    expect(tenantId("   ")).toBe("");
  });

  it("ignores null override", async () => {
    const { tenantId } = await import("../src/client.js");
    expect(tenantId(null)).toBe("");
  });
});

describe("XeroSetupRequiredError", () => {
  it("is an Error with name set", async () => {
    const { XeroSetupRequiredError } = await import("../src/client.js");
    const e = new XeroSetupRequiredError("please configure");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("XeroSetupRequiredError");
    expect(e.message).toBe("please configure");
  });
});

describe("setCurrentTenant in custom_connection mode", () => {
  it("throws a helpful error", async () => {
    const { setCurrentTenant } = await import("../src/client.js");
    await expect(
      setCurrentTenant("a8908f1c-4f2b-4b8e-9c8d-1234567890ab"),
    ).rejects.toThrow(/custom_connection mode/);
  });
});
