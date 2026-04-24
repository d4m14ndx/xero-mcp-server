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

let clientPromise: Promise<XeroClient> | null = null;
let cachedAuthMode: AuthMode | null = null;
let cachedToken: TokenSet | null = null;
let tokenExpiresAt = 0;
let resolvedTenantId = "";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Set it in your shell, Claude Desktop config, or .env.`,
    );
  }
  return value;
}

function getAuthMode(): AuthMode {
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

/**
 * Custom Connection (client_credentials) mode: mint a fresh token on demand.
 */
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
  resolvedTenantId = ""; // Custom Connections: tenant scoped by token
  return client;
}

async function refreshCustomConnectionToken(client: XeroClient): Promise<void> {
  const token = await client.getClientCredentialsToken();
  cachedToken = token;
  setTokenExpiry(token);
}

/**
 * OAuth (authorization_code + refresh_token) mode. Loads tokens from disk, or
 * runs the interactive browser consent dance on first use.
 */
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
    // Authorization code flow doesn't need a redirectUri at refresh time
  });
  await client.initialize();
  client.setTokenSet(persisted.token_set);

  cachedToken = persisted.token_set;
  setTokenExpiry(persisted.token_set);
  resolvedTenantId = preferredTenantId || persisted.tenant_id;

  return client;
}

async function refreshOAuthToken(client: XeroClient): Promise<void> {
  try {
    const token = await client.refreshToken();
    cachedToken = token;
    setTokenExpiry(token);
    // Persist rotated refresh_token
    const existing = await loadPersistedToken();
    if (existing) {
      await savePersistedToken({
        ...existing,
        token_set: token,
        updated_at: Date.now(),
      });
    }
  } catch (err) {
    throw new Error(
      `OAuth refresh failed: ${err instanceof Error ? err.message : String(err)}. The refresh token may have expired (60-day idle limit). Delete ~/.xero-mcp/oauth-tokens.json and re-authorise with \`npm run auth\` or by triggering any tool.`,
    );
  }
}

export async function getXeroClient(): Promise<XeroClient> {
  const mode = getAuthMode();
  if (cachedAuthMode && cachedAuthMode !== mode) {
    // Auth mode changed between calls — reset client
    clientPromise = null;
    cachedToken = null;
    tokenExpiresAt = 0;
    resolvedTenantId = "";
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
 * Returns the tenant UUID to pass as the first argument to every accountingApi
 * method. For Custom Connections this is an empty string (the token is already
 * tenant-scoped). For OAuth it's the tenant selected during consent (override
 * with XERO_TENANT_ID).
 */
export function tenantId(): string {
  return resolvedTenantId;
}

/**
 * @deprecated use tenantId() instead. Kept for backward source compatibility;
 * always returns the empty string now. Do not rely on this in new code.
 */
export const TENANT_ID = "";
