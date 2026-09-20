import { readdir, readFile as read, stat } from "node:fs/promises";
import { relative } from "node:path";
import { z } from "zod";
import { resolveInSandbox } from "../sandbox.js";
import { defineTool } from "./types.js";

const schema = z.object({
  path: z
    .string()
    .describe(
      "Path relative to the payments-api repository root, e.g. src/transactions.ts. " +
        "Pass a directory to list its contents.",
    ),
});

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read a file from the payments-api repository, with line numbers so you can refer to exact lines. " +
    "Passing a directory lists it instead. Access is confined to the repository.",
  schema,
  async run(input, ctx) {
    const target = resolveInSandbox(input.path, ctx.sandboxRoot);
    const info = await stat(target);

    if (info.isDirectory()) {
      const entries = await readdir(target, { withFileTypes: true });
      const listing = entries
        .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      return {
        content: `${relative(ctx.sandboxRoot, target) || "."} (directory)\n\n${listing.join("\n")}`,
        summary: `listed ${listing.length} entries in ${input.path}`,
      };
    }

    const text = await read(target, "utf8");
    const numbered = text
      .split("\n")
      .map((line, index) => `${String(index + 1).padStart(4)}  ${line}`)
      .join("\n");

    return {
      content: `${relative(ctx.sandboxRoot, target)}\n\n${numbered}`,
      summary: `read ${relative(ctx.sandboxRoot, target)} (${text.split("\n").length} lines)`,
    };
  },
});
