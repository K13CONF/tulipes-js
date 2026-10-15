import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { identifyApiToken, issueToken, revokeToken } from "@app/auth";
import type { RuntimeCtx } from "@tulipes/core/boot";
import type { Auth } from "@tulipes/core/http";
import { useTestApp } from "@tulipes/testing";

import { testEnv, testSettings } from "../../../tests/support.ts";
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
  expect(started.actor).toMatchObject({ scopes: ["hello:web:*"], tokenId: issued.token_id });

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

test("starting a run needs the key, and a signed-in caller", async () => {
  const guest: Auth = { isAuthenticated: false, user: null, session: null };
  await expect(startRun(ctx(), guest, { goal: "x" })).rejects.toMatchObject({ status: 401 });

  // The key is a read-only environment value; a deployment without it is a config without it.
  const unconfigured = { config: { agents: {} } } as unknown as RuntimeCtx;
  await expect(startRun(unconfigured, await caller("user"), { goal: "x" })).rejects.toMatchObject({ status: 503, code: "AGENT_UNCONFIGURED" });
});
