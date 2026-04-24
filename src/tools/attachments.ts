import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getXeroClient, tenantId } from "../client.js";
import { formatError, jsonResult } from "../common.js";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB Xero limit

function guessContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
  };
  return map[ext] ?? "application/octet-stream";
}

export function registerAttachmentTools(server: McpServer) {
  server.registerTool(
    "xero_attach_file_to_invoice_or_bill",
    {
      title: "Attach a file (PDF, image, etc.) to an invoice or bill",
      description: `Attach a local file to a Xero invoice (ACCREC) or bill (ACCPAY). Both use the same endpoint — pass the invoice/bill UUID in invoice_id.

Typical use: a PDF bill/receipt received from a supplier, attached to the bill record in Xero for audit trail.

File is read from the local filesystem at file_path. Max size 25 MB. Common types (PDF, PNG, JPG, XLSX, DOCX) are detected automatically from the extension.`,
      inputSchema: {
        invoice_id: z
          .string()
          .uuid()
          .describe("UUID of the invoice (ACCREC) or bill (ACCPAY) to attach to"),
        file_path: z
          .string()
          .min(1)
          .describe(
            "Absolute path to the file on disk (e.g. /Users/me/Downloads/bill.pdf). Must be readable by this process.",
          ),
        file_name: z
          .string()
          .optional()
          .describe(
            "Override the filename stored in Xero (defaults to the basename of file_path)",
          ),
        include_online: z
          .boolean()
          .default(false)
          .describe(
            "If true, the attachment is shown on the online version of the invoice sent to the contact",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ invoice_id, file_path, file_name, include_online }) => {
      try {
        const absPath = path.resolve(file_path);
        const stat = await fs.promises.stat(absPath).catch(() => null);
        if (!stat || !stat.isFile()) {
          return {
            content: [
              { type: "text", text: `File not found or not a regular file: ${absPath}` },
            ],
            isError: true,
          };
        }
        if (stat.size > MAX_ATTACHMENT_BYTES) {
          return {
            content: [
              {
                type: "text",
                text: `File is ${stat.size} bytes, exceeds Xero's 25 MB attachment limit.`,
              },
            ],
            isError: true,
          };
        }
        const buffer = await fs.promises.readFile(absPath);
        const resolvedName = file_name ?? path.basename(absPath);
        const client = await getXeroClient();
        const res = await client.accountingApi.createInvoiceAttachmentByFileName(
          tenantId(),
          invoice_id,
          resolvedName,
          buffer,
          include_online,
          undefined,
          { headers: { "Content-Type": guessContentType(resolvedName) } },
        );
        const attachment = res.body.attachments?.[0];
        return jsonResult({
          attached: {
            attachment_id: attachment?.attachmentID,
            file_name: attachment?.fileName,
            mime_type: attachment?.mimeType,
            content_length: attachment?.contentLength,
            include_online: attachment?.includeOnline,
            url: attachment?.url,
          },
        });
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_list_invoice_attachments",
    {
      title: "List attachments on an invoice or bill",
      description:
        "List files attached to an invoice (ACCREC) or bill (ACCPAY). Returns filename, mime type, size, and Xero-hosted URL for each.",
      inputSchema: {
        invoice_id: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ invoice_id }) => {
      try {
        const client = await getXeroClient();
        const res = await client.accountingApi.getInvoiceAttachments(
          tenantId(),
          invoice_id,
        );
        return jsonResult({
          attachments: (res.body.attachments ?? []).map((a) => ({
            attachment_id: a.attachmentID,
            file_name: a.fileName,
            mime_type: a.mimeType,
            content_length: a.contentLength,
            include_online: a.includeOnline,
            url: a.url,
          })),
        });
      } catch (err) {
        return formatError(err);
      }
    },
  );
}
