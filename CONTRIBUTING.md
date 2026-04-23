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

There's currently no formal test suite. Contributions that add one are welcome. For now:

- `npm run build` must succeed without errors or warnings.
- `npm run inspector` must start and list every tool.
- `node scripts/smoke-test.mjs` should return your org name and bank accounts (requires env vars).

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
