import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";

const UPDATE_CACHE_DIR = path.join(os.homedir(), ".xero-mcp");
const UPDATE_CACHE_FILE = path.join(UPDATE_CACHE_DIR, "update-check.json");
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_TIMEOUT_MS = 5000;
const GITHUB_API = "https://api.github.com/repos/d4m14ndx/xero-mcp-server/releases/latest";

export interface UpdateCheck {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url?: string;
  release_name?: string;
  published_at?: string;
  release_notes?: string;
  checked_at: string;
  from_cache: boolean;
}

interface CachedEntry {
  latest_version: string;
  release_url?: string;
  release_name?: string;
  published_at?: string;
  release_notes?: string;
  checked_at: number;
}

export function getCurrentVersion(): string {
  try {
    // Resolve package.json relative to the compiled dist/ directory
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Compare two semver strings. Returns positive if a > b, negative if a < b, 0
 * if equal. Handles `X.Y.Z` and `vX.Y.Z` forms. Pre-release tags
 * (`-alpha`, `-beta.1`) are treated as less than the matching release.
 */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.replace(/^v/, "");
  const parse = (v: string) => {
    const [core, pre] = norm(v).split("-", 2);
    const nums = core.split(".").map((n) => {
      const parsed = parseInt(n, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
    while (nums.length < 3) nums.push(0);
    return { nums, pre };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    if (A.nums[i] !== B.nums[i]) return A.nums[i] - B.nums[i];
  }
  // Same core version
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) return A.pre < B.pre ? -1 : A.pre > B.pre ? 1 : 0;
  return 0;
}

async function loadCache(): Promise<CachedEntry | null> {
  try {
    const raw = await fs.promises.readFile(UPDATE_CACHE_FILE, "utf8");
    return JSON.parse(raw) as CachedEntry;
  } catch {
    return null;
  }
}

async function saveCache(entry: CachedEntry): Promise<void> {
  await fs.promises.mkdir(UPDATE_CACHE_DIR, { recursive: true });
  const tmp = `${UPDATE_CACHE_FILE}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(entry, null, 2), {
    mode: 0o600,
  });
  await fs.promises.rename(tmp, UPDATE_CACHE_FILE);
}

interface GithubRelease {
  tag_name: string;
  name?: string;
  html_url: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

async function fetchLatestRelease(timeoutMs: number): Promise<GithubRelease> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GITHUB_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "xero-mcp-server",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`GitHub API returned HTTP ${res.status}`);
    }
    return (await res.json()) as GithubRelease;
  } finally {
    clearTimeout(t);
  }
}

export async function checkForUpdates(options?: {
  force?: boolean;
  ttlMs?: number;
  timeoutMs?: number;
}): Promise<UpdateCheck> {
  const current = getCurrentVersion();
  const ttl = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = Date.now();

  const cached = await loadCache();
  const cacheFresh = cached && now - cached.checked_at < ttl && !options?.force;

  if (cacheFresh && cached) {
    return {
      current_version: current,
      latest_version: cached.latest_version,
      update_available: compareVersions(cached.latest_version, current) > 0,
      release_url: cached.release_url,
      release_name: cached.release_name,
      published_at: cached.published_at,
      release_notes: cached.release_notes,
      checked_at: new Date(cached.checked_at).toISOString(),
      from_cache: true,
    };
  }

  const release = await fetchLatestRelease(timeout);
  const tag = release.tag_name ?? "v0.0.0";
  const normalised = tag.replace(/^v/, "");
  const entry: CachedEntry = {
    latest_version: normalised,
    release_url: release.html_url,
    release_name: release.name || tag,
    published_at: release.published_at,
    release_notes: (release.body || "").slice(0, 2000),
    checked_at: now,
  };
  await saveCache(entry);

  return {
    current_version: current,
    latest_version: normalised,
    update_available: compareVersions(normalised, current) > 0,
    release_url: entry.release_url,
    release_name: entry.release_name,
    published_at: entry.published_at,
    release_notes: entry.release_notes,
    checked_at: new Date(now).toISOString(),
    from_cache: false,
  };
}

export const __testing__ = {
  UPDATE_CACHE_FILE,
  loadCache,
  saveCache,
};
