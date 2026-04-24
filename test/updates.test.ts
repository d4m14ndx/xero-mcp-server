import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import {
  __testing__,
  checkForUpdates,
  compareVersions,
  getCurrentVersion,
} from "../src/updates.js";

describe("compareVersions", () => {
  it("treats equal versions as 0", () => {
    expect(compareVersions("0.5.0", "0.5.0")).toBe(0);
  });

  it("strips leading v", () => {
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("handles major bumps", () => {
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("handles minor bumps", () => {
    expect(compareVersions("0.6.0", "0.5.99")).toBeGreaterThan(0);
  });

  it("handles patch bumps", () => {
    expect(compareVersions("0.5.1", "0.5.0")).toBeGreaterThan(0);
  });

  it("treats pre-release as lower than release", () => {
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
  });

  it("orders pre-release tags", () => {
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  });

  it("handles missing patch/minor", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("getCurrentVersion", () => {
  it("reads a non-empty semver-ish string from package.json", () => {
    const v = getCurrentVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("checkForUpdates", () => {
  let backup: string | null = null;

  beforeEach(async () => {
    try {
      backup = await fs.promises.readFile(__testing__.UPDATE_CACHE_FILE, "utf8");
      await fs.promises.unlink(__testing__.UPDATE_CACHE_FILE);
    } catch {
      backup = null;
    }
  });

  afterEach(async () => {
    if (backup !== null) {
      await fs.promises.writeFile(__testing__.UPDATE_CACHE_FILE, backup, {
        mode: 0o600,
      });
    } else {
      try {
        await fs.promises.unlink(__testing__.UPDATE_CACHE_FILE);
      } catch {
        /* ignore */
      }
    }
    vi.restoreAllMocks();
  });

  it("hits the network when no cache exists, then writes the cache", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: "v99.0.0",
          name: "v99",
          html_url: "https://example.test/r/v99",
          body: "release notes",
          published_at: "2026-04-24T00:00:00Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const r = await checkForUpdates();
    expect(spy).toHaveBeenCalledOnce();
    expect(r.latest_version).toBe("99.0.0");
    expect(r.update_available).toBe(true);
    expect(r.from_cache).toBe(false);
    expect(r.release_url).toBe("https://example.test/r/v99");

    const cache = await __testing__.loadCache();
    expect(cache).not.toBeNull();
    expect(cache!.latest_version).toBe("99.0.0");
  });

  it("serves from cache on second call within TTL", async () => {
    await __testing__.saveCache({
      latest_version: "1.2.3",
      release_url: "https://example.test/r/1.2.3",
      release_name: "v1.2.3",
      release_notes: "notes",
      checked_at: Date.now(),
    });
    const spy = vi.spyOn(globalThis, "fetch");
    const r = await checkForUpdates();
    expect(spy).not.toHaveBeenCalled();
    expect(r.from_cache).toBe(true);
    expect(r.latest_version).toBe("1.2.3");
  });

  it("bypasses cache with force=true", async () => {
    await __testing__.saveCache({
      latest_version: "1.0.0",
      checked_at: Date.now(),
    });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: "v2.0.0", html_url: "https://x.test/" }),
        { status: 200 },
      ),
    );
    const r = await checkForUpdates({ force: true });
    expect(spy).toHaveBeenCalledOnce();
    expect(r.latest_version).toBe("2.0.0");
  });

  it("refreshes when cache is older than TTL", async () => {
    await __testing__.saveCache({
      latest_version: "1.0.0",
      checked_at: Date.now() - 24 * 60 * 60 * 1000, // 24 h ago
    });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: "v3.0.0", html_url: "https://x.test/" }),
        { status: 200 },
      ),
    );
    const r = await checkForUpdates({ ttlMs: 6 * 60 * 60 * 1000 });
    expect(spy).toHaveBeenCalledOnce();
    expect(r.latest_version).toBe("3.0.0");
  });

  it("throws on non-200 from GitHub", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 403 }),
    );
    await expect(checkForUpdates()).rejects.toThrow(/HTTP 403/);
  });

  it("flags update_available=false when versions match", async () => {
    const current = getCurrentVersion();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: `v${current}`, html_url: "https://x.test/" }),
        { status: 200 },
      ),
    );
    const r = await checkForUpdates();
    expect(r.update_available).toBe(false);
  });
});
