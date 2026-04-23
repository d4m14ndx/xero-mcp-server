# xero-mcp-server

An MCP (Model Context Protocol) server exposing Xero accounting tools to Claude Desktop, Claude Code, and any other MCP-capable client.

Uses the official `xero-node` SDK and a **Xero Custom Connection** (OAuth2 `client_credentials`) — a single-tenant, machine-to-machine auth flow with no browser redirect.

## Capabilities (22 tools)

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

### Billable client expenses (local workflow)
Xero's "Assign expense to customer" feature isn't exposed via the public API. These tools replicate the workflow using a local JSON store at `~/.xero-mcp/billable-expenses.json`.

| Tool | What it does |
|---|---|
| `xero_flag_bill_line_as_billable` | Mark a bill line as billable to a client, with optional markup |
| `xero_list_billable_expenses` | List pending or billed expenses (filter by client) |
| `xero_generate_invoice_from_billable_expenses` | Roll up a client's pending expenses into one ACCREC invoice |
| `xero_unflag_billable_expense` | Delete or revert a record (e.g. if the invoice was voided) |

### What's not covered

- **Bank-feed statement-line matching**: Xero's public API exposes creating spend/receive-money transactions and the `is_reconciled` flag, but not the full "match statement line X to transaction Y" UI. For complex rec, use the Xero web app and call `xero_mark_bank_transaction_reconciled` once confirmed.
- **Standard OAuth 2.0**: only the Custom Connection (`client_credentials`) flow is implemented. For multi-tenant / browser-consent flows you'd need to add redirect handling and refresh-token persistence.

---

## Setup

### 1. Create a Xero Custom Connection

1. Go to https://developer.xero.com/app/manage/ and sign in with an account that has **admin** rights on the Xero org.
2. Click **New app** → choose **Custom connection**.
3. Name it (e.g. "Claude MCP") and select the Xero organisation to authorise.
4. Under **Scopes**, add:
   - `accounting.transactions` — invoices, bills, payments, bank transactions
   - `accounting.contacts` — contacts
   - `accounting.settings.read` — chart of accounts, tax rates, org info
   - `accounting.attachments` — attach files to invoices/bills
5. Save. Xero will show **Client id** and **Client secret** — copy both, the secret is only shown once.
6. Have the Xero org admin approve the connection from the email Xero sends.

> Custom Connections require a paid Xero Developer plan (currently ~USD $10/mo per connection).

### 2. Install & build

```bash
git clone <this repo>
cd xero-mcp-server
npm install
npm run build
```

### 3. Wire into your client

#### Option A — Claude Desktop (classic build) via `claude_desktop_config.json`

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS (or the Windows/Linux equivalent):

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

Fully quit and relaunch Claude Desktop.

#### Option B — Claude Desktop as a DXT (Desktop Extension)

If your Claude Desktop build supports DXT extensions (`Customize → Install extension`), package and drop in the `.dxt`:

```bash
npm install && npm run build
zip -r xero-mcp-server.dxt manifest.json dist package.json node_modules \
  -x "node_modules/.cache/*" "node_modules/.package-lock.json"
```

Then double-click the resulting `xero-mcp-server.dxt`. You'll be prompted for the Client ID and Secret at install time via a form defined in `manifest.json`.

#### Option C — Claude Code CLI

Add the same `mcpServers` block to `~/.claude.json` (user-level) or a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "xero": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/xero-mcp-server/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "YOUR_CLIENT_ID",
        "XERO_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

Use the absolute path to `node` — Claude doesn't inherit your shell's `PATH`.

#### Option D — ad-hoc

```bash
XERO_CLIENT_ID=... XERO_CLIENT_SECRET=... node dist/index.js
```

### 4. Test with MCP Inspector

```bash
npm run inspector
```

Opens a browser UI where you can click through each tool against your live Xero org.

---

## Usage patterns

### Create an invoice from natural language

```
> Bill Acme Corp $500 for March consulting, due April 30.

Claude:
  1. xero_search_contacts(search_term="Acme Corp")  → contact_id
  2. xero_list_accounts(type="REVENUE")             → account_code
  3. xero_list_tax_rates()                          → tax_type
  4. xero_create_invoice(contact_id, line_items=[{
         description: "March consulting",
         unit_amount: 500,
         account_code: "200",
         tax_type: "OUTPUT"
     }], due_date: "2026-04-30", status: "AUTHORISED")
```

### Enter a bill with PDF attached

```
> Enter this AWS bill for $1,234.56 and attach the PDF at ~/Downloads/aws-april.pdf.

Claude:
  1. xero_search_contacts(search_term="Amazon Web Services")  → contact_id
  2. xero_create_bill(contact_id, line_items=[...])           → invoice_id
  3. xero_attach_file_to_invoice_or_bill(
         invoice_id,
         file_path="/Users/.../aws-april.pdf"
     )
```

### Billable expenses → client invoice

```
> The $500 AWS line on that bill should be billed to Acme with 20% markup.

Claude:
  1. xero_get_invoice(bill_invoice_id)  → find line_item_id
  2. xero_flag_bill_line_as_billable(
         bill_invoice_id,
         bill_line_item_id,
         client_contact_id="<acme uuid>",
         description="AWS hosting - April",
         unit_amount=500,
         markup_percent=20
     )

Later, end of month:

> Generate an invoice for Acme for all their pending expenses.

Claude:
  1. xero_list_billable_expenses(client_contact_id="<acme uuid>", status="pending")
  2. xero_generate_invoice_from_billable_expenses(
         client_contact_id="<acme uuid>",
         status="AUTHORISED",
         default_account_code="200"
     )
```

### Reconcile a bank-feed item

```
> There's an unreconciled $50 bank fee from April 3. Code it to 404.

Claude:
  1. xero_list_bank_transactions(where="IsReconciled==false")
  2. xero_create_bank_transaction(
         type="SPEND", bank_account_id, contact_id,
         line_items=[{description: "Bank fee", unit_amount: 50, account_code: "404"}],
         date: "2026-04-03"
     )
  3. xero_mark_bank_transaction_reconciled(bank_transaction_id)
```

---

## Token handling

Client-credentials tokens last 30 minutes. The server mints on first API call and refreshes ~60 s before expiry. Nothing is persisted to disk — tokens live in-memory only for the life of the server process.

## Scopes

Set at the Custom Connection level in the Xero developer portal, not per-request. For the tools in this server:

- `accounting.transactions` — invoices, bills, credit notes, payments, bank transactions
- `accounting.contacts` — contacts
- `accounting.settings.read` — chart of accounts, tax rates, tracking, org info
- `accounting.attachments` — file attachments on invoices/bills

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing environment variable: XERO_CLIENT_ID` | Set env vars in the MCP client config, not in your shell profile — GUI clients don't inherit the shell. |
| `HTTP 401` on every call | Wrong client ID/secret or Custom Connection revoked. |
| `HTTP 403` on a specific tool | Missing scope — edit the Custom Connection and add it, then reauthorise. |
| `HTTP 429` | Xero limit is 60 req/min and 5000/day per tenant. |
| Tools don't appear in client | Check `~/Library/Logs/Claude/mcp*.log`. Most common cause: wrong absolute path in `args`, or `node` not on `PATH`. |

## Development

```bash
npm run dev       # tsx watch mode
npm run build     # compile to dist/
npm run inspector # test tools via MCP Inspector
```

## Layout

```
src/
├── client.ts          # XeroClient wrapper + token cache
├── common.ts          # Shared schemas, formatting, error helpers
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
```

## License

MIT
