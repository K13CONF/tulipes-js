import { describe, expect, test } from "vitest";

import type { BetaToolResultBlockParam as ToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { ModelRejected, type ApprovalPolicy, type RunLimits, type TranscriptMessage } from "../helpers/harness/contracts.ts";
import { FanOutEvents } from "../helpers/harness/events.ts";
import { BudgetLimits, type Budgets } from "../helpers/harness/limits.ts";
import { ModeApprovalPolicy } from "../helpers/harness/policy.ts";
import { HARNESS_TOOLS, NUDGE, openingMessage, systemPrompt, type PromptPolicy } from "../helpers/harness/prompt.ts";
import { RunLoop } from "../helpers/harness/run-loop.ts";
import { ResultShaper } from "../helpers/harness/shaper.ts";
import { RepetitionGuard } from "../helpers/harness/trajectory.ts";
import { FakeIdentity, FakeTools, ManualClock, RecordedEvents, ScriptedModel, finish, rendezvous, text, toolUse, turn } from "./support/fakes.ts";
import { MemoryRunStore } from "./support/memory-store.ts";

/*
 * The harness on its own: the loop composed with a scripted model, faked
 * actions and an in-memory store. Unlike the module's other suites this
 * file boots no app and needs no service or key — it is the unit lane, run
 * by the root suite in CI as well as by the app's own.
 */

const POLICY: PromptPolicy = { approval: "writes", maxTurns: 30, maxToolCalls: 100, locale: "en", timezone: "UTC" };
const BUDGETS: Budgets = { maxTurns: 30, maxToolCalls: 100, maxOutputTokens: 200_000, maxRunMs: 600_000 };

const ok = (data: unknown) => ({ ok: true as const, data });

function compose(options: {
  model: ScriptedModel;
  tools?: FakeTools;
  policy?: ApprovalPolicy;
  limits?: RunLimits;
  maxChars?: number;
}) {
  const store = new MemoryRunStore();
  const identity = new FakeIdentity();
  const clock = new ManualClock();
  const events = new RecordedEvents();
  const tools = options.tools ?? new FakeTools([]);
  const loop = new RunLoop({
    store,
    model: options.model,
    tools,
    policy: options.policy ?? new ModeApprovalPolicy("writes"),
    limits: options.limits ?? new BudgetLimits(BUDGETS),
    guard: new RepetitionGuard(),
    results: new ResultShaper(options.maxChars ?? 8_000),
    identity,
    events,
    clock,
    system: (modules) => systemPrompt({ app: "test-app", modules, policy: POLICY }),
    settings: { maxTokens: 32_000, retryMaxTokens: 64_000 },
  });
  store.create("r1", [openingMessage("Count the greetings.")]);
  return { loop, store, identity, clock, events, tools, model: options.model };
}

/** The tool_result blocks of the transcript's last user message. */
function lastResults(transcript: TranscriptMessage[]): ToolResultBlockParam[] {
  const message = transcript.findLast((entry) => entry.role === "user" && Array.isArray(entry.content));
  return (message?.content ?? []) as ToolResultBlockParam[];
}

describe("a run", () => {
  test("answers parallel read-only calls together in one message, then ends on run_finish with what it verified", async () => {
    const both = rendezvous(2);
    const tools = new FakeTools([
      { name: "hello_web_greetings", readOnly: true, handler: async () => { await both(); return ok([{ name: "Hello", times_used: 3 }]); } },
      { name: "users_web_me", readOnly: true, handler: async () => { await both(); return ok({ email: "a@example.test" }); } },
    ]);
    const a = toolUse("hello_web_greetings");
    const b = toolUse("users_web_me");
    const model = new ScriptedModel([
      turn([text("Looking."), a, b]),
      turn([finish("done", "There is one greeting, used 3 times.", "Listed the greetings.")]),
    ]);
    const { loop, store } = compose({ model, tools });

    const run = await loop.run("r1");

    expect(run.status).toBe("succeeded");
    expect(run.result).toEqual({ outcome: "done", summary: "There is one greeting, used 3 times.", verification: "Listed the greetings." });
    // Opening goal, the turn, ONE user message with both results, the finishing turn, its result.
    expect(run.transcript.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    const results = run.transcript[2]!.content as ToolResultBlockParam[];
    expect(results.map((result) => result.tool_use_id)).toEqual([a.id, b.id]);
    expect(results.every((result) => result.is_error === undefined)).toBe(true);
    expect(run.turns).toBe(2);
    expect(run.toolCalls).toBe(3);
    expect(run.usage.output).toBe(40);
    expect(store.writes.length).toBeGreaterThan(0);
  });

  test("sends the sectioned system prompt and the app's tools followed by the harness's own", async () => {
    const tools = new FakeTools([{ name: "hello_web_greetings", readOnly: true, handler: () => ok([]) }]);
    const model = new ScriptedModel([turn([finish()])]);
    await compose({ model, tools }).loop.run("r1");

    const [request] = model.requests;
    const sections = ["<role>", "<rules>", "<application>", "<finishing>", "<policy>"].map((tag) => request!.system.indexOf(tag));
    expect(sections.every((index) => index >= 0)).toBe(true);
    expect([...sections].sort((x, y) => x - y)).toEqual(sections);
    expect(request!.system).toContain("- hello: Greets callers.");
    expect(request!.tools.map((tool) => tool.name)).toEqual(["hello_web_greetings", ...HARNESS_TOOLS.map((tool) => tool.name)]);
    expect(request!.maxTokens).toBe(32_000);
    expect(request!.messages[0]).toEqual(openingMessage("Count the greetings."));
  });
});

describe("approval", () => {
  test("a writing call waits for the owner; the run resumes on approval without asking the model again", async () => {
    const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
    const tools = new FakeTools([{ name: "hello_bo_greetings_reset", readOnly: false, handler: () => ok({ reset: 2 }) }]);
    const model = new ScriptedModel([turn([reset]), turn([finish()])]);
    const { loop, store } = compose({ model, tools });

    const waiting = await loop.run("r1");
    expect(waiting.status).toBe("waiting_approval");
    expect(waiting.pending).toEqual([{ id: reset.id, name: "hello_bo_greetings_reset", input: { confirm: true } }]);
    expect(tools.calls).toEqual([]);

    // A job that runs before anyone answered changes nothing and calls no model.
    expect((await loop.run("r1")).status).toBe("waiting_approval");
    expect(model.requests).toHaveLength(1);

    store.decide("r1", { [reset.id]: "allow" });
    const done = await loop.run("r1");
    expect(done.status).toBe("succeeded");
    expect(tools.calls).toEqual([{ name: "hello_bo_greetings_reset", input: { confirm: true } }]);
    expect(lastResults(done.transcript.slice(0, 3))[0]).toMatchObject({ tool_use_id: reset.id, content: '{"reset":2}' });
  });

  test("a declined call reaches the model as an error it can act on", async () => {
    const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
    const tools = new FakeTools([{ name: "hello_bo_greetings_reset", readOnly: false, handler: () => ok({}) }]);
    const model = new ScriptedModel([turn([reset]), turn([finish("blocked")])]);
    const { loop, store } = compose({ model, tools });

    await loop.run("r1");
    store.decide("r1", { [reset.id]: "deny" });
    const run = await loop.run("r1");

    expect(tools.calls).toEqual([]);
    const [result] = lastResults(model.requests[1]!.messages as TranscriptMessage[]);
    expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("Declined by the person who started the run") });
    expect(run.result?.outcome).toBe("blocked");
  });

  test("the modes: none runs everything, writes asks for writes, all asks for everything", () => {
    const read = { name: "r", description: "", input_schema: {}, readOnly: true };
    const write = { ...read, readOnly: false };
    expect([read, write].map((tool) => new ModeApprovalPolicy("none").decide(tool, undefined))).toEqual(["allow", "allow"]);
    expect([read, write].map((tool) => new ModeApprovalPolicy("writes").decide(tool, undefined))).toEqual(["allow", "ask"]);
    expect([read, write].map((tool) => new ModeApprovalPolicy("all").decide(tool, undefined))).toEqual(["ask", "ask"]);
    expect(new ModeApprovalPolicy("all").decide(write, "deny")).toBe("deny");
  });
});

describe("errors reach the model as something to act on", () => {
  test("a refusal from the app, an unknown tool and a crashing handler each come back as is_error, and the run goes on", async () => {
    const forbidden = toolUse("users_bo_list");
    const invalid = toolUse("hello_web_greet", { name: 4 });
    const crash = toolUse("hello_web_broken");
    const ghost = toolUse("does_not_exist");
    const tools = new FakeTools([
      { name: "users_bo_list", readOnly: true, handler: () => ({ ok: false, message: "403: this credential is not scoped to users:bo:list (OUT_OF_SCOPE)" }) },
      { name: "hello_web_greet", readOnly: true, handler: () => ({ ok: false, message: "422: name: expected string, received number" }) },
      { name: "hello_web_broken", readOnly: true, handler: () => { throw new Error("connection string mongodb://secret@db"); } },
    ]);
    const model = new ScriptedModel([turn([forbidden, invalid, crash, ghost]), turn([finish("partial")])]);
    const { loop } = compose({ model, tools });

    const run = await loop.run("r1");

    expect(run.status).toBe("succeeded");
    const results = lastResults(model.requests[1]!.messages as TranscriptMessage[]);
    expect(results.map((result) => result.is_error)).toEqual([true, true, true, true]);
    expect(results[0]!.content).toContain("OUT_OF_SCOPE");
    expect(results[1]!.content).toContain("expected string");
    // An unexpected failure says so without leaking what the exception carried.
    expect(results[2]!.content).toContain("failed unexpectedly");
    expect(results[2]!.content).not.toContain("secret");
    expect(results[3]!.content).toContain('No tool named "does_not_exist"');
  });

  test("an invalid run_finish is answered as an error and does not end the run", async () => {
    const model = new ScriptedModel([turn([toolUse("run_finish", { outcome: "great" })]), turn([finish()])]);
    const run = await compose({ model }).loop.run("r1");
    expect(lastResults(model.requests[1]!.messages as TranscriptMessage[])[0]).toMatchObject({ is_error: true });
    expect(run.status).toBe("succeeded");
    expect(run.turns).toBe(2);
  });
});

describe("resume", () => {
  test("after a crash mid-call, reads run again and a write is never re-run", async () => {
    const read = toolUse("hello_web_greetings");
    const write = toolUse("hello_bo_greetings_reset", { confirm: true });
    const tools = new FakeTools([
      { name: "hello_web_greetings", readOnly: true, handler: () => ok([]) },
      { name: "hello_bo_greetings_reset", readOnly: false, handler: () => ok({ reset: 1 }) },
    ]);
    const model = new ScriptedModel([turn([finish("partial")])]);
    const { loop, store } = compose({ model, tools });
    // What a worker leaves behind when it dies between beginExecution and appendResults.
    store.patch("r1", (run) => {
      run.status = "running";
      run.transcript.push({ role: "assistant", content: [read, write] });
      run.pending = [{ id: read.id, name: read.name, input: read.input }, { id: write.id, name: write.name, input: write.input }];
      run.decisions = { [write.id]: "allow" };
      run.executing = true;
      run.turns = 1;
    });

    const run = await loop.run("r1");

    expect(tools.calls.map((call) => call.name)).toEqual(["hello_web_greetings"]);
    const results = lastResults(model.requests[0]!.messages as TranscriptMessage[]);
    expect(results[0]).not.toHaveProperty("is_error");
    expect(results[1]).toMatchObject({ is_error: true, content: expect.stringContaining("interrupted") });
    expect(run.status).toBe("succeeded");
  });

  test("a run already ended is returned as it is", async () => {
    const model = new ScriptedModel([]);
    const { loop, store } = compose({ model });
    store.cancel("r1");
    expect((await loop.run("r1")).status).toBe("cancelled");
    expect(model.requests).toEqual([]);
  });

  test("a cancellation written while a tool runs is seen at the next write, and nothing more is asked of the model", async () => {
    let cancel = () => {};
    const tools = new FakeTools([{ name: "hello_web_greetings", readOnly: true, handler: () => { cancel(); return ok([]); } }]);
    const model = new ScriptedModel([turn([toolUse("hello_web_greetings")]), turn([finish()])]);
    const composed = compose({ model, tools });
    cancel = () => composed.store.cancel("r1");

    const run = await composed.loop.run("r1");

    expect(run.status).toBe("cancelled");
    expect(model.remaining).toBe(1);
  });
});

describe("limits and trajectory", () => {
  test("a run out of turns ends exhausted, transcript intact", async () => {
    const tools = new FakeTools([{ name: "hello_web_greetings", readOnly: true, handler: () => ok([]) }]);
    const model = new ScriptedModel([turn([toolUse("hello_web_greetings", { page: 1 })]), turn([toolUse("hello_web_greetings", { page: 2 })])]);
    const { loop } = compose({ model, tools, limits: new BudgetLimits({ ...BUDGETS, maxTurns: 2 }) });

    const run = await loop.run("r1");

    expect(run).toMatchObject({ status: "exhausted", reason: "max_turns", turns: 2 });
    expect(run.transcript).toHaveLength(5);
  });

  test("time waiting for approval is not work: max_run_ms counts only the jobs' own time", async () => {
    const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
    const tools = new FakeTools([{ name: "hello_bo_greetings_reset", readOnly: false, handler: () => ok({}) }]);
    const composed = compose({
      model: new ScriptedModel([
        () => { composed.clock.time += 40_000; return turn([reset]); },
        turn([finish()]),
      ]),
      tools,
      limits: new BudgetLimits({ ...BUDGETS, maxRunMs: 60_000 }),
    });

    expect((await composed.loop.run("r1")).elapsedMs).toBe(40_000);
    composed.clock.time += 3_600_000;
    composed.store.decide("r1", { [reset.id]: "allow" });
    const run = await composed.loop.run("r1");

    expect(run).toMatchObject({ status: "succeeded", elapsedMs: 40_000 });
  });

  test("working past max_run_ms ends the run exhausted before the next turn", async () => {
    const tools = new FakeTools([{ name: "hello_web_greetings", readOnly: true, handler: () => ok([]) }]);
    const composed = compose({
      model: new ScriptedModel([() => { composed.clock.time += 70_000; return turn([toolUse("hello_web_greetings")]); }]),
      tools,
      limits: new BudgetLimits({ ...BUDGETS, maxRunMs: 60_000 }),
    });

    const run = await composed.loop.run("r1");

    expect(run).toMatchObject({ status: "exhausted", reason: "max_run_ms", elapsedMs: 70_000 });
  });

  test("the same call three times draws an operator note; five times fails the run as stuck", async () => {
    const tools = new FakeTools([{ name: "hello_web_greetings", readOnly: true, handler: () => ok([]) }]);
    const model = new ScriptedModel(Array.from({ length: 5 }, () => turn([toolUse("hello_web_greetings", { page: 1 })])));
    const { loop } = compose({ model, tools });

    const run = await loop.run("r1");

    expect(run.status).toBe("failed");
    expect(run.reason).toMatch(/^stuck: "hello_web_greetings" called 5 times/);
    const notes = run.transcript.filter((message) => message.role === "system");
    expect(notes).toHaveLength(2);
    expect(notes[0]!.content).toContain("3 times in a row");
  });

  test("three errors in a row from one tool fail the run", async () => {
    const tools = new FakeTools([{ name: "hello_web_greet", readOnly: true, handler: () => ({ ok: false, message: "422: bad" }) }]);
    const model = new ScriptedModel([1, 2, 3].map((n) => turn([toolUse("hello_web_greet", { attempt: n })])));
    const run = await compose({ model, tools }).loop.run("r1");
    expect(run).toMatchObject({ status: "failed", reason: 'stuck: "hello_web_greet" failed 3 times in a row' });
  });

  test("a revoked credential ends the run before the model is asked anything", async () => {
    const model = new ScriptedModel([]);
    const composed = compose({ model });
    composed.identity.actor = null;

    const run = await composed.loop.run("r1");

    expect(run).toMatchObject({ status: "failed", reason: "credential_revoked" });
    expect(model.requests).toEqual([]);
    expect(composed.events.events).toContainEqual(expect.objectContaining({ kind: "identity", outcome: "revoked" }));
  });
});

describe("stop reasons", () => {
  test("max_tokens is retried once with the larger budget, and both turns' tokens are counted", async () => {
    const model = new ScriptedModel([turn([text("Partial")], "max_tokens"), turn([finish()])]);
    const run = await compose({ model }).loop.run("r1");
    expect(model.requests.map((request) => request.maxTokens)).toEqual([32_000, 64_000]);
    expect(run.status).toBe("succeeded");
    expect(run.usage.output).toBe(40);
    // The cut-off turn was never appended.
    expect(run.transcript.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  test("a turn cut off twice fails the run without appending it", async () => {
    const model = new ScriptedModel([turn([text("a")], "max_tokens"), turn([text("b")], "max_tokens")]);
    const run = await compose({ model }).loop.run("r1");
    expect(run).toMatchObject({ status: "failed", reason: "truncated" });
    expect(run.transcript).toHaveLength(1);
  });

  test("a refusal fails the run with its category", async () => {
    const refused = { ...turn([text("")], "refusal"), refusalCategory: "cyber" };
    const run = await compose({ model: new ScriptedModel([refused]) }).loop.run("r1");
    expect(run).toMatchObject({ status: "failed", reason: "refusal:cyber" });
  });

  test("pause_turn continues without tool results", async () => {
    const model = new ScriptedModel([turn([text("Still searching")], "pause_turn"), turn([finish()])]);
    const run = await compose({ model }).loop.run("r1");
    expect(run.status).toBe("succeeded");
    expect(model.requests[1]!.messages.at(-1)!.role).toBe("assistant");
  });

  test("a plain end is nudged once toward run_finish, then accepted as partial", async () => {
    const model = new ScriptedModel([turn([text("All done!")]), turn([text("Really done.")])]);
    const run = await compose({ model }).loop.run("r1");

    expect(model.requests[1]!.messages.at(-1)).toEqual({ role: "user", content: NUDGE });
    expect(run.status).toBe("succeeded");
    expect(run.result).toMatchObject({ outcome: "partial", summary: "Really done." });
  });
});

describe("the transcript is append-only", () => {
  test("no write ever edits or removes a message already stored, through approval, notes and a nudge", async () => {
    const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
    const tools = new FakeTools([
      { name: "hello_web_greetings", readOnly: true, handler: () => ok([]) },
      { name: "hello_bo_greetings_reset", readOnly: false, handler: () => ok({ reset: 1 }) },
    ]);
    const model = new ScriptedModel([
      ...Array.from({ length: 3 }, () => turn([toolUse("hello_web_greetings", { page: 1 })])),
      turn([toolUse("run_note", { text: "Listed three times." }), reset]),
      turn([text("Finished.")]),
      turn([finish()]),
    ]);
    const { loop, store } = compose({ model, tools });

    await loop.run("r1");
    store.decide("r1", { [reset.id]: "allow" });
    const run = await loop.run("r1");

    expect(run.status).toBe("succeeded");
    expect(run.notes).toEqual(["Listed three times."]);
    for (let index = 1; index < store.writes.length; index++) {
      const before = store.writes[index - 1]!;
      expect(store.writes[index]!.slice(0, before.length)).toEqual(before);
    }
    // And every request the model got extends the one before it.
    for (let index = 1; index < model.requests.length; index++) {
      const before = model.requests[index - 1]!.messages;
      expect(model.requests[index]!.messages.slice(0, before.length)).toEqual(before);
    }
  });
});

describe("the result shaper", () => {
  test("a long value is cut with a note saying how much was shown and how to ask for less", () => {
    const shaped = new ResultShaper(1_000).shape(ok("x".repeat(5_000)));
    expect(shaped.length).toBeLessThan(1_100);
    expect(shaped).toContain("800 of 5000 characters shown");
  });

  test("a long list keeps the items that fit and says how many there were", () => {
    const items = Array.from({ length: 400 }, (_, index) => ({ id: index, name: `greeting ${index}` }));
    const shaped = new ResultShaper(2_000).shape(ok(items));
    const [json, note] = shaped.split("\n");
    const kept = JSON.parse(json!) as unknown[];
    expect(kept.length).toBeGreaterThan(10);
    expect(note).toContain(`${kept.length} of 400 items shown`);
  });

  test("a list inside an object is shortened in place", () => {
    const shaped = new ResultShaper(1_000).shape(ok({ total: 400, items: Array.from({ length: 400 }, (_, id) => ({ id })) }));
    expect(JSON.parse(shaped.split("\n")[0]!)).toMatchObject({ total: 400 });
  });

  test("a short result is compact JSON, and an error is its message", () => {
    expect(new ResultShaper(1_000).shape(ok({ a: 1 }))).toBe('{"a":1}');
    expect(new ResultShaper(1_000).shape(ok(undefined))).toBe("null");
    expect(new ResultShaper(1_000).shape({ ok: false, message: "403: no" })).toBe("403: no");
  });
});

describe("events", () => {
  test("a failing sink never stops the others or the run", async () => {
    const seen: string[] = [];
    const failures: unknown[] = [];
    const events = new FanOutEvents([
      { emit: () => { throw new Error("socket down"); } },
      { emit: (event) => { seen.push(event.outcome); } },
    ], (error) => failures.push(error));

    await events.emit({ runId: "r1", kind: "model", outcome: "end_turn" });

    expect(seen).toEqual(["end_turn"]);
    expect(failures).toHaveLength(1);
  });
});

describe("edges", () => {
  test("every budget is checked: tool calls and output tokens as well as turns and time", () => {
    const limits = new BudgetLimits({ ...BUDGETS, maxToolCalls: 2, maxOutputTokens: 1_000 });
    const base = new MemoryRunStore().create("x", []);
    expect(limits.check({ ...base, toolCalls: 2 }, 0)).toBe("max_tool_calls");
    expect(limits.check({ ...base, usage: { ...base.usage, output: 1_000 } }, 0)).toBe("max_output_tokens");
    expect(limits.check(base, 0)).toBeUndefined();
  });

  test("the prompt states each approval mode, an app with no tools, and a goal's attached context", () => {
    const none = systemPrompt({ app: "a", modules: [], policy: { ...POLICY, approval: "none" } });
    expect(none).toContain("run without asking anyone");
    expect(none).toContain("(no module offers you a tool)");
    expect(systemPrompt({ app: "a", modules: [], policy: { ...POLICY, approval: "all" } })).toContain("Every tool call waits");
    expect(openingMessage("Do it.", "The customer is Ada.")).toEqual({ role: "user", content: "<goal>\nDo it.\n</goal>\n\n<context>\nThe customer is Ada.\n</context>" });
  });

  test("an empty run_note and a run_finish with a blank summary are refused, and a malformed input is not a crash", async () => {
    const model = new ScriptedModel([
      turn([toolUse("run_note", { text: "  " }), toolUse("run_finish", { outcome: "done", summary: " ", verification: "x" })]),
      turn([toolUse("run_note", null), toolUse("run_finish", "done")]),
      turn([finish()]),
    ]);
    const run = await compose({ model }).loop.run("r1");
    for (const request of model.requests.slice(1)) {
      expect(lastResults(request.messages as TranscriptMessage[]).map((result) => result.is_error)).toEqual([true, true]);
    }
    expect(run).toMatchObject({ status: "succeeded", notes: [] });
  });

  test("a policy that denies outright says so, without blaming the person", async () => {
    const tools = new FakeTools([{ name: "users_bo_delete", readOnly: false, handler: () => ok({}) }]);
    const model = new ScriptedModel([turn([toolUse("users_bo_delete")]), turn([finish("blocked")])]);
    await compose({ model, tools, policy: { decide: () => "deny" } }).loop.run("r1");
    expect(tools.calls).toEqual([]);
    expect(lastResults(model.requests[1]!.messages as TranscriptMessage[])[0]!.content).toContain("policy");
  });

  test("a refusal without a category, and a context window filled, each end the run with a reason", async () => {
    expect(await compose({ model: new ScriptedModel([turn([text("")], "refusal")]) }).loop.run("r1")).toMatchObject({ status: "failed", reason: "refusal" });
    expect(await compose({ model: new ScriptedModel([turn([text("")], "model_context_window_exceeded")]) }).loop.run("r1"))
      .toMatchObject({ status: "exhausted", reason: "context_window" });
  });

  test("the guard counts one tool's errors across other tools' calls, and a success resets it", () => {
    const guard = new RepetitionGuard();
    const use = (id: string, name: string, input: unknown = {}) => ({ role: "assistant" as const, content: [{ type: "tool_use" as const, id, name, input }] });
    const result = (id: string, error: boolean) => ({ role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: id, content: "", ...(error && { is_error: true }) }] });
    expect(guard.inspect([{ role: "user", content: "goal" }])).toEqual({ kind: "ok" });
    // a fails, b succeeds in between, a fails twice more: three in a row for a.
    expect(guard.inspect([use("1", "a", [1]), result("1", true), use("2", "b"), result("2", false), use("3", "a", [2]), result("3", true), use("4", "a", [3]), result("4", true)]))
      .toEqual({ kind: "fail", reason: '"a" failed 3 times in a row' });
    // A success of a's own breaks the run of errors.
    expect(guard.inspect([use("1", "a", [1]), result("1", true), use("2", "a", [2]), result("2", false), use("3", "a", [3]), result("3", true)])).toEqual({ kind: "ok" });
    // Inputs equal up to key order are the same call.
    expect(guard.inspect([use("1", "a", { x: 1, y: [1, 2] }), use("2", "a", { y: [1, 2], x: 1 }), use("3", "a", { x: 1, y: [1, 2] })]).kind).toBe("warn");
  });

  test("a sink failure with no handler is still swallowed", async () => {
    await expect(new FanOutEvents([{ emit: () => { throw new Error("x"); } }]).emit({ runId: "r", kind: "end", outcome: "done" })).resolves.toBeUndefined();
  });
});

describe("the model's own failures", () => {
  test("a request the API rejects ends the run with its reason; other failures throw, so the job retries", async () => {
    const rejected = new ScriptedModel([() => { throw new ModelRejected("model_rejected:400", "bad request"); }]);
    expect(await compose({ model: rejected }).loop.run("r1")).toMatchObject({ status: "failed", reason: "model_rejected:400" });

    const overloaded = new ScriptedModel([() => { throw new Error("529 overloaded"); }]);
    const { loop, store } = compose({ model: overloaded });
    await expect(loop.run("r1")).rejects.toThrow("529 overloaded");
    expect((await store.load("r1"))!.status).toBe("running");
  });

  test("a compaction stop appends the turn and asks the model again", async () => {
    const model = new ScriptedModel([turn([text("summary")], "compaction"), turn([finish()])]);
    const run = await compose({ model }).loop.run("r1");
    expect(run.status).toBe("succeeded");
    expect(model.requests[1]!.messages.at(-1)!.role).toBe("assistant");
  });
});
