import { describe, it, expect } from "vitest";
import {
  CHARACTER_LIMIT,
  ResponseFormat,
  ResponseFormatSchema,
  compact,
  formatError,
  formatMoney,
  jsonResult,
  markdownResult,
  toXeroLineItem,
  LineItemSchema,
  PaginationSchema,
  TenantOverrideSchema,
} from "../src/common.js";
import { XeroSetupRequiredError } from "../src/client.js";
import { z } from "zod";

describe("compact", () => {
  it("drops undefined and null values", () => {
    expect(compact({ a: 1, b: undefined, c: null, d: "hi" })).toEqual({
      a: 1,
      d: "hi",
    });
  });

  it("preserves falsy-but-defined values (0, '', false)", () => {
    expect(compact({ n: 0, s: "", b: false })).toEqual({
      n: 0,
      s: "",
      b: false,
    });
  });

  it("returns an empty object for all-undefined input", () => {
    expect(compact({ a: undefined, b: undefined })).toEqual({});
  });
});

describe("formatMoney", () => {
  it("returns em-dash for undefined", () => {
    expect(formatMoney(undefined)).toBe("—");
  });

  it("returns em-dash for null", () => {
    expect(formatMoney(null as unknown as number)).toBe("—");
  });

  it("formats with two decimals", () => {
    expect(formatMoney(1234.5)).toBe("1,234.50");
    expect(formatMoney(0)).toBe("0.00");
  });

  it("prefixes currency when supplied", () => {
    expect(formatMoney(99.9, "AUD")).toBe("AUD 99.90");
  });
});

describe("jsonResult", () => {
  it("wraps data into MCP content array", () => {
    const result = jsonResult({ hello: "world" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ hello: "world" });
    expect(result.structuredContent).toEqual({
      data: { hello: "world" },
      truncated: false,
    });
  });

  it("truncates when over CHARACTER_LIMIT and flags it", () => {
    const long = { big: "x".repeat(CHARACTER_LIMIT + 1000) };
    const result = jsonResult(long);
    expect(result.content[0].text).toContain("[truncated");
    expect(result.structuredContent.truncated).toBe(true);
  });
});

describe("markdownResult", () => {
  it("returns markdown text", () => {
    const result = markdownResult("# Hello");
    expect(result.content[0].text).toBe("# Hello");
    expect(result).not.toHaveProperty("structuredContent");
  });

  it("attaches structuredContent when provided", () => {
    const result = markdownResult("# H", { a: 1 });
    expect(result.structuredContent).toEqual({ data: { a: 1 } });
  });

  it("truncates long markdown", () => {
    const result = markdownResult("x".repeat(CHARACTER_LIMIT + 100));
    expect(result.content[0].text).toContain("[truncated");
  });
});

describe("formatError", () => {
  it("returns isError and helpful text for XeroSetupRequiredError", () => {
    const err = new XeroSetupRequiredError("XERO_CLIENT_ID is not set");
    const r = formatError(err);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("XERO_CLIENT_ID is not set");
    expect(r.content[0].text).toContain("xero_get_setup_help");
  });

  it("formats API errors with status codes", () => {
    const apiErr = {
      response: { statusCode: 429, body: { detail: "Rate limited" } },
      message: "Too many requests",
    };
    const r = formatError(apiErr);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("HTTP 429");
    expect(r.content[0].text).toContain("rate limit");
  });

  it("hints about scope for 403", () => {
    const err = {
      response: { statusCode: 403, body: "forbidden" },
      message: "denied",
    };
    expect(formatError(err).content[0].text).toContain("scope");
  });

  it("hints about token for 401", () => {
    const err = {
      response: { statusCode: 401, body: "unauth" },
      message: "bad creds",
    };
    expect(formatError(err).content[0].text).toContain("token");
  });

  it("falls back for plain Error", () => {
    const r = formatError(new Error("oops"));
    expect(r.content[0].text).toContain("oops");
  });

  it("falls back for non-error throwables", () => {
    expect(formatError("just a string").content[0].text).toContain("just a string");
  });
});

describe("toXeroLineItem", () => {
  it("maps snake_case to camelCase and passes through tracking", () => {
    const input = {
      description: "Consulting",
      quantity: 2,
      unit_amount: 150,
      account_code: "200",
      tax_type: "OUTPUT",
      discount_rate: 10,
      tracking: [{ name: "Project", option: "Acme" }],
    };
    const out = toXeroLineItem(input);
    expect(out).toMatchObject({
      description: "Consulting",
      quantity: 2,
      unitAmount: 150,
      accountCode: "200",
      taxType: "OUTPUT",
      discountRate: 10,
      tracking: [{ name: "Project", option: "Acme" }],
    });
  });

  it("omits optional fields when undefined", () => {
    const out = toXeroLineItem({
      description: "x",
      quantity: 1,
      unit_amount: 1,
      account_code: "200",
    });
    expect(out.taxType).toBeUndefined();
    expect(out.tracking).toBeUndefined();
    expect(out.discountRate).toBeUndefined();
  });
});

describe("LineItemSchema (Zod)", () => {
  it("requires description and account_code", () => {
    const bad = LineItemSchema.safeParse({ unit_amount: 100 });
    expect(bad.success).toBe(false);
  });

  it("accepts a minimal valid line", () => {
    const ok = LineItemSchema.safeParse({
      description: "foo",
      unit_amount: 100,
      account_code: "200",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.quantity).toBe(1); // default
  });

  it("rejects non-strict extra fields", () => {
    const r = LineItemSchema.safeParse({
      description: "foo",
      unit_amount: 100,
      account_code: "200",
      mystery_field: "nope",
    });
    expect(r.success).toBe(false);
  });
});

describe("PaginationSchema fragment", () => {
  it("applies sensible defaults", () => {
    const s = z.object(PaginationSchema);
    const r = s.parse({});
    expect(r.page).toBe(1);
    expect(r.page_size).toBe(100);
  });

  it("rejects page_size over 1000", () => {
    const s = z.object(PaginationSchema);
    expect(s.safeParse({ page_size: 5000 }).success).toBe(false);
  });
});

describe("TenantOverrideSchema fragment", () => {
  it("is optional", () => {
    const s = z.object(TenantOverrideSchema);
    expect(s.parse({}).tenant_id).toBeUndefined();
  });

  it("requires UUID format when provided", () => {
    const s = z.object(TenantOverrideSchema);
    expect(s.safeParse({ tenant_id: "not-a-uuid" }).success).toBe(false);
    expect(
      s.safeParse({ tenant_id: "a8908f1c-4f2b-4b8e-9c8d-1234567890ab" }).success,
    ).toBe(true);
  });
});

describe("ResponseFormatSchema", () => {
  it("defaults to markdown", () => {
    expect(ResponseFormatSchema.parse(undefined)).toBe(ResponseFormat.MARKDOWN);
  });

  it("accepts json", () => {
    expect(ResponseFormatSchema.parse("json")).toBe(ResponseFormat.JSON);
  });

  it("rejects unknown values", () => {
    expect(ResponseFormatSchema.safeParse("xml").success).toBe(false);
  });
});
