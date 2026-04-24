import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkForUpdates, getCurrentVersion } from "../updates.js";
import { formatError, markdownResult } from "../common.js";

export function registerUpdateTools(server: McpServer) {
  server.registerTool(
    "xero_check_for_updates",
    {
      title: "Check GitHub for a newer release of this MCP",
      description: `Fetch the latest release of xero-mcp-server from GitHub and compare with the currently-installed version. Reports whether an update is available, plus release notes and a download link.

Result is cached for 6 hours in ~/.xero-mcp/update-check.json to avoid hammering the GitHub API. Pass force=true to bypass the cache.

Call this periodically, or when an unfamiliar error appears — a newer release may already have a fix.`,
      inputSchema: {
        force: z
          .boolean()
          .default(false)
          .describe("Bypass the 6-hour cache and hit GitHub now"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ force }) => {
      try {
        const check = await checkForUpdates({ force });
        const lines: string[] = [
          "# xero-mcp-server — update check",
          "",
          `- Installed: **v${check.current_version}**`,
          `- Latest on GitHub: **v${check.latest_version}**${
            check.from_cache ? " (cached)" : ""
          }`,
        ];
        if (check.update_available) {
          lines.push(
            "",
            `## 🟠 Update available`,
            "",
            `A newer release is out.${check.release_url ? ` [Release notes](${check.release_url})` : ""}`,
            "",
            "### To update",
            "- **DXT install**: download the new `.dxt` from the release page and double-click.",
            "- **From source**: `git pull && npm install && npm run build`.",
          );
          if (check.release_notes) {
            lines.push("", "### Release notes (excerpt)", "", check.release_notes);
          }
        } else {
          lines.push("", "## ✅ You're on the latest version");
        }
        if (check.published_at) {
          lines.push("", `Latest release published: ${check.published_at}`);
        }
        return markdownResult(lines.join("\n"), check);
      } catch (err) {
        return formatError(err);
      }
    },
  );

  server.registerTool(
    "xero_version",
    {
      title: "Show the installed xero-mcp-server version",
      description:
        "Report the version of this MCP server. Useful as a sanity check when diagnosing issues.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const v = getCurrentVersion();
      return markdownResult(`xero-mcp-server v${v}`);
    },
  );
}
