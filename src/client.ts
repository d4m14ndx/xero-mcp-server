import { XeroClient, TokenSet } from "xero-node";
import {
  OAUTH_DEFAULT_SCOPES,
  loadPersistedToken,
  runOAuthFlow,
  savePersistedToken,
} from "./oauth.js";

const CUSTOM_CONNECTION_DEFAULT_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
];

const REFRESH_GUARD_SECONDS = 60;

export type AuthMode = "custom_connection" | "oauth";

export interface TenantInfo {
  tenant_id: string;
  tenant_name: string | null;
  tenant_type?: string;
  tenant_org_id?: string;
  created_date_utc?: string;
  updated_date_utc?: string;
}

/**
 * Thrown when credentials are missing or invalid. Tool handlers should catch
 * this and return a helpful error that points at xero_get_setup_help.
 */
export class XeroSetupRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XeroSetupRequiredError";
  }
}

let clientPromise: Promise<XeroClient> | null = null;
let cachedAuthMode: AuthMode | null = null;
let cachedToken: TokenSet | null = null;
let tokenExpiresAt = 0;
let resolvedTenantId = "";
let cachedTenants: TenantInfo[] = [];

export function hasCredentials(): boolean {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new XeroSetupRequiredError(
      `Xero credentials not configured: ${name} is not set. Call xero_get_setup_help to see setup instructions for either the free OAuth 2.0 flow (multi-tenant) or the paid Custom Connection (single-tenant, no browser).`,
    );
  }
  return value;
}

export function getAuthMode(): AuthMode {
  const raw = (process.env.XERO_AUTH_MODE || "custom_connection").toLowerCase();
  if (raw !== "custom_connection" && raw !== "oauth") {
    throw new Error(
      `Invalid XERO_AUTH_MODE=${raw}. Must be 'custom_connection' (default) or 'oauth'.`,
    );
  }
  return raw as AuthMode;
}

function parseScopes(envName: string, fallback: string[]): string[] {
  const raw = process.env[envName];
  if (!raw) return fallback;
  return raw.split(/\s+/).filter(Boolean);
}

function setTokenExpiry(token: TokenSet) {
  const expiresIn = token.expires_in ?? 1800;
  tokenExpiresAt = Date.now() + (expiresIn - REFRESH_GUARD_SECONDS) * 1000;
}

async function initCustomConnection(): Promise<XeroClient> {
  const scopes = parseScopes("XERO_SCOPES", CUSTOM_CONNECTION_DEFAULT_SCOPES);
  const client = new XeroClient({
    clientId: requireEnv("XERO_CLIENT_ID"),
    clientSecret: requireEnv("XERO_CLIENT_SECRET"),
    grantType: "client_credentials",
    scopes,
  });
  const token = await client.getClientCredentialsToken();
  cachedToken = token;
  setTokenExpiry(token);
  resolvedTenantId = "";
  cachedTenants = [];
  return client;
}

async function refreshCustomConnectionToken(client: XeroClient): Promise<void> {
  const token = await client.getClientCredentialsToken();
  cachedToken = token;
  setTokenExpiry(token);
}

async function initOAuth(): Promise<XeroClient> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const scopes = parseScopes("XERO_SCOPES", OAUTH_DEFAULT_SCOPES);
  const preferredTenantId = process.env.XERO_TENANT_ID || undefined;

  let persisted = await loadPersistedToken();
  if (!persisted) {
    console.error(
      "[xero-mcp] No stored OAuth tokens found. Starting interactive authorisation…",
    );
    persisted = await runOAuthFlow({
      clientId,
      clientSecret,
      scopes,
      preferredTenantId,
    });
  }

  const client = new XeroClient({
    clientId,
    clientSecret,
    scopes,
  });
  await client.initialize();
  client.setTokenSet(persisted.token_set);

  cachedToken = persisted.token_set;
  setTokenExpiry(persisted.token_set);
  resolvedTenantId = preferredTenantId || persisted.tenant_id;

  // Populate cached tenant list if available on the persisted record
  if (persisted.tenant_id) {
    cachedTenants = [
      {
        tenant_id: persisted.tenant_id,
        tenant_name: persisted.tenant_name ?? null,
      },
    ];
  }

  return client;
}

async function refreshOAuthToken(client: XeroClient): Promise<void> {
  try {
    const token = await client.refreshToken();
    cachedToken = token;
    setTokenExpiry(token);
    const existing = await loadPersistedToken();
    if (existing) {
      await savePersistedToken({
        ...existing,
        token_set: token,
        updated_at: Date.now(),
      });
    }
  } catch (err) {
    throw new XeroSetupRequiredError(
      `OAuth refresh failed: ${err instanceof Error ? err.message : String(err)}. The refresh token may have expired (60-day idle limit). Delete ~/.xero-mcp/oauth-tokens.json and re-authorise by running \`npm run auth\` or calling any tool. Call xero_get_setup_help for full instructions.`,
    );
  }
}

export async function getXeroClient(): Promise<XeroClient> {
  const mode = getAuthMode();
  if (cachedAuthMode && cachedAuthMode !== mode) {
    clientPromise = null;
    cachedToken = null;
    tokenExpiresAt = 0;
    resolvedTenantId = "";
    cachedTenants = [];
  }
  cachedAuthMode = mode;

  if (!clientPromise) {
    clientPromise = mode === "oauth" ? initOAuth() : initCustomConnection();
  }
  const client = await clientPromise;

  if (!cachedToken || Date.now() >= tokenExpiresAt) {
    if (mode === "oauth") {
      await refreshOAuthToken(client);
    } else {
      await refreshCustomConnectionToken(client);
    }
  }
  if (cachedToken) client.setTokenSet(cachedToken);
  return client;
}

/**
 * Tenant UUID to pass to accountingApi methods.
 * - Custom Connection: always empty string (token is already tenant-scoped).
 * - OAuth: the currently-selected tenant. Per-call override takes precedence.
 */
export function tenantId(override?: string | null): string {
  return (override && override.trim()) || resolvedTenantId;
}

export function currentAuthMode(): AuthMode | null {
  return cachedAuthMode;
}

export function currentTenantInfo(): TenantInfo | null {
  if (!resolvedTenantId) return null;
  const match = cachedTenants.find((t) => t.tenant_id === resolvedTenantId);
  return match ?? { tenant_id: resolvedTenantId, tenant_name: null };
}

/**
 * Force the OAuth consent flow to run again. Replaces the stored token set
 * with a fresh one covering whatever orgs the user ticks during consent — the
 * natural way to add new Xero clients without deleting the config file.
 *
 * Returns the before/after tenant lists so the caller can show what's new.
 */
export async function reauthorizeOAuth(): Promise<{
  added: TenantInfo[];
  removed: TenantInfo[];
  current: TenantInfo[];
}> {
  if (getAuthMode() !== "oauth") {
    throw new Error(
      "Reauthorise only works in OAuth mode. Custom Connections are single-tenant by design — to connect another org create a second Custom Connection (and a separate MCP install).",
    );
  }
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const scopes = parseScopes("XERO_SCOPES", OAUTH_DEFAULT_SCOPES);
  const preferredTenantId = process.env.XERO_TENANT_ID || undefined;

  const before = [...cachedTenants];
  await runOAuthFlow({ clientId, clientSecret, scopes, preferredTenantId });

  // Reset and reload so the new tokens are picked up
  clientPromise = null;
  cachedToken = null;
  tokenExpiresAt = 0;
  cachedTenants = [];
  resolvedTenantId = "";
  await getXeroClient();
  const after = await refreshTenantList();

  const beforeIds = new Set(before.map((t) => t.tenant_id));
  const afterIds = new Set(after.map((t) => t.tenant_id));
  return {
    added: after.filter((t) => !beforeIds.has(t.tenant_id)),
    removed: before.filter((t) => !afterIds.has(t.tenant_id)),
    current: after,
  };
}

/**
 * Refresh the list of tenants authorised under the current OAuth token. No-op
 * for Custom Connection (single-tenant by design). Returns the cached list.
 */
export async function refreshTenantList(): Promise<TenantInfo[]> {
  if (getAuthMode() !== "oauth") {
    return cachedTenants;
  }
  const client = await getXeroClient();
  await client.updateTenants(false);
  const raw = (client.tenants ?? []) as Array<{
    tenantId: string;
    tenantName?: string;
    tenantType?: string;
    tenantOrgId?: string;
    createdDateUtc?: string;
    updatedDateUtc?: string;
  }>;
  cachedTenants = raw.map((t) => ({
    tenant_id: t.tenantId,
    tenant_name: t.tenantName ?? null,
    tenant_type: t.tenantType,
    tenant_org_id: t.tenantOrgId,
    created_date_utc: t.createdDateUtc,
    updated_date_utc: t.updatedDateUtc,
  }));
  return cachedTenants;
}

/**
 * Switch the current active tenant. Persists the selection to the OAuth token
 * file so it survives restarts. Only valid in OAuth mode.
 */
export async function setCurrentTenant(newTenantId: string): Promise<TenantInfo> {
  if (getAuthMode() !== "oauth") {
    throw new Error(
      "Cannot switch tenants in custom_connection mode — the token is scoped to one organisation. Use OAuth mode for multi-tenant. Call xero_get_setup_help for setup instructions.",
    );
  }
  const tenants = await refreshTenantList();
  const match = tenants.find((t) => t.tenant_id === newTenantId);
  if (!match) {
    throw new Error(
      `tenant_id ${newTenantId} is not in the list of authorised orgs. Call xero_list_tenants to see available options, or re-run the OAuth consent to add more.`,
    );
  }
  resolvedTenantId = match.tenant_id;

  // Persist to OAuth token file so restarts pick it up
  const existing = await loadPersistedToken();
  if (existing) {
    await savePersistedToken({
      ...existing,
      tenant_id: match.tenant_id,
      tenant_name: match.tenant_name ?? undefined,
      updated_at: Date.now(),
    });
  }
  return match;
}
