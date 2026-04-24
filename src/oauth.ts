import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { URL } from "url";
import { XeroClient, TokenSet } from "xero-node";
import open from "open";

export const TOKEN_DIR = path.join(os.homedir(), ".xero-mcp");
export const TOKEN_FILE = path.join(TOKEN_DIR, "oauth-tokens.json");
export const DEFAULT_REDIRECT_URI = "http://localhost:5555/callback";

export const OAUTH_DEFAULT_SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "accounting.attachments",
  "offline_access",
];

export interface PersistedOAuthToken {
  token_set: TokenSet;
  tenant_id: string;
  tenant_name?: string;
  updated_at: number;
}

export async function loadPersistedToken(): Promise<PersistedOAuthToken | null> {
  try {
    const raw = await fs.promises.readFile(TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as PersistedOAuthToken;
    if (!parsed.token_set || !parsed.tenant_id) return null;
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function savePersistedToken(data: PersistedOAuthToken): Promise<void> {
  await fs.promises.mkdir(TOKEN_DIR, { recursive: true });
  const tmp = `${TOKEN_FILE}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.promises.rename(tmp, TOKEN_FILE);
}

export function parseRedirectUri(): {
  uri: string;
  port: number;
  pathname: string;
} {
  const uri = process.env.XERO_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const url = new URL(uri);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(
      `XERO_OAUTH_REDIRECT_URI must be a localhost URL for this server. Got: ${uri}`,
    );
  }
  return {
    uri,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    pathname: url.pathname || "/callback",
  };
}

/**
 * Run the interactive OAuth dance: open browser to Xero consent, spin up a
 * temporary HTTP listener on the redirect URI port, exchange the callback code
 * for a TokenSet, resolve tenants, persist, and return.
 *
 * Times out after 5 minutes.
 */
export async function runOAuthFlow(options: {
  clientId: string;
  clientSecret: string;
  scopes?: string[];
  preferredTenantId?: string;
  logger?: (msg: string) => void;
  timeoutMs?: number;
}): Promise<PersistedOAuthToken> {
  const log = options.logger ?? ((m) => console.error(m));
  const scopes = options.scopes ?? OAUTH_DEFAULT_SCOPES;
  const timeout = options.timeoutMs ?? 5 * 60_000;
  const { uri: redirectUri, port, pathname } = parseRedirectUri();

  const xero = new XeroClient({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUris: [redirectUri],
    scopes,
  });
  await xero.initialize();
  const consentUrl = await xero.buildConsentUrl();

  return await new Promise<PersistedOAuthToken>((resolve, reject) => {
    let settled = false;
    const server = http.createServer(async (req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      if (url.pathname !== pathname) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      try {
        const tokenSet = await xero.apiCallback(`${redirectUri}${url.search}`);
        await xero.updateTenants(false);
        const tenants = xero.tenants;
        if (!tenants || tenants.length === 0) {
          throw new Error(
            "No tenants were authorised. Make sure you picked an org in the Xero consent screen.",
          );
        }

        let chosen =
          (options.preferredTenantId &&
            tenants.find((t) => t.tenantId === options.preferredTenantId)) ||
          tenants[0];

        const persisted: PersistedOAuthToken = {
          token_set: tokenSet,
          tenant_id: chosen.tenantId,
          tenant_name: chosen.tenantName,
          updated_at: Date.now(),
        };
        await savePersistedToken(persisted);

        const otherTenants =
          tenants.length > 1
            ? tenants.filter((t) => t.tenantId !== chosen.tenantId)
            : [];

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html>
<html><head><title>Xero MCP — authorised</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40em; margin: 4em auto; padding: 0 1em">
<h1>✓ Authorised</h1>
<p>Connected Xero organisation: <strong>${chosen.tenantName ?? chosen.tenantId}</strong>.</p>
${
  otherTenants.length
    ? `<p>You also have access to:</p><ul>${otherTenants
        .map(
          (t) =>
            `<li>${t.tenantName ?? t.tenantId} — <code>${t.tenantId}</code></li>`,
        )
        .join(
          "",
        )}</ul><p>To use a different one, set <code>XERO_TENANT_ID</code> to its UUID and re-authorise.</p>`
    : ""
}
<p>You can close this tab.</p>
</body></html>`);

        log(
          `Authorised ${chosen.tenantName ?? chosen.tenantId} (tenant_id=${chosen.tenantId}). Tokens saved to ${TOKEN_FILE}`,
        );
        if (otherTenants.length) {
          log(
            `Note: ${otherTenants.length} additional tenant(s) granted — using the first. Set XERO_TENANT_ID to pick a specific one.`,
          );
        }
        settled = true;
        server.close();
        resolve(persisted);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain");
        res.end(
          `Auth failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        settled = true;
        server.close();
        reject(err);
      }
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `Failed to bind local OAuth callback listener on ${redirectUri}: ${err.message}. Is another process using port ${port}?`,
          ),
        );
      }
    });

    server.listen(port, "127.0.0.1", () => {
      log(`OAuth callback listener on ${redirectUri}`);
      log(`Opening browser to Xero consent: ${consentUrl}`);
      open(consentUrl).catch((err) => {
        log(
          `Could not open browser automatically (${err.message}). Visit this URL manually:\n${consentUrl}`,
        );
      });
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          server.close();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `OAuth flow timed out after ${Math.round(timeout / 1000)}s. Start again with the tool call or \`npm run auth\`.`,
          ),
        );
      }
    }, timeout).unref();
  });
}
