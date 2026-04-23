# xero-mcp-server

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-brightgreen)](https://modelcontextprotocol.io/)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-DXT-orange)](https://github.com/anthropics/dxt)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-green)](https://nodejs.org/)

**Drive your Xero accounting from Claude.** An MCP (Model Context Protocol) server exposing 22 Xero tools — create invoices and bills, record payments, attach PDFs, reconcile bank transactions, flag billable client expenses and roll them up into invoices later.

Built on the official [`xero-node`](https://github.com/XeroAPI/xero-node) SDK with a **Xero Custom Connection** (OAuth2 client-credentials) — single-tenant, no browser redirect, fast token refresh.

---

## Table of contents

- [Why](#why)
- [Tool reference](#tool-reference)
- [Quickstart](#quickstart)
  - [1. Create a Xero Custom Connection](#1-create-a-xero-custom-connection)
  - [2. Install](#2-install)
  - [3. Wire into your MCP client](#3-wire-into-your-mcp-client)
- [Usage examples](#usage-examples)
- [Billable-expense workflow](#billable-expense-workflow)
- [Token handling & scopes](#token-handling--scopes)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Why

Xero's web UI is great for accountants and not great for anyone trying to enter a supplier bill at 11 PM. With this MCP installed, you just tell Claude what happened:

> "Enter the AWS invoice from Slack for $1,234.56, dated April 30. Attach the PDF from my Downloads folder. The $500 hosting line is billable to Acme Corp with 20% markup."

Claude handles the six Xero API calls: find the contact, look up the expense account, create the bill, attach the PDF, flag the billable line, save. End of month: "Invoice Acme for their April expenses" creates a sales invoice rolling up all their pending billable lines.

This server gives Claude every primitive needed for day-to-day AP/AR work without putting you through Xero's click-path.

---

## Tool reference

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

- **Bank-feed statement-line matching.** Xero's public API exposes creating spend/receive-money transactions and toggling `is_reconciled`, but the full "match statement line X to transaction Y" UI isn't in the API. For complex rec, use the Xero web app and call `xero_mark_bank_transaction_reconciled` once you've confirmed a match.
- **Standard OAuth 2.0.** Only the Custom Connection (`client_credentials`) flow is implemented. For multi-tenant / browser-consent flows, you'd need to add redirect handling and refresh-token persistence — PRs welcome.
- **Payroll, reports, budgets, projects.** Not yet — the underlying SDK supports them; the scopes just aren't wired to MCP tools here.

---

## Quickstart

### 1. Create a Xero Custom Connection

A Custom Connection is Xero's machine-to-machine auth: one organisation, no browser redirect, 30-minute tokens. Requires a paid Xero Developer plan (~USD $10/mo per connection).

1. Go to https://developer.xero.com/app/manage/ as a Xero org **admin**.
2. Click **New app** → **Custom connection**.
3. Name it (e.g. "Claude MCP"), select the Xero org.
4. Add these scopes:
   - `accounting.transactions` — invoices, bills, payments, bank transactions
   - `accounting.contacts` — contacts
   - `accounting.settings.read` — chart of accounts, tax rates, org info
   - `accounting.attachments` — file attachments
5. Save. **Copy the Client ID and Client Secret immediately** — the secret is only shown once.
6. Approve the connection from the email Xero sends to the admin.

### 2. Install

Three options — pick one.

#### A. DXT bundle (Claude Desktop, one-click)

Download `xero-mcp-server.dxt` from the [latest GitHub release](https://github.com/d4m14ndx/xero-mcp-server/releases/latest) and double-click it. Claude Desktop opens an install dialog that asks for your Xero Client ID and Secret.

#### B. Build from source

```bash
git clone https://github.com/d4m14ndx/xero-mcp-server.git
cd xero-mcp-server
npm install
npm run build
```

The entry point after build is `dist/index.js`.

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
        "XERO_CLIENT_ID": "YOUR_CLIENT_ID",
        "XERO_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

Fully quit and relaunch Claude.

#### Claude Code CLI

Add the same `mcpServers` block to `~/.claude.json` (user-level) or a project-level `.mcp.json`. Use the **absolute path to `node`** (`which node`) — Claude doesn't inherit your shell's `PATH`.

#### Ad-hoc / other MCP clients

```bash
XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... node dist/index.js
```

Then configure your client to spawn that command over stdio.

### 4. Verify

```bash
npm run inspector
```

Opens a browser where you can click through each tool against your live Xero org.

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

---

## Token handling & scopes

- **Tokens** last 30 minutes; server mints on first call and refreshes ~60 s before expiry. Held in memory only.
- **Scopes** are set at the Custom Connection level in the Xero developer portal, not per-request. The tools here need:
  - `accounting.transactions`
  - `accounting.contacts`
  - `accounting.settings.read`
  - `accounting.attachments`

Override the default scopes with `XERO_SCOPES="space separated list"` env var if needed.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing environment variable: XERO_CLIENT_ID` | Set env vars in the MCP client config, not in your shell profile — GUI clients don't inherit the shell. |
| `HTTP 401` on every call | Wrong client ID/secret, or the Custom Connection was revoked. |
| `HTTP 403` on a specific tool | Missing scope — edit the Custom Connection, add the scope, have the org admin reauthorise. |
| `HTTP 429` | Xero limit is 60 req/min and 5000/day per tenant. |
| Tools don't appear in Claude Desktop | Check `~/Library/Logs/Claude/mcp*.log`. Most common cause: wrong absolute path in `args`, or `node` not on `PATH` (use `/opt/homebrew/bin/node` on Apple Silicon). |
| DXT install fails with "No manifest.json" | You dragged a folder without `manifest.json` at the root. Build the DXT with the command in [section 2C](#c-package-your-own-dxt). |

---

## Development

```bash
npm run dev        # tsx watch mode
npm run build      # compile to dist/
npm run inspector  # test tools via MCP Inspector
```

### Layout

```
src/
├── client.ts          # XeroClient wrapper + token cache
├── common.ts          # Shared Zod schemas, formatting, error helpers
├── index.ts           # MCP server entry point
└── tools/
    ├── invoices.ts    # ACCREC + ACCPAY invoice/bill tools
    ├── payments.ts    # Payments against invoices/bills
    ├── bank.ts        # Spend/receive money + reconciliation flag
    ├── contacts.ts    # Contact search & creation
    ├── reference.ts   # Accounts, tax rates, organisation
    ├── attachments.ts # File attachments on invoices/bills
    └── billable.ts    # Billable client expenses (local JSON store)
manifest.json          # DXT manifest for desktop-app install
scripts/smoke-test.mjs # Quick end-to-end sanity check
```

### Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). PRs welcome — especially for additional scopes (payroll, projects, reports), standard OAuth 2.0 auth, and additional MCP clients (Cursor, Continue, etc.).

### Release process

Tag a version, push the tag — [GitHub Actions](./.github/workflows/release.yml) builds a fresh `.dxt` and attaches it to the GitHub release automatically.

```bash
# Bump version in package.json and manifest.json first
git commit -am "Release v0.3.0"
git tag v0.3.0
git push origin main --tags
```

---

## License

[MIT](./LICENSE)
