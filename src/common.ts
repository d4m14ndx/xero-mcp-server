import { z } from "zod";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for a readable summary or 'json' for full structured data",
  );

export const PaginationSchema = {
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("1-based page number for Xero pagination"),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("Items per page (Xero default 100, max 1000 for most endpoints)"),
};

export const LineItemSchema = z
  .object({
    description: z.string().min(1).describe("Description of the item or service"),
    quantity: z.number().positive().default(1).describe("Quantity of the item"),
    unit_amount: z
      .number()
      .describe("Unit price, tax-exclusive or inclusive per line_amount_types"),
    account_code: z
      .string()
      .min(1)
      .describe(
        "Chart of accounts code (e.g. '200' for sales, '400' for expenses). Use xero_list_accounts to discover.",
      ),
    tax_type: z
      .string()
      .optional()
      .describe(
        "Tax type code (e.g. 'OUTPUT', 'INPUT', 'NONE'). Use xero_list_tax_rates to discover values valid for this org.",
      ),
    item_code: z.string().optional().describe("Inventory item code if using tracked items"),
    discount_rate: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Percentage discount on the line (0-100)"),
    tracking: z
      .array(
        z.object({
          name: z.string().describe("Tracking category name"),
          option: z.string().describe("Tracking option value"),
        }),
      )
      .optional()
      .describe("Tracking categories for this line"),
  })
  .strict();

export type LineItemInput = z.infer<typeof LineItemSchema>;

export function toXeroLineItem(line: LineItemInput) {
  return {
    description: line.description,
    quantity: line.quantity,
    unitAmount: line.unit_amount,
    accountCode: line.account_code,
    taxType: line.tax_type,
    itemCode: line.item_code,
    discountRate: line.discount_rate,
    tracking: line.tracking?.map((t) => ({ name: t.name, option: t.option })),
  };
}

export const CHARACTER_LIMIT = 25000;

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export function jsonResult(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  let truncated = false;
  if (text.length > CHARACTER_LIMIT) {
    truncated = true;
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n... [truncated ${text.length - CHARACTER_LIMIT} characters — narrow filters or use pagination]`;
  }
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { data: data as JsonValue, truncated },
  };
}

export function markdownResult(markdown: string, structured?: unknown) {
  let text = markdown;
  if (text.length > CHARACTER_LIMIT) {
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n... [truncated — narrow filters or use pagination]`;
  }
  return {
    content: [{ type: "text" as const, text }],
    ...(structured !== undefined
      ? { structuredContent: { data: structured as JsonValue } }
      : {}),
  };
}

export function formatError(err: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  let message: string;
  if (err && typeof err === "object" && "response" in err) {
    const anyErr = err as {
      response?: { statusCode?: number; body?: unknown };
      message?: string;
    };
    const status = anyErr.response?.statusCode;
    const body = anyErr.response?.body;
    const bodyText =
      typeof body === "string" ? body : body ? JSON.stringify(body, null, 2) : "";
    message = `Xero API error${status ? ` (HTTP ${status})` : ""}: ${
      anyErr.message ?? "unknown"
    }${bodyText ? `\n${bodyText}` : ""}`;
    if (status === 401) {
      message +=
        "\nHint: token may be invalid — verify XERO_CLIENT_ID/SECRET and that the Custom Connection is still authorised.";
    } else if (status === 403) {
      message +=
        "\nHint: scope missing. Check the Custom Connection includes accounting.transactions, accounting.contacts, accounting.settings.";
    } else if (status === 429) {
      message += "\nHint: rate limit exceeded (60/min, 5000/day). Wait and retry.";
    }
  } else if (err instanceof Error) {
    message = `Error: ${err.message}`;
  } else {
    message = `Error: ${String(err)}`;
  }
  return { content: [{ type: "text", text: message }], isError: true };
}

export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k as keyof T] = v as T[keyof T];
  }
  return out;
}

export function formatMoney(amount: number | undefined, currency?: string): string {
  if (amount === undefined || amount === null) return "—";
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}
