import {
  bold,
  cyan,
  cyanBright,
  dim,
  gray,
  green,
  greenBright,
  magenta,
  red,
} from "colorette";

import type { BootHandle } from "./boot.js";
import type { ModuleManifest } from "../modules/manifest.js";

/**
 * The end-of-boot banner: one glance answers every "is it actually up?"
 * question — where the server listens, database state, queues, sockets,
 * modules, roles, runtime. Colorette strips ANSI when stdout isn't a TTY,
 * so piped/production logs stay clean text.
 */
export function printStartupBanner(
  handle: BootHandle,
  modules: readonly ModuleManifest[],
  bootMs: number,
): void {
  const { env, ctx, mode } = handle;
  const ec = envColor(env.appEnv);
  const appName = String(
    (ctx.config.app as { name?: unknown } | undefined)?.name ?? "tulipes",
  );

  const rows: [string, string][] = [];

  if (handle.server) {
    const address = handle.server.address();
    const port = typeof address === "object" && address ? address.port : "?";
    rows.push([
      "Server",
      `${cyan(`http://localhost:${port}`)}  ${dot(true)} ${green("listening")}`,
    ]);
  } else {
    rows.push([
      "Worker",
      `${dot(handle.consumers > 0)} ${green(`consuming ${handle.consumers} queue(s)`)}`,
    ]);
  }

  for (const { capability, provider, label, ready, detail, skipped } of handle.providers) {
    rows.push([
      capability[0]!.toUpperCase() + capability.slice(1),
      skipped
        ? `${gray(label)}  ${dim("·")}  ${gray(provider)}`
        : `${cyan(label)}  ${dot(ready)} ${ready ? green("ready") : red("not ready")}${detail ? `  ${dim("·")}  ${gray(detail)}` : ""}  ${dim("·")}  ${gray(provider)}`,
    ]);
  }
  for (const capability of ["models", "queues", "sockets"] as const) {
    if (!handle.providers.some((p) => p.capability === capability)) {
      rows.push([capability[0]!.toUpperCase() + capability.slice(1), gray("no provider declared")]);
    }
  }

  rows.push([
    "Modules",
    `${bold(String(modules.length))} ${gray(
      `(${modules.map((m) => (m.tier === "sys" ? `${m.name}*` : m.name)).join(", ")})`,
    )}  ${dim("·")}  ${gray("* sys tier")}`,
  ]);

  const { defaultLocale, supportedLocales } = handle.i18n.settings;
  rows.push([
    "Locales",
    `${supportedLocales
      .map((locale) => (locale === defaultLocale ? bold(locale) : gray(locale)))
      .join(gray(", "))}  ${dim("\u00b7")}  ${gray(
      `${handle.i18n.namespaces.length} translated module(s)`,
    )}`,
  ]);

  if (ctx.acl) {
    const roles = ctx.acl.roles();
    rows.push(["Roles", `${bold(String(roles.length))} ${gray(`(${roles.join(", ")})`)}`]);
  }

  rows.push([
    "Runtime",
    `${gray(`Node ${process.version}`)}  ${dim("·")}  ${gray(`PID ${process.pid}`)}  ${dim("·")}  ${gray(
      `ready in ${bootMs}ms`,
    )}`,
  ]);

  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const arrow = green("➜");

  const lines = [
    "",
    `  ${bold(cyan(`▲ ${appName}`))}  ${ec(bold(env.appEnv))} ${dim("·")} ${dim(`${mode} mode`)}`,
    "",
    ...rows.map(
      ([label, value]) => `  ${arrow}  ${bold(label.padEnd(labelWidth))}   ${value}`,
    ),
    "",
  ];

  console.log(lines.join("\n"));
}

function envColor(env: string): (text: string) => string {
  if (env === "production") return greenBright;
  if (env === "test") return magenta;
  return cyanBright;
}

function dot(ok: boolean): string {
  return ok ? green("●") : red("●");
}
