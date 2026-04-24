# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/).

## [0.6.0] — 2026-04-24

### Added
- **`xero_authorize_new_tenant`** — trigger the Xero OAuth consent flow from inside Claude to add new client orgs. No more manually deleting `~/.xero-mcp/oauth-tokens.json`. The tool reports which tenants were added, which were removed, and the full current list after the consent completes.
- **`xero_check_for_updates`** — hits the GitHub releases API, compares with the installed version, returns release notes + download link. Result cached in `~/.xero-mcp/update-check.json` for 6 hours to avoid hammering GitHub; pass `force=true` to bypass.
- **`xero_version`** — report the installed version. Small but handy during debugging.
- Polished the `xero_set_current_tenant` description so natural phrasings ("switch to Acme", "I want to work on <client>'s books") reliably land on it.

### Changed
- `reauthorizeOAuth()` helper in `src/client.ts` — resets all cached state and re-runs the OAuth consent flow. Used by `xero_authorize_new_tenant`.
- Tool count: 29.

## [0.5.0] — 2026-04-24

### Added
- **Vitest test suite** — 64 tests across 6 files. Covers pure helpers, client state, OAuth redirect parsing + token persistence round-trip, tool registration completeness, and handler behaviour for help + tenant tools.
- `npm test`, `npm run test:watch`, `npm run test:coverage` scripts.
- **CI workflow** (`.github/workflows/ci.yml`) — builds and runs tests against Node 18, 20, and 22 on every push and PR.
- CI badge at the top of the README.

### Changed
- `scripts/smoke-test.mjs` updated to use the new `tenantId()` export.
- `CONTRIBUTING.md` expanded with test categories, how to add a test, and CI notes.

## [0.4.0] — 2026-04-24

### Added
- **`xero_get_setup_help` tool** — always-available guide that walks the user through both setup paths (free OAuth 2.0 / paid Custom Connection). Works even when the server has no credentials configured, so first-time users can ask Claude "how do I set up Xero?" and get a complete answer.
- **Multi-tenant support for bookkeepers**:
  - `xero_list_tenants` — enumerate every Xero org authorised under the current OAuth consent.
  - `xero_get_current_tenant` — report which org is active plus auth mode.
  - `xero_set_current_tenant` — switch the active org. Persists to disk; survives restart.
- Server now **starts without credentials** — previously it exited immediately. The help tool and tenant tools remain callable; other tools return an actionable error pointing at `xero_get_setup_help`.

### Changed
- `tenantId()` in `src/client.ts` now accepts an optional override. Common schema fragment `TenantOverrideSchema` added to `common.ts` for future per-call tenant targeting on individual tools.
- `formatError` recognises `XeroSetupRequiredError` and adds a pointer to `xero_get_setup_help`.
- DXT manifest advertises the 4 new tools.

## [0.3.0] — 2026-04-24

### Added
- **OAuth 2.0 authorization-code auth mode** as an alternative to Custom Connection (`XERO_AUTH_MODE=oauth`). Free Xero dev plan, browser consent once, refresh-token persisted to `~/.xero-mcp/oauth-tokens.json`. First tool call after install opens the browser automatically; subsequent calls auto-refresh.
- `npm run auth` — CLI script that runs the OAuth dance manually to pre-seed the token file.
- `XERO_TENANT_ID` env var — pick a specific Xero org when the OAuth consent grants access to multiple.
- `XERO_OAUTH_REDIRECT_URI` env var — override the default `http://localhost:5555/callback` redirect.

### Changed
- `TENANT_ID` constant removed from public API in favour of a `tenantId()` function that resolves to empty string (Custom Connection) or the selected tenant UUID (OAuth).
- DXT manifest now exposes `xero_auth_mode` and `xero_tenant_id` as optional install-time config.

### Fixed
- n/a

## [0.2.0] — 2026-04-23

### Added
- `xero_attach_file_to_invoice_or_bill` — attach a local PDF / image / doc to an invoice or bill (up to 25 MB).
- `xero_list_invoice_attachments` — list files attached to an invoice or bill.
- Billable-expense workflow (local JSON store at `~/.xero-mcp/billable-expenses.json`):
  - `xero_flag_bill_line_as_billable` — mark a bill line as billable to a client, optional markup.
  - `xero_list_billable_expenses` — list pending or billed expenses, filter by client.
  - `xero_generate_invoice_from_billable_expenses` — roll up a client's pending expenses into one ACCREC invoice.
  - `xero_unflag_billable_expense` — delete or revert a record.
- DXT manifest (`manifest.json`) — the server can be installed as a one-click Claude Desktop extension.
- GitHub Actions release workflow — tag-triggered DXT builds attached to releases.

### Changed
- README rewrite with quickstart, table of contents, workflow diagram.
- MCP server version bumped to 0.2.0.

## [0.1.0] — 2026-04-23

### Added
- Initial release: 16 MCP tools covering Xero invoicing, bills, payments, bank transactions, contacts, chart of accounts, tax rates, org info.
- Xero Custom Connection (OAuth2 `client_credentials`) auth with in-memory token caching and auto-refresh.
- Built on official `xero-node` SDK.

[0.6.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.6.0
[0.5.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.5.0
[0.4.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.4.0
[0.3.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.3.0
[0.2.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.2.0
[0.1.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.1.0
