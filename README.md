# xero-mcp-server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-brightgreen)](https://modelcontextprotocol.io/)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-DXT-orange)](https://github.com/anthropics/dxt)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-green)](https://nodejs.org/)

**Drive your Xero accounting from Claude.** An MCP (Model Context Protocol) server exposing 26 Xero tools — create invoices and bills, record payments, attach PDFs, reconcile bank transactions, flag billable client expenses, roll them up into invoices later, and (for bookkeepers) switch between multiple client orgs under one OAuth consent.

Built on the official [`xero-node`](https://github.com/XeroAPI/xero-node) SDK with two auth modes:

- **Xero Custom Connection** (`client_credentials`) — single-tenant, no browser. Paid Xero Developer plan required.
- **Standard OAuth 2.0** — browser consent once, refresh-token persisted, multi-tenant. Free.

> **New here?** Ask Claude _"How do I set up the Xero MCP?"_ — it'll call the built-in `xero_get_setup_help` tool and walk you through it. The help tool works before you've configured any credentials.

---

## Table of contents

- [Why](#why)
- [Tool reference](#tool-reference)
- [Quickstart](#quickstart)
  - [1. Create a Xero app](#1-create-a-xero-app)
  - [2. Install](#2-install)
  - [3. Wire into your MCP client](#3-wire-into-your-mcp-client)
  - [4. Verify](#4-verify)
- [Usage examples](#usage-examples)
- [Multi-tenant workflow (bookkeepers)](#multi-tenant-workflow-bookkeepers)
- [Billable-expense workflow](#billable-expense-workflow)
- [Token handling & scopes](#token-handling--scopes)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Why

Xero's web UI is great for accountants and not great for anyone trying to enter a supplier bill at 11 PM. With this MCP installed, you just tell Claude what happened:

> "Enter the AWS invoice from Slack for $1,234.56, dated April 30. Attach the PDF from my Downloads folder. The $500 hosting line is billable to Acme Corp with 20% markup."

Claude handles the six Xero API calls: find the contact, look up the expense account, create the bill, attach the PDF, flag the billable line, save. End of month: "Invoice Acme for their April expenses" creates a sales invoice rolling up all their pending billable lines.

**For bookkeepers**: one OAuth consent grants access to every Xero org you already work with. Switch between client books with a single tool call — "Switch to Acme, run monthly reports, switch to Globex, enter this bill".

This server gives Claude every primitive needed for day-to-day AP/AR work without putting you through Xero's click-path.

---

## Tool reference

**26 tools in total.** Tools are grouped by domain below.

### Setup + multi-tenant
| Tool | What it does | Works without creds? |
|---|---|---|
| `xero_get_setup_help` | Step-by-step setup instructions (free OAuth 2.0 / paid Custom Connection) | ✓ |
| `xero_list_tenants` | Every Xero org authorised under the current OAuth consent |  |
| `xero_get_current_tenant` | Which org is active + auth mode |  |
| `xero_set_current_tenant` | Switch active org (OAuth only; persists to disk) |  |

### Reference data
| Tool | What it does |
|---|---|
| `xero_get_organisation` | Org name, base currency, timezone, FY end |
| `xero_list_accounts` | Chart of accounts (filter by type, incl. `BANK`) |
| `xero_list_tax_rates` | Tax rates for the org |
| `xero_search_contacts` | Search customers + suppliers |
| `xero_create_contact` | Create a new contact |

### Invoices (ACCREC) and bills (ACCPAY)
| Tool | What it does |
|---|---|
| `xero_list_invoices` | List sales invoices with filters |
| `xero_get_invoice` | Fetch one invoice by UUID or number |
| `xero_create_invoice` | Create a sales invoice (defaults to DRAFT) |
| `xero_update_invoice` | Approve / void / edit an invoice |
| `xero_list_bills` | List supplier bills |
| `xero_create_bill` | Create a supplier bill (defaults to DRAFT) |

### Payments and bank transactions
| Tool | What it does |
|---|---|
| `xero_create_payment` | Apply a payment to an invoice or bill |
| `xero_list_payments` | List payments |
| `xero_list_bank_transactions` | List spend/receive-money transactions |
| `xero_create_bank_transaction` | Record a spend or receive money entry |
| `xero_mark_bank_transaction_reconciled` | Flip the `is_reconciled` flag |

### Attachments
| Tool | What it does |
|---|---|
| `xero_attach_file_to_invoice_or_bill` | Attach a local PDF / image / doc (up to 25 MB) |
| `xero_list_invoice_attachments` | List files attached to an invoice or bill |

### Billable client expenses
Local JSON-backed workflow for re-billing supplier costs to clients. Xero's "Assign expense to customer" feature isn't exposed via the public API, so this tracks the mapping in `~/.xero-mcp/billable-expenses.json` and later generates real Xero sales invoices from the pending records.

| Tool | What it does |
|---|---|
| `xero_flag_bill_line_as_billable` | Mark a bill line as billable to a client, with optional markup |
| `xero_list_billable_expenses` | List pending or billed expenses (filter by client) |
| `xero_generate_invoice_from_billable_expenses` | Roll up a client's pending expenses into one ACCREC invoice |
| `xero_unflag_billable_expense` | Delete or revert a record (e.g. if the invoice was voided) |

### What's not covered

- **Bank-feed statement-line matching.** Xero's public API exposes creating spend/receive-money transactions and toggling `is_reconciled`, but the full "match statement line X to transaction Y" UI isn't exposed. For complex rec, use the Xero web app and call `xero_mark_bank_transaction_reconciled` once you've confirmed a match.
- **Payroll, reports, budgets, projects.** Not yet — the underlying SDK supports them; the scopes just aren't wired to MCP tools here. PRs welcome.
- **Native "Assign expense to customer".** Xero's UI supports this but the public API doesn't — we work around it with the local billable-expenses JSON store (see the [billable workflow](#billable-expense-workflow)).

---

## Quickstart

### 1. Create a Xero app

Pick one. The [`xero_get_setup_help`](#setup--multi-tenant) tool has these instructions too — you can install the server first and ask Claude to walk you through it.

#### Option A — Standard OAuth 2.0 (free, multi-tenant, recommended for bookkeepers)

A normal Xero OAuth app — free to register, supports multiple orgs under one consent, survives 60-day refresh-token inactivity windows.

1. Go to https://developer.xero.com/app/manage/ and click **New app** → **Web app**.
2. Give it a name and a company URL.
3. Set **Redirect URI** to `http://localhost:5555/callback` (matches the server's default; override with `XERO_OAUTH_REDIRECT_URI` if needed).
4. Add scopes:
   - `accounting.transactions`
   - `accounting.contacts`
   - `accounting.settings.read`
   - `accounting.attachments`
   - `offline_access` (**required** — grants the refresh token)
5. Copy the **Client ID** and **Client Secret** (shown once on creation).

At runtime, set `XERO_AUTH_MODE=oauth`. The server opens your browser on the first tool call, or run `npm run auth` to pre-seed tokens. After consent, use `xero_list_tenants` to see all authorised orgs and `xero_set_current_tenant` to switch between them.

#### Option B — Custom Connection (paid, single-tenant, no browser)

Xero's machine-to-machine auth: one organisation, no browser redirect, 30-minute tokens. Requires a paid Xero Developer plan (~USD $10/mo per connection).

1. Go to https://developer.xero.com/app/manage/ as a Xero org **admin**.
2. Click **New app** → **Custom connection**.
3. Name it (e.g. "Claude MCP"), select the Xero org.
4. Add scopes: `accounting.transactions`, `accounting.contacts`, `accounting.settings.read`, `accounting.attachments`.
5. Save. **Copy the Client ID and Client Secret immediately** — the secret is only shown once.
6. Approve the connection from the email Xero sends to the admin.

At runtime, leave `XERO_AUTH_MODE` unset (or `custom_connection`). The server mints a fresh token on the first tool call — no other steps.

### 2. Install

Three options — pick one.

#### A. DXT bundle (Claude Desktop, one-click)

Download `xero-mcp-server.dxt` from the [latest GitHub release](https://github.com/d4m14ndx/xero-mcp-server/releases/latest) and double-click it. Claude Desktop opens an install dialog that asks for the auth mode, Client ID, Secret, and (optional) tenant ID.

#### B. Build from source

```bash
git clone https://github.com/d4m14ndx/xero-mcp-server.git
cd xero-mcp-server
npm install
npm run build
```

The entry point after build is `dist/index.js`. For OAuth mode you can also pre-seed tokens via:

```bash
XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... npm run auth
```

#### C. Package your own DXT

After building:

```bash
zip -r xero-mcp-server.dxt manifest.json dist package.json node_modules \
  -x "node_modules/.cache/*" "node_modules/.package-lock.json"
```

### 3. Wire into your MCP client

#### Claude Desktop (via `claude_desktop_config.json`)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS — adjust for Windows/Linux):

```json
{
  "mcpServers": {
    "xero": {
      "command": "node",
      "args": ["/absolute/path/to/xero-mcp-server/dist/index.js"],
      "env": {
        "XERO_AUTH_MODE": "oauth",
        "XERO_CLIENT_ID": "YOUR_CLIENT_ID",
        "XERO_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

Drop `XERO_AUTH_MODE` (or set it to `custom_connection`) for Custom Connection mode. Fully quit and relaunch Claude.

#### Claude Code CLI

Add the same `mcpServers` block to `~/.claude.json` (user-level) or a project-level `.mcp.json`. Use the **absolute path to `node`** (`which node`) — Claude doesn't inherit your shell's `PATH`.

#### Ad-hoc / other MCP clients

```bash
XERO_AUTH_MODE=oauth XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... node dist/index.js
```

Then configure your client to spawn that command over stdio.

**Note**: from v0.4.0, the server starts even without credentials — `xero_get_setup_help` remains callable so a user without Xero access yet can still discover how to finish the install.

### 4. Verify

```bash
npm run inspector
```

Opens a browser where you can click through each tool. A quick sanity path:

1. `xero_get_setup_help` — should return markdown (works regardless of creds).
2. `xero_get_current_tenant` — confirms auth mode + current org once creds are set.
3. `xero_get_organisation` — first real Xero API call; proves auth works.

---

## Usage examples

Claude handles the tool orchestration — you just describe the outcome.

### Create a sales invoice

> Bill Acme Corp $500 for March consulting, due April 30.

```
xero_search_contacts(search_term="Acme Corp")           → contact_id
xero_list_accounts(type="REVENUE")                      → account_code
xero_list_tax_rates()                                    → tax_type
xero_create_invoice(contact_id, line_items=[{
    description: "March consulting",
    unit_amount: 500,
    account_code: "200",
    tax_type: "OUTPUT"
}], due_date: "2026-04-30", status: "AUTHORISED")
```

### Enter a bill with PDF attached

> Enter this AWS bill for $1,234.56 and attach `~/Downloads/aws-april.pdf`.

```
xero_search_contacts(search_term="Amazon Web Services")  → contact_id
xero_create_bill(contact_id, line_items=[...])           → invoice_id
xero_attach_file_to_invoice_or_bill(invoice_id, file_path="/Users/.../aws-april.pdf")
```

### Record a bank fee and mark it reconciled

> There's an unreconciled $50 bank fee from April 3. Code it to 404.

```
xero_list_bank_transactions(where="IsReconciled==false")
xero_create_bank_transaction(type="SPEND", bank_account_id, contact_id,
    line_items=[{description: "Bank fee", unit_amount: 50, account_code: "404"}],
    date: "2026-04-03")
xero_mark_bank_transaction_reconciled(bank_transaction_id)
```

### Get unstuck

> How do I set up Xero for this?

```
xero_get_setup_help(mode="both")   → full markdown guide
```

---

## Multi-tenant workflow (bookkeepers)

Only meaningful in OAuth mode — Custom Connections are hardwired to one org.

**Setup**: during the OAuth consent screen, Xero lets you tick every org you want to grant access to. Tick them all. The consent only happens once.

**Switching**: subsequent tools run against whichever tenant is "current". The current tenant is:

1. `XERO_TENANT_ID` env var (if set), OR
2. Whatever was last chosen via `xero_set_current_tenant` (persists to `~/.xero-mcp/oauth-tokens.json`), OR
3. The first tenant granted during consent.

### Typical bookkeeper session

> What client books do I have access to?

```
xero_list_tenants
  → { auth_mode: "oauth",
      current_tenant_name: "Acme Corp",
      tenants: [
        {tenant_id: "...", tenant_name: "Acme Corp",  is_current: true},
        {tenant_id: "...", tenant_name: "Globex LLC", is_current: false},
        {tenant_id: "...", tenant_name: "Initech",    is_current: false},
      ] }
```

> Switch to Globex and show me their unreconciled bank items.

```
xero_set_current_tenant(tenant_id="<globex uuid>")
xero_list_bank_transactions(where="IsReconciled==false")
```

> And Initech's draft bills.

```
xero_set_current_tenant(tenant_id="<initech uuid>")
xero_list_bills(statuses=["DRAFT"])
```

Tenants are persisted — if Claude Desktop restarts mid-session, the last-selected tenant is restored.

### Adding more tenants later

If you gain access to new Xero orgs after the initial consent, delete `~/.xero-mcp/oauth-tokens.json` and call any tool (or run `npm run auth`) to re-consent. The new orgs will appear in `xero_list_tenants` afterwards.

---

## Billable-expense workflow

The canonical AR/AP cross-over: a supplier charges you for something you'll rebill to a client.

```
┌──────────────────────────┐
│ Supplier bill (ACCPAY)   │
│  e.g. AWS, $500          │  ← xero_create_bill
│  Line: "EC2 for Acme"    │  ← xero_attach_file_to_invoice_or_bill (PDF)
└──────────┬───────────────┘
           │
           │  xero_flag_bill_line_as_billable
           │     client=Acme, markup=20%
           ▼
┌──────────────────────────┐
│ Local JSON store         │
│  ~/.xero-mcp/...         │
│  {pending, $600}         │
└──────────┬───────────────┘
           │
           │  xero_generate_invoice_from_billable_expenses
           │     client=Acme, status=AUTHORISED
           ▼
┌──────────────────────────┐
│ Sales invoice (ACCREC)   │
│  Acme, $600              │
│  Line: "EC2 for Acme"    │
└──────────────────────────┘
           │
           ▼
     Record marked {billed}
     with new invoice_id
```

If a generated sales invoice gets voided in Xero, call `xero_unflag_billable_expense` with `mode="revert_to_pending"` to move the record back to `pending` so it gets rolled into the next invoice.

> **Multi-tenant note**: the billable-expenses store is shared across tenants. Each record carries the `client_contact_id` (scoped to whichever org you were using when you flagged it). Switching tenants does not filter the store — list it with `xero_list_billable_expenses(client_contact_id=...)` to avoid confusion if you work across orgs.

---

## Token handling & scopes

### Custom Connection mode
- Access tokens last 30 minutes; server mints on first call, refreshes ~60 s before expiry. Held in memory only.
- Scopes are set at the Custom Connection level in the Xero developer portal, not per-request.

### OAuth mode
- Access tokens last 30 minutes; refresh tokens rotate on each refresh and survive 60 days of inactivity.
- Tokens persist to `~/.xero-mcp/oauth-tokens.json` (chmod 600). Delete that file to force a fresh consent (e.g. to add newly-granted orgs).
- First tool call after install opens your browser automatically. Alternatively, run `npm run auth` from the CLI.
- One token set can span multiple tenants — switch with `xero_set_current_tenant`.

### Required scopes

| Scope | Why |
|---|---|
| `accounting.transactions` | Invoices, bills, payments, bank transactions |
| `accounting.contacts` | Customers, suppliers |
| `accounting.settings.read` | Chart of accounts, tax rates, org info |
| `accounting.attachments` | PDF / image attachments on invoices & bills |
| `offline_access` | **OAuth mode only** — required for refresh tokens |

Override the default scope list with the `XERO_SCOPES="space separated list"` env var if needed.

---

## Environment variables

| Env var | Default | Effect |
|---|---|---|
| `XERO_CLIENT_ID` | — | Client ID from your Xero app. Required for any Xero call. |
| `XERO_CLIENT_SECRET` | — | Client secret from the same Xero app. |
| `XERO_AUTH_MODE` | `custom_connection` | `oauth` to use the authorization-code flow instead. |
| `XERO_TENANT_ID` | *(first granted)* | OAuth only — pin a specific org as default (takes precedence over `xero_set_current_tenant`). |
| `XERO_OAUTH_REDIRECT_URI` | `http://localhost:5555/callback` | Override the callback URL. Must be localhost. |
| `XERO_SCOPES` | *(sensible defaults)* | Space-separated scope list. |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Xero credentials not configured` | Set `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` in the MCP client config, not in your shell profile — GUI clients don't inherit the shell. Call `xero_get_setup_help` for the full flow. |
| `HTTP 401` on every call | Wrong client ID/secret, or the Custom Connection was revoked. |
| `HTTP 403` on a specific tool | Missing scope — edit the Xero app, add the scope, have the admin reauthorise (and in Custom Connection mode generate a fresh secret). |
| `HTTP 429` | Xero limit is 60 req/min and 5000/day per tenant. Slow down or batch. |
| `OAuth refresh failed` | Refresh token expired (60-day idle limit). Delete `~/.xero-mcp/oauth-tokens.json` and call any tool to re-consent. |
| "This tenant has no access" after switching | That tenant UUID isn't in the OAuth consent scope. Re-run consent to include the new org. |
| Tools don't appear in Claude Desktop | Check `~/Library/Logs/Claude/mcp*.log`. Most common cause: wrong absolute path in `args`, or `node` not on `PATH` (use `/opt/homebrew/bin/node` on Apple Silicon). |
| DXT install fails with "No manifest.json" | You dragged a folder without `manifest.json` at the root. Build the DXT with the command in [section 2C](#c-package-your-own-dxt). |

---

## Development

```bash
npm run dev        # tsx watch mode
npm run build      # compile to dist/
npm run auth       # one-time OAuth setup (reads XERO_CLIENT_ID/SECRET)
npm run inspector  # test tools via MCP Inspector
```

### Layout

```
src/
├── client.ts          # XeroClient wrapper, token cache, dual auth, tenant resolution
├── oauth.ts           # OAuth authorization-code flow + token persistence
├── common.ts          # Shared Zod schemas, formatting, error helpers
├── index.ts           # MCP server entry point
└── tools/
    ├── help.ts        # xero_get_setup_help (works without creds)
    ├── tenants.ts     # List/get/set current tenant (multi-tenant)
    ├── invoices.ts    # ACCREC + ACCPAY invoice/bill tools
    ├── payments.ts    # Payments against invoices/bills
    ├── bank.ts        # Spend/receive money + reconciliation flag
    ├── contacts.ts    # Contact search & creation
    ├── reference.ts   # Accounts, tax rates, organisation
    ├── attachments.ts # File attachments on invoices/bills
    └── billable.ts    # Billable client expenses (local JSON store)
manifest.json          # DXT manifest for Claude Desktop install
scripts/
├── auth.mjs           # CLI: run OAuth consent manually
└── smoke-test.mjs     # CLI: end-to-end sanity check against live Xero
```

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome — especially for additional scopes (payroll, projects, reports), per-call `tenant_id` overrides on individual tools, and additional MCP clients (Cursor, Continue, etc.).

### Release process

Tag a version, push the tag — [GitHub Actions](./.github/workflows/release.yml) builds a fresh `.dxt` and attaches it to the GitHub release automatically.

```bash
# Bump version in package.json AND manifest.json (keep them in sync)
git commit -am "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

See [CHANGELOG.md](./CHANGELOG.md) for release history.

---

## License

[MIT](./LICENSE)
