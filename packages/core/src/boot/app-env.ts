import type { BootReport } from "../errors/boot-error.ts";

/**
 * APP_ENV is the deployment axis: which `.envs/.env.<APP_ENV>` and which
 * `config/settings.<APP_ENV>.json` a process reads, and whether it reveals
 * internals in error envelopes or records missing translations.
 *
 * It is deliberately NOT NODE_ENV: bundlers and libraries overload NODE_ENV
 * as an optimisation flag, so Tulipes keeps its own axis and mirrors a sane
 * NODE_ENV for third-party code.
 */
export const appEnvs = ["development", "staging", "production", "test"] as const;
export type AppEnv = (typeof appEnvs)[number];

/** `override` first (a test, a script), then the process, then development. */
export function resolveAppEnv(override: AppEnv | undefined, report: BootReport): AppEnv {
  const raw = override ?? process.env.APP_ENV ?? "development";
  if ((appEnvs as readonly string[]).includes(raw)) return raw as AppEnv;
  report.add({ scope: "env", message: `APP_ENV "${raw}" is invalid — expected one of: ${appEnvs.join(", ")}` });
  return "development"; // a placeholder; the report aborts the boot anyway
}

/** True when neither the caller nor the process named the deployment. */
export function isAppEnvDefaulted(override: AppEnv | undefined): boolean {
  return override === undefined && process.env.APP_ENV === undefined;
}

/**
 * Whether error messages and stacks may reach a client: only in a
 * development or test deployment that was named as such. A process started
 * without APP_ENV reads the development files but answers like production —
 * a server that forgot the variable must not leak its internals.
 */
export function revealsInternals(ctx: { appEnv: AppEnv; appEnvDefaulted?: boolean }): boolean {
  return (ctx.appEnv === "development" || ctx.appEnv === "test") && !ctx.appEnvDefaulted;
}

/** Anything that is not clearly dev or test gets production-grade behaviour from libraries. */
export function mirrorNodeEnv(appEnv: AppEnv): void {
  process.env.NODE_ENV ??= appEnv === "development" || appEnv === "test" ? appEnv : "production";
}
