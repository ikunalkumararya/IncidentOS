import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { resolveInSandbox } from "../sandbox.js";
import { defineTool } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vitest"]);

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const schema = z.object({
  query: z.string().describe("Substring or regular expression to search for, case-insensitive."),
  path: z
    .string()
    .optional()
    .describe("Restrict the search to a subdirectory of the repository, e.g. src or tests."),
  limit: z.number().int().min(1).max(80).default(30).describe("Maximum number of matches to return."),
});

export const searchCode = defineTool({
  name: "search_code",
  description:
    "Search the payments-api source tree for a pattern. Returns `path:line: text` for each match. " +
    "The repository root contains src/, tests/ and scripts/.",
  schema,
  async run(input, ctx) {
    const root = input.path ? resolveInSandbox(input.path, ctx.sandboxRoot) : ctx.sandboxRoot;
    const files = await walk(root);

    let test: (line: string) => boolean;
    try {
      const re = new RegExp(input.query, "i");
      test = (line) => re.test(line);
    } catch {
      const needle = input.query.toLowerCase();
      test = (line) => line.toLowerCase().includes(needle);
    }

    const matches: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const rel = relative(ctx.sandboxRoot, file);
      text.split("\n").forEach((line, index) => {
        if (matches.length < input.limit && test(line)) {
          matches.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    return {
      content: matches.length
        ? `${matches.length} match(es) for /${input.query}/i\n\n${matches.join("\n")}`
        : `no matches for /${input.query}/i under ${relative(ctx.sandboxRoot, root) || "."}`,
      summary: `${matches.length} code match(es) for "${input.query}"`,
    };
  },
});
