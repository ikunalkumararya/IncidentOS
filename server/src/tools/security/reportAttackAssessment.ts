import { z } from "zod";
import { defineTool } from "../types.js";

const schema = z.object({
  priority: z.enum(["Minor", "Major", "Urgent"]).describe("Overall priority of this campaign."),
  confidence: z.number().min(0).max(100).describe("Confidence in this priority, 0-100."),
  rationale: z.string().describe("One or two sentences on what drives the priority and confidence."),
});

export const reportAttackAssessment = defineTool({
  name: "report_attack_assessment",
  description:
    "Record the priority and confidence for this campaign, shown as tags on the security console. Call " +
    "this once you have gathered enough evidence to give an honest initial read, and call it again after " +
    "the fix is verified to refine it — the latest call wins. Weigh whether any session was actually " +
    "created, whether the compromised account had MFA, and how completely the campaign is contained.",
  schema,
  run(input, ctx) {
    ctx.findings.assessment = input;
    ctx.emit({ type: "attack_assessment", ...input });
    return {
      content: `Recorded assessment: ${input.priority} at ${input.confidence}% confidence.`,
      summary: `assessment: ${input.priority} (${input.confidence}%)`,
    };
  },
});
