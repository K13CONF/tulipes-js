import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HttpError } from "@tulipes/core/http";

/**
 * Restarting through PM2.
 *
 * `pm2` is an optional dependency: it is how the scaffold runs in staging
 * and production, and it is absent in development, where `yarn dev` is a
 * plain tsx process. Restarting an unsupervised process would mean exiting
 * and never coming back, so this reports that instead of doing it.
 */
export interface RestartOutcome {
  supervised: boolean;
  restarted: string[];
  reason?: string;
}

interface Pm2Process {
  name?: string;
  pm_id?: number;
  pm2_env?: { pm_cwd?: string };
}

interface Pm2Api {
  connect(cb: (error?: Error) => void): void;
  list(cb: (error: Error | undefined, list: Pm2Process[]) => void): void;
  restart(target: number, cb: (error?: Error) => void): void;
  disconnect(): void;
}

/**
 * These markers allow a supervised process or an operator's maintenance script
 * to attempt PM2 access. They do not establish process ownership: restart()
 * independently checks the daemon's working-directory metadata.
 */
export function isSupervised(): boolean {
  return Boolean(process.env.pm_id ?? process.env.PM2_HOME);
}

export async function restart(targets: readonly string[]): Promise<RestartOutcome> {
  if (!isSupervised()) {
    return { supervised: false, restarted: [], reason: "not running under PM2" };
  }

  let pm2: Pm2Api;
  try {
    // The specifier is indirect on purpose: pm2 is a runtime-optional
    // dependency (present in staging and production, absent in a plain
    // dev install), and a literal import would make TypeScript demand its
    // types from every app whether or not it uses PM2.
    const specifier = "pm2";
    pm2 = ((await import(specifier)) as { default?: unknown }).default as Pm2Api;
    if (!pm2?.connect) throw new Error("unexpected pm2 shape");
  } catch {
    return { supervised: false, restarted: [], reason: "pm2 is not installed" };
  }

  try {
    await promisify(pm2.connect.bind(pm2));
    const running = await new Promise<Pm2Process[]>((resolve, reject) => {
      pm2.list((error, list) => (error ? reject(error) : resolve(list)));
    });

    // Derive scope from this installed helper, never the request or shell cwd.
    const root = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
    const owned = running.filter((entry): entry is Pm2Process & { name: string; pm_id: number } => {
      if (!entry.name || !Number.isInteger(entry.pm_id) || entry.pm_id! < 0 || !entry.pm2_env?.pm_cwd) return false;
      try { return realpathSync(entry.pm2_env.pm_cwd) === root; }
      catch { return false; }
    });
    const allowedNames = new Set(owned.map(entry => entry.name));
    if (targets.some(name => !allowedNames.has(name))) {
      throw new HttpError(400, "invalidRestartTargets", {
        code: "INVALID_RESTART_TARGETS",
        defaultMessage: "Every restart target must name a process belonging to this application",
      });
    }
    if (!owned.length) {
      throw new HttpError(503, "noAppProcesses", {
        code: "NO_APP_PROCESSES", defaultMessage: "PM2 has no verified processes for this application",
      });
    }
    const selected = owned.filter(entry => !targets.length || targets.includes(entry.name));
    // Self goes last. Restarting this HTTP process can still interrupt its response.
    const self = Number(process.env.pm_id);
    const ordered = [...selected.filter(entry => entry.pm_id !== self), ...selected.filter(entry => entry.pm_id === self)];
    for (const entry of ordered) {
      // A name can also match another app or a PM2 selector such as "all".
      // Only numeric IDs from the verified inventory may reach PM2.
      await promisify((cb: (error?: Error) => void) => pm2.restart(entry.pm_id, cb));
    }

    return { supervised: true, restarted: [...new Set(ordered.map(entry => entry.name))] };
  } finally {
    pm2.disconnect();
  }
}

function promisify(fn: (cb: (error?: Error) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    fn((error) => (error ? reject(error) : resolve()));
  });
}
