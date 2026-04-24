# Contributing

Thanks for your interest in improving xero-mcp-server.

## Development setup

```bash
git clone https://github.com/d4m14ndx/xero-mcp-server.git
cd xero-mcp-server
npm install
cp .env.example .env   # fill in XERO_CLIENT_ID + XERO_CLIENT_SECRET for live testing
npm run build
```

For live testing you'll need a Xero Custom Connection — see the README quickstart.

## Project layout

```
src/
├── client.ts          # XeroClient wrapper + token cache (getXeroClient, TENANT_ID)
├── common.ts          # Shared Zod schemas, formatting, error helpers
├── index.ts           # MCP server entry point — register* calls live here
└── tools/
    ├── invoices.ts    # ACCREC + ACCPAY invoice/bill tools
    ├── payments.ts
    ├── bank.ts
    ├── contacts.ts
    ├── reference.ts
    ├── attachments.ts
    └── billable.ts    # Local JSON-backed billable-expenses workflow
```

One file per Xero domain. To add a new tool:

1. Pick the right `tools/*.ts` file (or create a new one for a new domain).
2. Use `server.registerTool(...)` with a Zod input schema, a thorough `description` explaining when to use it, and `annotations` (`readOnlyHint`, `destructiveHint`, etc.) that match reality.
3. Wrap the Xero SDK call in `try/catch` and return `formatError(err)` from `common.ts` on failure.
4. Pass `TENANT_ID` (empty string for Custom Connections) as the first arg to every accountingApi method.
5. If you created a new file, add a `register*` call in `src/index.ts` and list the tool in `manifest.json`.

## Style

- Strict TypeScript (`"strict": true` in tsconfig).
- Zod schemas use `.strict()` where practical and `.describe()` on every field — descriptions are what Claude reads to pick the right tool.
- No unnecessary `any`. Use `unknown` or proper generics. Xero SDK types sometimes need casts for enums — that's fine.
- Async/await everywhere; no promise chains.
- Keep tool descriptions honest about side effects and preconditions. Good error messages beat good code.

## Adding a new Xero scope

1. Add the scope to the Xero Custom Connection in the developer portal (requires the org admin to reauthorise — this disconnects the org briefly).
2. If you want env-driven overrides, the server already reads `XERO_SCOPES` (space-separated). Update the default list in `src/client.ts` if the new scope is essential.
3. Document the new scope in the README's "Token handling & scopes" table.

## Testing

Vitest-based suite — run `npm test` from the repo root. `npm run test:watch` re-runs on file changes, `npm run test:coverage` generates an HTML + lcov report.

### Categories

- **Pure helpers** (`test/common.test.ts`) — `compact`, `formatMoney`, `formatError`, `jsonResult`, `markdownResult`, Zod schema behaviour.
- **Client state** (`test/client.test.ts`) — `getAuthMode`, `hasCredentials`, `tenantId()` override logic, `XeroSetupRequiredError`. Tests dynamic-import the module and restore env between cases.
- **OAuth helpers** (`test/oauth.test.ts`) — `parseRedirectUri`, token-file round-trip, file permissions. Backs up and restores any real `~/.xero-mcp/oauth-tokens.json` on your machine during the run.
- **Tool registration** (`test/tools-register.test.ts`) — every tool has `title`, `description`, `annotations`; names are snake_case + prefixed; no duplicates; total count matches the README.
- **Help + tenant handlers** (`test/help-tool.test.ts`, `test/tenant-tools.test.ts`) — verify setup help works without credentials and tenant tools fail gracefully in custom_connection mode.

### Adding a test

- One `describe` block per function or behaviour area.
- If the test touches `process.env`, save and restore the relevant keys in `beforeEach` / `afterEach`.
- If the test needs Xero, mock the SDK — don't hit the live API from CI. The `scripts/smoke-test.mjs` script is the escape hatch for live checks (env-gated, run manually).

### CI

GitHub Actions runs `npm run build && npm test` against Node 20, 22, and 24 on every push and PR — see `.github/workflows/ci.yml`. Keep the test run fast (currently <1s total).

## Releasing

Maintainers only — tagging a version runs the release workflow automatically.

```bash
# Bump version in package.json AND manifest.json (keep them in sync)
git commit -am "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

GitHub Actions handles building and attaching the `.dxt` to the release.

## Ideas / wishlist

- Standard OAuth 2.0 flow (browser consent + refresh token persistence) as an alternative to Custom Connection.
- Payroll tools (timesheets, pay runs).
- Reports and budgets.
- Multi-tenant support with a tenant picker tool.
- Proper unit tests.

PRs welcome on any of these.
