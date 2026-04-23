#!/usr/bin/env node
// Quick smoke test: mints a token and fetches the organisation.
import { getXeroClient, TENANT_ID } from "../dist/client.js";

async function main() {
  console.log("Minting token…");
  const client = await getXeroClient();
  console.log("Fetching organisation…");
  const res = await client.accountingApi.getOrganisations(TENANT_ID);
  const org = res.body.organisations?.[0];
  if (!org) {
    console.error("No organisation returned");
    process.exit(1);
  }
  console.log("OK:", {
    name: org.name,
    country: org.countryCode,
    baseCurrency: org.baseCurrency,
    timezone: org.timezone,
  });

  console.log("\nFetching 3 bank accounts…");
  const acc = await client.accountingApi.getAccounts(
    TENANT_ID,
    undefined,
    'Type=="BANK"',
  );
  const bankAccounts = (acc.body.accounts ?? []).slice(0, 3);
  console.log(
    bankAccounts.map((a) => ({ name: a.name, code: a.code, type: a.type })),
  );
}

main().catch((err) => {
  console.error("FAILED:", err?.message ?? err);
  if (err?.response?.body) console.error(err.response.body);
  process.exit(1);
});
