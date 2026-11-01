import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { identifyApiToken, issueToken, revokeToken } from "@app/auth";
import type { RuntimeCtx } from "@tulipes/core/boot";
import type { Auth } from "@tulipes/core/http";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";
import { MongoRunStore } from "../helpers/adapters/mongo-run-store.ts";
import { composeLoop } from "../helpers/compose.ts";
import type { TranscriptMessage } from "../helpers/harness/contracts.ts";
import { startRun } from "../helpers/runs.ts";
import { ScriptedModel, finish, toolUse, turn } from "./support/fakes.ts";

/*
 * The harness composed for real — the Mongo store, the app's own actions
 * through ctx.agent, the auth module's identity — with only the model
 * scripted. Runs are created through startRun, as the door will create
 * them, and driven by composeLoop, as the worker's processor does.
 */

const KEY = "sk-ant-test-" + randomBytes(16).toString("hex");
const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const app = useTestApp(
  { rootDir, env: { ...testEnv(), ANTHROPIC_API_KEY: KEY }, settings: { ...testSettings(), agents: { approval: "writes" } } },
  { beforeAll, afterAll },
);

const ctx = () => app.handle.ctx as RuntimeCtx;

/** A signed-in caller as the request pipeline would resolve one, by role. */
async function caller(role: "user" | "admin"): Promise<Auth> {
  const account = await app.as(role);
  const user = await ctx().models!.get("User").findById(account.userId);
  return { isAuthenticated: true, user: user as unknown as Auth["user"], session: null };
}

function results(messages: readonly TranscriptMessage[]) {
  const last = messages.findLast((message) => message.role === "user" && Array.isArray(message.content));
  return (last?.content ?? []) as { tool_use_id: string; content: string; is_error?: boolean }[];
}

test("a run started for a user reads through the real registry, persists every step and ends on run_finish", async () => {
  const auth = await caller("user");
  const started = await startRun(ctx(), auth, { goal: "How many greetings are there?" });
  expect(started.status).toBe("queued");

  const read = toolUse("hello_web_greetings");
  const model = new ScriptedModel([turn([read]), turn([finish("done", "There are greetings.", "Listed them.")])]);
  const run = await composeLoop(ctx(), { model }).run(started.id);

  expect(run).toMatchObject({ status: "succeeded", turns: 2, result: { outcome: "done" } });
  // The tool list is what the manifest offers this user, sorted, then the harness's two.
  expect(model.requests[0]!.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["hello_web_greetings", "run_finish", "run_note"]));
  expect(model.requests[0]!.tools.map((tool) => tool.name)).not.toContain("hello_bo_greetings_reset");
  const [answer] = results(model.requests[1]!.messages);
  expect(answer).toMatchObject({ tool_use_id: read.id });
  expect(answer!.is_error).toBeUndefined();

  // Stored as the app stores everything: snake_case, a timeline, an expiry.
  const stored = await ctx().models!.get("AgentRun").findById(started.id).lean() as Record<string, unknown>;
  expect(stored).toMatchObject({ status: "succeeded", tool_calls: 2, turns: 2 });
  expect((stored.steps as { kind: string }[]).map((step) => step.kind)).toEqual(expect.arrayContaining(["model", "tool", "end"]));
  expect(stored.expires_at).toBeInstanceOf(Date);
  // The key is nowhere in what was stored.
  expect(JSON.stringify(stored)).not.toContain(KEY);
});

test("an admin's write waits for approval; the decision is honoured on the next job", async () => {
  const auth = await caller("admin");
  const started = await startRun(ctx(), auth, { goal: "Reset the greeting counters." });
  const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
  const model = new ScriptedModel([turn([reset]), turn([finish()])]);

  const waiting = await composeLoop(ctx(), { model }).run(started.id);
  expect(waiting).toMatchObject({ status: "waiting_approval", pending: [{ id: reset.id, name: "hello_bo_greetings_reset" }] });

  await ctx().models!.get("AgentRun").updateOne({ _id: started.id }, { $set: { [`decisions.${reset.id}`]: "allow" } });
  const done = await composeLoop(ctx(), { model }).run(started.id);

  expect(done.status).toBe("succeeded");
  expect(results(model.requests[1]!.messages)[0]!.content).toMatch(/"reset":\d+/);
});

test("a run started with a scoped API token is refused outside its scopes, and stops when the token is revoked", async () => {
  const account = await app.as("admin");
  const issued = await issueToken(ctx(), account.userId, { name: "agent", scopes: ["hello:web:*"] });
  const auth = (await identifyApiToken(ctx(), issued.secret))!;
  const started = await startRun(ctx(), auth, { goal: "Reset the counters." });
  const stored = await ctx().models!.get("AgentRun").findById(started.id).lean() as Record<string, unknown>;
  expect(stored).toMatchObject({ scopes: ["hello:web:*"], token_id: issued.token_id });

  // The admin could reset; the token's scopes cannot, so the tool is not even offered —
  // and a call to it anyway comes back as the registry's refusal.
  const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
  const model = new ScriptedModel([
    turn([reset]),
    async () => {
      await revokeToken(ctx(), account.userId, issued.token_id);
      return turn([toolUse("hello_web_greetings")]);
    },
  ]);

  const run = await composeLoop(ctx(), { model }).run(started.id);

  expect(model.requests[0]!.tools.map((tool) => tool.name)).not.toContain("hello_bo_greetings_reset");
  expect(results(model.requests[1]!.messages)[0]).toMatchObject({ is_error: true, content: expect.stringContaining("No tool named") });
  expect(run).toMatchObject({ status: "failed", reason: "credential_revoked" });
});

test("a run started from a session stops once the owner changes their password", async () => {
  const user = await app.as("user");
  const started = await app.post<{ id: string }>(app.api("/agents/runs"), { goal: "List the greetings." }, { as: user });
  expect(started.status).toBe(202);
  const stored = await ctx().models!.get("AgentRun").findById(started.data!.id).lean() as Record<string, unknown>;
  expect(stored).toMatchObject({ session_id: expect.any(String) });
  expect(stored).not.toHaveProperty("token_id");

  const model = new ScriptedModel([
    turn([toolUse("hello_web_greetings")]),
    async () => {
      const changed = await app.post(app.api("/auth/password"), { password: randomBytes(24).toString("hex") }, { as: user });
      expect(changed.status).toBe(200);
      return turn([toolUse("hello_web_greetings")]);
    },
  ]);

  const run = await composeLoop(ctx(), { model }).run(started.data!.id);
  expect(run).toMatchObject({ status: "failed", reason: "credential_revoked" });
});

test("starting a run needs the key, and a signed-in caller", async () => {
  const guest: Auth = { isAuthenticated: false, user: null, session: null };
  await expect(startRun(ctx(), guest, { goal: "x" })).rejects.toMatchObject({ status: 401 });

  // The key is a read-only environment value; a deployment without it is a config without it.
  const unconfigured = { config: { agents: {} } } as unknown as RuntimeCtx;
  await expect(startRun(unconfigured, await caller("user"), { goal: "x" })).rejects.toMatchObject({ status: 503, code: "AGENT_UNCONFIGURED" });
});

// ── The door ─────────────────────────────────────────────────────────

type Summary = { id: string; status: string; result?: { outcome: string }; waiting_on?: { id: string; tool: string; description: string }[]; reason?: string };

test("over HTTP: start answers 202 queued, the run is read back with its result, and the list leaves transcripts out", async () => {
  const user = await app.as("user");
  const started = await app.post<Summary>(app.api("/agents/runs"), { goal: "How many greetings are there?" }, { as: user });
  expect(started.status).toBe(202);
  expect(started.data).toMatchObject({ status: "queued", turns: 0 });

  await composeLoop(ctx(), { model: new ScriptedModel([turn([finish("done", "Three.", "Listed them.")])]) }).run(started.data!.id);

  const read = await app.get<Summary & { transcript: unknown[]; steps: unknown[] }>(app.api(`/agents/runs/${started.data!.id}`), { as: user });
  expect(read.status).toBe(200);
  expect(read.data).toMatchObject({ status: "succeeded", result: { outcome: "done" } });
  expect(read.data!.transcript.length).toBeGreaterThan(1);

  const list = await app.get<Record<string, unknown>[]>(app.api("/agents/runs"), { as: user });
  expect(list.data!.map((run) => run.id)).toContain(started.data!.id);
  expect(list.data!.every((run) => !("transcript" in run))).toBe(true);
  expect(list.body.meta).toMatchObject({ total_items: expect.any(Number) });
});

test("over HTTP: a waiting run says what it waits on; approval must answer every call, then queues the run again", async () => {
  const admin = await app.as("admin");
  const started = await app.post<Summary>(app.api("/agents/runs"), { goal: "Reset the counters." }, { as: admin });
  const reset = toolUse("hello_bo_greetings_reset", { confirm: true });
  const model = new ScriptedModel([turn([reset]), turn([finish()])]);
  await composeLoop(ctx(), { model }).run(started.data!.id);

  const waiting = await app.get<Summary>(app.api(`/agents/runs/${started.data!.id}`), { as: admin });
  expect(waiting.data).toMatchObject({ status: "waiting_approval", waiting_on: [{ id: reset.id, tool: "hello_bo_greetings_reset", description: expect.stringContaining("Reset") }] });

  const incomplete = await app.post(app.api(`/agents/runs/${started.data!.id}/approve`), { decisions: { toolu_other: "allow" } }, { as: admin });
  expect(incomplete.status).toBe(422);
  expect(incomplete.errors[0]).toMatchObject({ code: "DECISIONS_INCOMPLETE" });

  const approved = await app.post<Summary>(app.api(`/agents/runs/${started.data!.id}/approve`), { decisions: { [reset.id]: "allow" } }, { as: admin });
  expect(approved.data).toMatchObject({ status: "queued" });
  // A second answer to the same wait finds nothing waiting.
  expect((await app.post(app.api(`/agents/runs/${started.data!.id}/approve`), { decisions: { [reset.id]: "allow" } }, { as: admin })).status).toBe(409);

  expect((await composeLoop(ctx(), { model }).run(started.data!.id)).status).toBe("succeeded");
});

test("over HTTP: another person's run is not found; the back office reads and cancels any run", async () => {
  const owner = await app.as("user");
  const other = await app.register();
  const admin = await app.as("admin");
  const { data } = await app.post<Summary>(app.api("/agents/runs"), { goal: "x" }, { as: owner });

  expect((await app.get(app.api(`/agents/runs/${data!.id}`), { as: other })).status).toBe(404);
  expect((await app.post(app.api(`/agents/runs/${data!.id}/cancel`), undefined, { as: other })).status).toBe(404);
  expect((await app.get(app.api(`/agents/bo/runs`), { as: owner })).status).toBe(403);

  expect((await app.get(app.api(`/agents/bo/runs/${data!.id}`), { as: admin })).status).toBe(200);
  const cancelled = await app.post<Summary>(app.api(`/agents/bo/runs/${data!.id}/cancel`), undefined, { as: admin });
  expect(cancelled.data).toMatchObject({ status: "cancelled" });
  expect((await app.post(app.api(`/agents/runs/${data!.id}/cancel`), undefined, { as: owner })).status).toBe(409);

  // A job that picks a cancelled run up stops there and asks the model nothing.
  const model = new ScriptedModel([]);
  expect((await composeLoop(ctx(), { model }).run(data!.id)).status).toBe("cancelled");
  expect(model.requests).toEqual([]);
});

test("over HTTP: a token scoped away from agents cannot start one; a token scoped to them can, and the run keeps its scopes", async () => {
  const account = await app.as("user");
  const narrow = await issueToken(ctx(), account.userId, { name: "hello only", scopes: ["hello:web:*"] });
  const refused = await app.post(app.api("/agents/runs"), { goal: "x" }, { token: narrow.secret });
  expect(refused.status).toBe(403);
  expect(refused.errors[0]).toMatchObject({ code: "OUT_OF_SCOPE" });

  const agentic = await issueToken(ctx(), account.userId, { name: "agent", scopes: ["agents:web:runs:*", "hello:web:*"] });
  const started = await app.post<Summary>(app.api("/agents/runs"), { goal: "x" }, { token: agentic.secret });
  expect(started.status).toBe(202);
  const stored = await ctx().models!.get("AgentRun").findById(started.data!.id).lean() as Record<string, unknown>;
  expect(stored).toMatchObject({ scopes: ["agents:web:runs:*", "hello:web:*"], token_id: agentic.token_id });
});

test("over HTTP: the input is validated, and a guest is refused", async () => {
  const user = await app.as("user");
  const blank = await app.post(app.api("/agents/runs"), { goal: "   " }, { as: user });
  expect(blank.status).toBe(422);
  expect(blank.errors[0]).toMatchObject({ field: "goal" });
  expect((await app.get(app.api("/agents/runs/not-an-id"), { as: user })).status).toBe(422);
  expect((await app.post(app.api("/agents/runs"), { goal: "x" })).status).toBe(401);
});

test("the Mongo store hands the execution claim to one job; a takeover after a crash still claims", async () => {
  const store = new MongoRunStore(ctx(), { retentionDays: 1 });
  const started = await startRun(ctx(), await caller("user"), { goal: "Claim it." });

  expect(await store.beginExecution(started.id)).toMatchObject({ executing: true });
  expect(await store.beginExecution(started.id)).toBeNull();
  expect(await store.beginExecution(started.id, { takeover: true })).toMatchObject({ executing: true });
});
