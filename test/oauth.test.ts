import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DEFAULT_REDIRECT_URI,
  OAUTH_DEFAULT_SCOPES,
  loadPersistedToken,
  parseRedirectUri,
  savePersistedToken,
  TOKEN_FILE,
} from "../src/oauth.js";

const REDIRECT_ENV = "XERO_OAUTH_REDIRECT_URI";

describe("parseRedirectUri", () => {
  beforeEach(() => {
    delete process.env[REDIRECT_ENV];
  });
  afterEach(() => {
    delete process.env[REDIRECT_ENV];
  });

  it("defaults to localhost:5555/callback", () => {
    const r = parseRedirectUri();
    expect(r.uri).toBe(DEFAULT_REDIRECT_URI);
    expect(r.port).toBe(5555);
    expect(r.pathname).toBe("/callback");
  });

  it("accepts 127.0.0.1 override", () => {
    process.env[REDIRECT_ENV] = "http://127.0.0.1:8080/xero";
    const r = parseRedirectUri();
    expect(r.port).toBe(8080);
    expect(r.pathname).toBe("/xero");
  });

  it("rejects non-localhost hosts", () => {
    process.env[REDIRECT_ENV] = "http://example.com/callback";
    expect(() => parseRedirectUri()).toThrow(/localhost/);
  });
});

describe("OAUTH_DEFAULT_SCOPES", () => {
  it("includes offline_access (required for refresh tokens)", () => {
    expect(OAUTH_DEFAULT_SCOPES).toContain("offline_access");
  });

  it("includes accounting scopes", () => {
    expect(OAUTH_DEFAULT_SCOPES).toContain("accounting.transactions");
    expect(OAUTH_DEFAULT_SCOPES).toContain("accounting.contacts");
    expect(OAUTH_DEFAULT_SCOPES).toContain("accounting.settings");
    expect(OAUTH_DEFAULT_SCOPES).toContain("accounting.attachments");
  });
});

describe("persistence round-trip", () => {
  let backupContents: string | null = null;

  beforeEach(async () => {
    // If the real token file exists, back it up so tests don't nuke it
    try {
      backupContents = await fs.promises.readFile(TOKEN_FILE, "utf8");
    } catch {
      backupContents = null;
    }
  });

  afterEach(async () => {
    // Restore original state
    if (backupContents !== null) {
      await fs.promises.writeFile(TOKEN_FILE, backupContents, { mode: 0o600 });
    } else {
      try {
        await fs.promises.unlink(TOKEN_FILE);
      } catch {
        /* ignore */
      }
    }
  });

  it("save then load returns equivalent data", async () => {
    const data = {
      token_set: {
        access_token: "at_" + Math.random(),
        refresh_token: "rt_" + Math.random(),
        expires_in: 1800,
        token_type: "Bearer",
      } as never,
      tenant_id: "a8908f1c-4f2b-4b8e-9c8d-1234567890ab",
      tenant_name: "Test Org",
      updated_at: Date.now(),
    };

    await savePersistedToken(data);
    const loaded = await loadPersistedToken();
    expect(loaded).not.toBeNull();
    expect(loaded!.tenant_id).toBe(data.tenant_id);
    expect(loaded!.tenant_name).toBe(data.tenant_name);
    expect(loaded!.token_set).toEqual(data.token_set);
  });

  it("loadPersistedToken returns null when file doesn't exist", async () => {
    // Ensure file is gone
    try {
      await fs.promises.unlink(TOKEN_FILE);
    } catch {
      /* already gone */
    }
    const loaded = await loadPersistedToken();
    expect(loaded).toBeNull();
  });

  it("saved file has 0600 mode", async () => {
    const data = {
      token_set: { access_token: "x" } as never,
      tenant_id: "a8908f1c-4f2b-4b8e-9c8d-1234567890ab",
      updated_at: Date.now(),
    };
    await savePersistedToken(data);
    const stat = await fs.promises.stat(TOKEN_FILE);
    // On macOS and Linux, compare the permission bits
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("writes under ~/.xero-mcp/", () => {
    expect(TOKEN_FILE.startsWith(path.join(os.homedir(), ".xero-mcp"))).toBe(
      true,
    );
  });
});
