#!/usr/bin/env node
/**
 * One-time OAuth setup: open browser, complete Xero consent, save tokens to
 * ~/.xero-mcp/oauth-tokens.json so the MCP server can start without prompting.
 *
 * Usage:
 *   XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... npm run auth
 *   (optionally set XERO_OAUTH_REDIRECT_URI, XERO_SCOPES, XERO_TENANT_ID)
 */
import { runOAuthFlow } from "../dist/oauth.js";

async function main() {
  const clientId = process.env.XERO_CLIENT_ID;
  const clientSecret = process.env.XERO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "Set XERO_CLIENT_ID and XERO_CLIENT_SECRET before running this script.\n" +
      "These are the credentials of a standard Xero OAuth 2.0 app\n" +
      "(https://developer.xero.com/app/manage/ → New app → Web app).",
    );
    process.exit(1);
  }

  const preferredTenantId = process.env.XERO_TENANT_ID || undefined;
  const scopes = process.env.XERO_SCOPES
    ? process.env.XERO_SCOPES.split(/\s+/).filter(Boolean)
    : undefined;

  try {
    await runOAuthFlow({
      clientId,
      clientSecret,
      scopes,
      preferredTenantId,
      logger: (m) => console.log(m),
    });
    console.log("Done. You can now start the MCP server with XERO_AUTH_MODE=oauth.");
    process.exit(0);
  } catch (err) {
    console.error("Auth failed:", err?.message ?? err);
    process.exit(1);
  }
}

main();
