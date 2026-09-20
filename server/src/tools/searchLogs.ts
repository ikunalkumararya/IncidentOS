import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { DEMO_DATA } from "../config.js";
import { defineTool, ToolError } from "./types.js";

export const LOG_FILES: Record<string, string> = {
  "payments-api": join(DEMO_DATA, "logs", "payments-api.log"),
  "payments-api-errors": join(DEMO_DATA, "logs", "payments-errors.log"),
};

/** Files are small and immutable; read once and keep them. */
const cache = new Map<string, string[]>();
export function lines(file: string): string[] {
  let cached = cache.get(file);
  if (!cached) {
    cached = readFileSync(file, "utf8").split("\n").filter(Boolean);
    cache.set(file, cached);
  }
  return cached;
}

/** Log lines start with an ISO-8601 timestamp. */
const timestampOf = (line: string) => line.slice(0, 20);

const schema = z.object({
  service: z
    .enum(["payments-api", "payments-api-errors"])
    .default("payments-api")
    .describe("Which log stream to search. Use payments-api-errors for the error-only stream."),
  query: z
    .string()
    .optional()
    .describe("Case-insensitive substring or regular expression to match against the log line."),
  startTime: z.string().optional().describe("ISO-8601 timestamp; only lines at or after this are returned."),
  endTime: z.string().optional().describe("ISO-8601 timestamp; only lines at or before this are returned."),
  limit: z.number().int().min(1).max(300).default(80).describe("Maximum number of lines to return."),
});

export const searchLogs = defineTool({
  name: "search_logs",
  description:
    "Search the application logs for payments-api. Returns matching log lines in chronological order. " +
    "Each line is `<ISO timestamp> <LEVEL> [service/pod] <message>`. " +
    "Use this to establish what the service was doing at a given moment.",
  schema,
  run(input) {
    const file = LOG_FILES[input.service];
    if (!file) throw new ToolError(`unknown log stream: ${input.service}`);

    let matcher: ((line: string) => boolean) | null = null;
    if (input.query) {
      try {
        const re = new RegExp(input.query, "i");
        matcher = (line) => re.test(line);
      } catch {
        const needle = input.query.toLowerCase();
        matcher = (line) => line.toLowerCase().includes(needle);
      }
    }

    const all = lines(file);
    const matched = all.filter((line) => {
      const ts = timestampOf(line);
      if (input.startTime && ts < input.startTime) return false;
      if (input.endTime && ts > input.endTime) return false;
      return matcher ? matcher(line) : true;
    });

    // Keep the most recent slice when the match set is large: the tail of an
    // incident is almost always the informative end.
    const returned = matched.slice(-input.limit);
    const truncated = matched.length - returned.length;

    const header =
      `${matched.length} matching line(s) in ${input.service}` +
      (truncated > 0 ? `, showing the last ${returned.length}` : "");

    return {
      content: returned.length ? `${header}\n\n${returned.join("\n")}` : `${header}\n\n(no matching lines)`,
      summary: `${matched.length} log line(s) matched${input.query ? ` "${input.query}"` : ""}`,
    };
  },
});
