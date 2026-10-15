import { z } from "zod/v4";

/**
 * The runs endpoints' shapes, validated by `rai()` and described by
 * `tulipes spec` from the same declaration. Messages are this module's
 * i18n keys.
 */

export const runRequest = z.object({
  goal: z.string("goalRequired").trim().min(1, "goalRequired").max(4_000, "goalTooLong")
    .describe("What the agent should achieve, as you would ask a colleague"),
  context: z.string().max(20_000, "contextTooLong").optional()
    .describe("Anything it needs to know that the tools will not tell it"),
});

export const runIdParam = z.object({
  run_id: z.string().regex(/^[a-f0-9]{24}$/, "noSuchRun"),
});

export const runListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["queued", "running", "waiting_approval", "succeeded", "failed", "cancelled", "exhausted"]).optional(),
});

export const approvalBody = z.object({
  /** One answer per call the run is waiting on, by its tool_use id. */
  decisions: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "noSuchCall"), z.enum(["allow", "deny"], "decisionInvalid"))
    .refine((decisions) => Object.keys(decisions).length > 0, "decisionsRequired"),
});

const usage = z.object({ input: z.number(), output: z.number(), cache_read: z.number(), cache_write: z.number() });

const result = z.object({ outcome: z.enum(["done", "blocked", "partial"]), summary: z.string(), verification: z.string() });

/** A call the run is waiting on, with what the tool does — what the person approves. */
const waitingCall = z.object({ id: z.string(), tool: z.string(), description: z.string(), input: z.unknown() });

export const runSummary = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.string(),
  turns: z.number(),
  tool_calls: z.number(),
  usage,
  result: result.optional(),
  reason: z.string().optional(),
  waiting_on: z.array(waitingCall).optional(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const runDetail = runSummary.extend({
  notes: z.array(z.string()),
  steps: z.array(z.object({ kind: z.string(), tool: z.string().optional(), outcome: z.string(), ms: z.number().optional(), at: z.iso.datetime() })),
  transcript: z.array(z.unknown()),
});
