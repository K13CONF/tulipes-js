import { randomBytes } from "node:crypto";

import { boot, type BootHandle, type BootOptions, type Ctx } from "@tulipes/core/boot";
import type { AppEnv } from "@tulipes/core/env";
import type { Envelope } from "@tulipes/core/http";

/**
 * What a test needs from a booted app: the handle and context, the base
 * URL of its listener, a request helper that speaks the envelope, and —
 * when the app's auth module is mounted — accounts and tokens by role.
 */
export interface TestAppOptions {
  rootDir: string;
  /** Which `.envs/.env.<appEnv>` and settings file the boot reads; default "test". */
  appEnv?: AppEnv;
  /**
   * Variables set on `process.env` for the boot and restored on shutdown.
   * `PORT` is `"0"` unless given: the listener takes a free port.
   */
  env?: Record<string, string>;
  /**
   * Settings written through `ctx.settings.set()` right after the boot, per
   * namespace — the way an operator writes them, so every replica reads them.
   */
  settings?: Record<string, Record<string, unknown>>;
  /** The auth module's mount, relative to the API prefix; default "/auth". */
  authPath?: string;
  /** Anything else `boot()` takes. */
  boot?: Partial<Omit<BootOptions, "rootDir" | "appEnv" | "mode" | "inspect">>;
}

export interface RequestOptions {
  body?: unknown;
  /** A bearer token; `as` wins when both are given. */
  token?: string;
  /** An account from `register()`, `login()` or `as()`. */
  as?: { access_token: string };
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
}

export interface TestResponse<T = unknown> {
  status: number;
  headers: Headers;
  /** The decoded envelope, or a synthetic one when the body was not JSON. */
  body: Envelope<T>;
  data: T | null;
  errors: Envelope<T>["errors"];
  /** The raw response, for streams and non-JSON bodies. */
  raw: Response;
}

export interface Account {
  userId: string;
  email: string;
  password: string;
  access_token: string;
  refresh_token: string;
}

export class TestApp {
  readonly handle: BootHandle;
  readonly base: string;
  readonly #options: TestAppOptions;
  readonly #restore: () => void;

  /** @internal Use bootTestApp(). */
  constructor(handle: BootHandle, base: string, options: TestAppOptions, restore: () => void) {
    this.handle = handle;
    this.base = base;
    this.#options = options;
    this.#restore = restore;
  }

  get ctx(): Ctx {
    return this.handle.ctx;
  }

  /** The configured API prefix (`config.api.prefix`), or "". */
  get prefix(): string {
    return String((this.ctx.config.api as { prefix?: unknown } | undefined)?.prefix ?? "");
  }

  /** An absolute URL under the API prefix: `app.api("/hello")` → `http://…/api/v1/hello`. */
  api(path: string): string {
    return this.base + this.prefix + path;
  }

  /**
   * One request, the envelope decoded. `path` is absolute on the app
   * (`/api/v1/users`), or a full URL. JSON bodies are encoded and typed as
   * such; a non-JSON answer yields a synthetic failed envelope carrying the
   * status, so an assertion on `status` reads the same either way.
   */
  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<TestResponse<T>> {
    const url = new URL(path.startsWith("http") ? path : this.base + path);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
    const token = options.as?.access_token ?? options.token;
    const headers: Record<string, string> = { connection: "close", ...options.headers };
    if (token) headers.authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["content-type"] ??= "application/json";
    const raw = await fetch(url, {
      method,
      headers,
      ...(options.body !== undefined && { body: typeof options.body === "string" ? options.body : JSON.stringify(options.body) }),
    });
    const text = await raw.text();
    let body: Envelope<T>;
    try {
      body = JSON.parse(text) as Envelope<T>;
    } catch {
      body = { success: false, data: null, errors: [{ field: null, message: text.slice(0, 200), code: `HTTP_${raw.status}` }], meta: {} };
    }
    return { status: raw.status, headers: raw.headers, body, data: body.data, errors: body.errors, raw };
  }

  get<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>> {
    return this.request<T>("GET", path, options);
  }

  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse<T>> {
    return this.request<T>("POST", path, { ...options, body });
  }

  patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse<T>> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T = unknown>(path: string, options?: RequestOptions): Promise<TestResponse<T>> {
    return this.request<T>("DELETE", path, options);
  }

  /** A fresh account through the auth module's register endpoint, signed in. */
  async register(credentials: Partial<Pick<Account, "email" | "password">> = {}): Promise<Account> {
    const email = credentials.email ?? `${randomBytes(12).toString("hex")}@example.test`;
    const password = credentials.password ?? randomBytes(24).toString("hex");
    const response = await this.post<{ user: { id: string }; access_token: string; refresh_token: string }>(this.#auth("/register"), { email, password });
    if (response.status !== 201 || !response.data) {
      throw new Error(`register failed (${response.status}): ${describe(response.body)}`);
    }
    return { userId: response.data.user.id, email, password, access_token: response.data.access_token, refresh_token: response.data.refresh_token };
  }

  async login(email: string, password: string): Promise<Pick<Account, "access_token" | "refresh_token" | "userId">> {
    const response = await this.post<{ user: { id: string }; access_token: string; refresh_token: string }>(this.#auth("/login"), { email, password });
    if (response.status !== 200 || !response.data) {
      throw new Error(`login failed (${response.status}): ${describe(response.body)}`);
    }
    return { userId: response.data.user.id, access_token: response.data.access_token, refresh_token: response.data.refresh_token };
  }

  /**
   * An account holding `role`: registered, promoted through the app's
   * `User` model, then signed in again so the tokens carry a session the
   * promoted role resolves — cached identities included.
   */
  async as(role: string): Promise<Account> {
    const account = await this.register();
    if (role !== "user") {
      const models = this.ctx.models as { get(name: string): { updateOne(filter: unknown, update: unknown): Promise<unknown> } } | undefined;
      if (!models) throw new Error(`as("${role}") needs the app's models to promote the account`);
      await models.get("User").updateOne({ _id: account.userId }, { role });
      const session = await this.login(account.email, account.password);
      return { ...account, ...session };
    }
    return account;
  }

  async shutdown(): Promise<void> {
    try {
      await this.handle.shutdown();
    } finally {
      this.#restore();
    }
  }

  #auth(path: string): string {
    return this.prefix + (this.#options.authPath ?? "/auth") + path;
  }
}

/**
 * Boot the app once for a test file: a random port, no signal handlers,
 * the variables in `env` set for the boot. Call `shutdown()` in the file's
 * teardown, or let `useTestApp()` do both.
 */
export async function bootTestApp(options: TestAppOptions): Promise<TestApp> {
  const env = { PORT: "0", ...options.env };
  const previous = new Map(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  let handle: BootHandle;
  try {
    handle = await boot({ ...options.boot, rootDir: options.rootDir, appEnv: options.appEnv ?? "test", mode: "backend", handleSignals: false });
  } catch (error) {
    restore();
    throw error;
  }
  const address = handle.server?.address();
  if (!address || typeof address === "string") {
    await handle.shutdown();
    restore();
    throw new Error("the app booted without an HTTP listener");
  }
  const app = new TestApp(handle, `http://127.0.0.1:${address.port}`, options, restore);
  for (const [namespace, values] of Object.entries(options.settings ?? {})) {
    await handle.ctx.settings.set(namespace, values, { id: "tests" });
  }
  return app;
}

/**
 * The same, wired to a test runner's file hooks — vitest's `beforeAll` and
 * `afterAll`, or any pair with that shape — so a module test reads:
 *
 *   const app = useTestApp({ rootDir }, { beforeAll, afterAll });
 *   test("greets", async () => {
 *     const { status, data } = await app.get(app.api("/hello"));
 *   });
 *
 * Every member delegates to the app booted in `beforeAll`; using one before
 * that throws with the reason.
 */
export function useTestApp(
  options: TestAppOptions,
  hooks: { beforeAll(fn: () => Promise<void>, timeout?: number): void; afterAll(fn: () => Promise<void>): void },
  timeoutMs = 30_000,
): TestApp {
  let app: TestApp | undefined;
  hooks.beforeAll(async () => { app = await bootTestApp(options); }, timeoutMs);
  hooks.afterAll(async () => { await app?.shutdown(); app = undefined; });
  return new Proxy({} as TestApp, {
    get(_target, property) {
      if (!app) throw new Error(`the test app is not booted yet (reading ${String(property)} outside a test or before beforeAll ran)`);
      const value = (app as unknown as Record<PropertyKey, unknown>)[property];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(app) : value;
    },
  });
}

function describe(envelope: Envelope): string {
  return envelope.errors.map((error) => `${error.field ? error.field + ": " : ""}${error.message} (${error.code})`).join("; ") || "no detail";
}
