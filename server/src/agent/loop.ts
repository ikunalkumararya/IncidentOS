import Anthropic from "@anthropic-ai/sdk";
import { MAX_ITERATIONS_PER_PHASE, MODEL } from "../config.js";
import type { Emit, Phase } from "../events.js";
import type { ToolRegistry } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";

export class InvestigationAborted extends Error {}

export interface PhaseOptions {
  phase: Phase;
  prompt: string;
  /** Prevent tool use — used for the final written report. */
  textOnly?: boolean;
}

export interface ConversationConfig {
  client: Anthropic;
  systemPrompt: string;
  registry: ToolRegistry;
  ctx: ToolContext;
  emit: Emit;
  signal: AbortSignal;
  labels: Record<Phase, string>;
}

/**
 * Holds one Claude conversation's message thread and phase runner.
 *
 * Moved out of investigator.ts verbatim so the incident and attack drivers
 * share it: the conversation is a single thread across all phases so the
 * model keeps everything it has learned, and the cached prefix (tools +
 * system prompt) stays valid because neither changes between phases.
 */
export function createConversation(cfg: ConversationConfig): { runPhase(opts: PhaseOptions): Promise<string> } {
  const { client, systemPrompt, registry, ctx, emit, signal, labels } = cfg;
  const messages: Anthropic.MessageParam[] = [];

  const throwIfAborted = () => {
    if (signal.aborted) throw new InvestigationAborted("investigation aborted");
  };

  async function runPhase({ phase, prompt, textOnly }: PhaseOptions): Promise<string> {
    throwIfAborted();
    emit({ type: "phase", phase, label: labels[phase] });
    messages.push({ role: "user", content: prompt });

    let finalText = "";

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_PHASE; iteration++) {
      throwIfAborted();

      const stream = client.messages.stream(
        {
          model: MODEL,
          max_tokens: 64_000,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: registry.specs,
          ...(textOnly ? { tool_choice: { type: "none" as const } } : {}),
          messages,
        },
        { signal },
      );

      // Summarised reasoning is flushed a block at a time rather than per
      // delta: it keeps the console readable and the recording small, and the
      // tool calls already carry the moment-to-moment sense of progress.
      let thinkingBuffer = "";
      stream.on("thinking", (delta) => {
        thinkingBuffer += delta;
      });
      stream.on("contentBlock", (block) => {
        if (block.type === "thinking" && thinkingBuffer.trim()) {
          emit({ type: "thinking", text: thinkingBuffer.trim() });
          thinkingBuffer = "";
        }
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new Error("the model declined to continue this turn");
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }

      const toolUses = message.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      // A tool input truncated at max_tokens usually still parses into a
      // plausible-looking object, so never run the tools from such a turn.
      if (message.stop_reason === "max_tokens" && toolUses.length > 0) {
        throw new Error("tool input was truncated at max_tokens");
      }

      const text = message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (text) finalText = text;

      if (toolUses.length === 0) return finalText;

      messages.push({ role: "assistant", content: message.content });

      // Parallel tool calls must come back as tool_result blocks in a single
      // user message, or the model learns to stop issuing them in parallel.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        emit({ type: "tool_call", tool: call.name, input: call.input });
        const outcome = await registry.execute(call.name, call.input, ctx);
        emit({ type: "tool_result", tool: call.name, summary: outcome.summary, ok: outcome.ok });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: outcome.content,
          ...(outcome.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
    }

    emit({
      type: "narration",
      text: `Reached the turn limit for this phase after ${MAX_ITERATIONS_PER_PHASE} steps; moving on.`,
    });
    return finalText;
  }

  return { runPhase };
}
