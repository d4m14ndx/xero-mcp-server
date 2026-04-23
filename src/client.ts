import { XeroClient, TokenSet } from "xero-node";

const DEFAULT_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
];

const REFRESH_GUARD_SECONDS = 60;

let clientPromise: Promise<XeroClient> | null = null;
let cachedToken: TokenSet | null = null;
let tokenExpiresAt = 0;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Set it in your shell, Claude Desktop config, or .env.`,
    );
  }
  return value;
}

function parseScopes(): string[] {
  const raw = process.env.XERO_SCOPES;
  if (!raw) return DEFAULT_SCOPES;
  return raw.split(/\s+/).filter(Boolean);
}

async function mintToken(client: XeroClient): Promise<TokenSet> {
  const token = await client.getClientCredentialsToken();
  cachedToken = token;
  const expiresIn = token.expires_in ?? 1800;
  tokenExpiresAt = Date.now() + (expiresIn - REFRESH_GUARD_SECONDS) * 1000;
  return token;
}

export async function getXeroClient(): Promise<XeroClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new XeroClient({
        clientId: requireEnv("XERO_CLIENT_ID"),
        clientSecret: requireEnv("XERO_CLIENT_SECRET"),
        grantType: "client_credentials",
        scopes: parseScopes(),
      });
      await mintToken(client);
      return client;
    })();
  }

  const client = await clientPromise;

  if (!cachedToken || Date.now() >= tokenExpiresAt) {
    await mintToken(client);
    client.setTokenSet(cachedToken!);
  } else {
    client.setTokenSet(cachedToken);
  }

  return client;
}

/**
 * Custom Connections scope a token to a single tenant, so xeroTenantId can be
 * an empty string on every call. Kept as a named constant for clarity at call sites.
 */
export const TENANT_ID = "";
