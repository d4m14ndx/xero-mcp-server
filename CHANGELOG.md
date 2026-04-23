# Changelog

All notable changes to this project are documented here. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses [Semantic Versioning](https://semver.org/).

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

[0.2.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.2.0
[0.1.0]: https://github.com/d4m14ndx/xero-mcp-server/releases/tag/v0.1.0
