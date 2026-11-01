import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { useTestApp } from "@tulipes/testing";
import { listQueryDefaults } from "@app/core";
import seedAdmin from "../../auth/bootstrap/seed-admin.bootstrap.ts";

import { testEnv, testSettings } from "../../../tests/support.ts";

const rootDir = fileURLToPath(new URL("../../../", import.meta.url));
const app = useTestApp({ rootDir, env: testEnv(), settings: testSettings() }, { beforeAll, afterAll });

/**
 * users:bo:list end to end: rai parses and polices the query, the core
 * helpers compile it, MongoDB answers. Every row this file seeds carries a
 * per-run tag in its email, and every request filters on it, so other
 * suites' users never change a count here.
 */
const tag = `q${randomBytes(4).toString("hex")}`;
const json = (value: unknown) => JSON.stringify(value);
const mine = ["email", "like", `@${tag}.test`];

type Row = { _id: string; email: string; role: string; created_at: string; sessions?: Array<Record<string, unknown>> };

let admin: { access_token: string };

beforeAll(async () => {
  const User = app.ctx.models!.get("User");
  const Session = app.ctx.models!.get("Session");
  const seed = [
    ["ada", "admin"], ["bob", "user"], ["cy", "user"], ["dee", "editor"], ["eve", "user"],
  ] as const;
  const users = [];
  for (const [index, [name, role]] of seed.entries()) {
    // Distinct created_at, so date filters and sorts have something to order.
    users.push(await User.create({ email: `${name}@${tag}.test`, role, created_at: new Date(Date.UTC(2026, 0, index + 1)) }));
  }
  const bob = users[1]!;
  for (let index = 0; index < 4; index++) {
    await Session.create({
      sid: `${tag}-${index}`, user: bob._id, credential_version: "v1", refresh_jti: `${tag}-jti-${index}`,
      ip: `10.0.0.${index}`, user_agent: "test", expires_at: new Date(Date.now() + 3_600_000),
      created_at: new Date(Date.UTC(2026, 1, index + 1)),
    });
  }
  // Soft-deleted rows never appear: the model's plugin scopes find, count and aggregate.
  const gone = await User.create({ email: `zed@${tag}.test`, role: "user" });
  await (gone as unknown as { softDelete(): Promise<unknown> }).softDelete();

  admin = await app.as("admin");
});

const browse = (query: Record<string, unknown>) =>
  app.get<Row[]>("/users/directory", { as: admin, query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, typeof value === "string" ? value : json(value)])) });

test("the core bootstrap sets the app-wide query time limit from config.pagination", () => {
  expect(listQueryDefaults().maxTimeMS).toBe(app.ctx.config.pagination!.maxTimeMs);
});

test("a signed-in user cannot list accounts; the back office can", async () => {
  const user = await app.register();
  expect((await app.get("/users", { as: user })).status).toBe(403);
  expect((await app.get("/users", { as: admin })).status).toBe(200);
});

test("only the back office may browse", async () => {
  const user = await app.register();
  expect((await app.get("/users/directory", { as: user })).status).toBe(403);
  expect((await app.get("/users/directory")).status).toBe(401);
});

test("filter, sort, project and paginate", async () => {
  const response = await browse({ filter: [mine, ["role", "=", "user"]], sort: [["created_at", "desc"]], fields: ["email"], per_page: "2" });

  expect(response.status).toBe(200);
  expect(response.data!.map((row) => row.email)).toEqual([`eve@${tag}.test`, `cy@${tag}.test`]);
  expect(Object.keys(response.data![0]!).sort()).toEqual(["_id", "email"]);
  expect(response.body.meta).toMatchObject({ page: 1, per_page: 2, total_items: 3, total_pages: 2 });

  const second = await browse({ filter: [mine, ["role", "=", "user"]], sort: [["created_at", "desc"]], per_page: "2", page: "2" });
  expect(second.data!.map((row) => row.email)).toEqual([`bob@${tag}.test`]);
});

test("or, in and date comparisons", async () => {
  const response = await browse({
    filter: [mine, ["or", ["role", "in", ["admin", "editor"]], ["created_at", ">=", "2026-01-05"]]],
    sort: ["email", "asc"],
  });
  expect(response.data!.map((row) => row.email)).toEqual([`ada@${tag}.test`, `dee@${tag}.test`, `eve@${tag}.test`]);
});

test("search matches the policy's fields, escaped", async () => {
  expect((await browse({ search: `bob@${tag}` })).data!.map((row) => row.email)).toEqual([`bob@${tag}.test`]);
  // A regex metacharacter is a literal: ".*" matches nobody.
  expect((await browse({ search: ".*", filter: [mine] })).data).toEqual([]);
});

test("resolve populates sessions with the policy's fields, sorted and capped per user", async () => {
  const response = await browse({
    filter: [["email", "=", `bob@${tag}.test`]],
    resolve: [["sessions", { fields: ["ip", "created_at"], sort: [["created_at", "desc"]], limit: 2 }]],
  });

  const [bob] = response.data!;
  expect(bob!.sessions!.map((session) => session.ip)).toEqual(["10.0.0.3", "10.0.0.2"]);
  for (const session of bob!.sessions!) {
    expect(session).not.toHaveProperty("refresh_jti");
    expect(session).not.toHaveProperty("user_agent");
  }

  const capped = await browse({ filter: [["email", "=", `bob@${tag}.test`]], resolve: ["sessions"] });
  expect(capped.data![0]!.sessions).toHaveLength(4);
});

test("group: flat buckets with a bucket count", async () => {
  const response = await browse({ filter: [mine], group: ["role"], sort: [["count", "desc"]] });

  expect(response.status).toBe(200);
  expect(response.data).toEqual([
    { key: { role: "user" }, count: 3 },
    { key: { role: "admin" }, count: 1 },
    { key: { role: "editor" }, count: 1 },
  ]);
  expect(response.body.meta).toMatchObject({ total_items: 3 });
});

test("group as a tree has the same buckets as top-level nodes", async () => {
  const response = await browse({ filter: [mine], group: ["role"], tree: "true", sort: [["role", "desc"]] });
  expect(response.data).toEqual([
    { key: "user", count: 3 },
    { key: "editor", count: 1 },
    { key: "admin", count: 1 },
  ]);
});

test("anything outside the policy is a 422 naming the value", async () => {
  const response = await browse({ filter: [["password_hash", "=", "x"]], sort: [["refresh_jti", "asc"]] });

  expect(response.status).toBe(422);
  expect(response.errors).toEqual([
    expect.objectContaining({ field: "filter.0.0", message: '"password_hash" is not filterable' }),
    expect.objectContaining({ field: "sort.0", message: 'cannot sort by "refresh_jti"' }),
  ]);

  const injection = await browse({ filter: [["role", "=", { $ne: null }]] });
  expect(injection.status).toBe(422);
  expect(injection.errors[0]).toMatchObject({ field: "filter.0" });
});

test("a soft-deleted email cannot be registered or created again, and answers 422, not 500", async () => {
  const email = `gone-${tag}@example.test`;
  await app.register({ email });
  expect((await app.delete(`/users/${encodeURIComponent(email)}`, { as: admin })).status).toBe(200);

  const again = await app.post(app.api("/auth/register"), { email, password: randomBytes(12).toString("hex") });
  expect(again.status).toBe(422);
  expect(again.errors).toEqual([expect.objectContaining({ field: "email" })]);
  expect((await app.post("/users", { email }, { as: admin })).status).toBe(422);
});

test("the seeded admin cannot be deleted through the back office", async () => {
  const seeded = app.ctx.config.auth!.adminEmail.toLowerCase();
  const response = await app.delete(`/users/${encodeURIComponent(seeded)}`, { as: admin });
  expect(response.status).toBe(409);
  expect(response.errors).toEqual([expect.objectContaining({ code: "SEEDED_ADMIN" })]);
});

test("a soft-deleted seeded admin stops the boot with a message that names the way out", async () => {
  const email = `seed-${tag}@example.test`;
  const row = await app.ctx.models!.get("User").create({ email, role: "admin" });
  await (row as unknown as { softDelete(): Promise<unknown> }).softDelete();
  const ctx = { ...app.ctx, mode: "backend", config: { ...app.ctx.config, auth: { ...app.ctx.config.auth!, adminEmail: email } } };

  await expect(seedAdmin(ctx as never)).rejects.toThrow(`the seeded admin account ${email} is soft-deleted — restore it`);
});

test("the back office deletes only accounts that rank below the caller, never the caller", async () => {
  const sysadmin = await app.as("sysadmin");
  const other = await app.as("admin");
  const plain = await app.register();
  const del = (account: { email: string }, as: { access_token: string }) =>
    app.delete(`/users/${encodeURIComponent(account.email)}`, { as });
  const me = await app.get<{ user: { email: string } }>(app.api("/auth/me"), { as: admin });

  expect(await del(sysadmin, admin)).toMatchObject({ status: 403, errors: [expect.objectContaining({ code: "OUTRANKS" })] });
  expect(await del(other, admin)).toMatchObject({ status: 403, errors: [expect.objectContaining({ code: "OUTRANKS" })] });
  expect(await del(me.data!.user, admin)).toMatchObject({ status: 403, errors: [expect.objectContaining({ code: "DELETE_SELF" })] });
  expect((await del(other, sysadmin)).status).toBe(200);
  expect((await del(plain, admin)).status).toBe(200);
});
