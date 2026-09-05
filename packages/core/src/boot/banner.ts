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
    const workers = ctx.queues?.workerCount ?? 0;
    rows.push([
      "Worker",
      `${dot(workers > 0)} ${green(`consuming ${workers} queue(s)`)}`,
    ]);
  }

  if (handle.connection) {
    const { host, port, name, readyState } = handle.connection;
    const connected = readyState === 1;
    rows.push([
      "Database",
      `${cyan(`mongodb://${host}:${port}/${name}`)}  ${dot(connected)} ${
        connected ? green("connected") : red("disconnected")
      }`,
    ]);
  } else {
    rows.push(["Database", gray("not configured")]);
  }

  if (ctx.queues) {
    const names = ctx.queues.names();
    rows.push([
      "Queues",
      `${bold(String(names.length))} ${gray(`(${names.join(", ")})`)}  ${dim("·")}  ${gray(
        `${ctx.queues.processorCount} processor(s) registered`,
      )}`,
    ]);
  }

  if (ctx.sockets) {
    rows.push(["Sockets", cyan(ctx.sockets.namespaces().join(", ") || "—")]);
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
