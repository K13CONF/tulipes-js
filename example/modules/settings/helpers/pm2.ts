import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
import { HttpError } from "@tulipes/core/http";

export interface RestartOutcome {
  supervised: boolean;
  restarted: string[];
  reason?: string;
}

interface Pm2Process {
  name?: string;
  pm_id?: number;
  pid?: number;
  pm2_env?: { pm_cwd?: string };
}

interface Pm2Api {
  connect(callback: (error?: Error) => void): void;
  list(callback: (error: Error | undefined, list: Pm2Process[]) => void): void;
  restart(target: number, callback: (error?: Error) => void): void;
  disconnect(): void;
}

interface RestartTarget {
  id: number;
  pid: number;
  name: string;
}

const TIMEOUT_MS = 5000;

// PM2's imported client shares one connection. Hold ownership through response
// completion and execution so another request cannot disconnect an active restart.
let restarting = false;

/** These markers permit an attempt; daemon metadata still establishes ownership. */
export function isSupervised(): boolean {
  return Boolean(process.env.pm_id ?? process.env.PM2_HOME);
}

/** Maintenance scripts wait for completed restart callbacks, as before. */
export function restart(targets: readonly string[]): Promise<RestartOutcome> {
  return runRestart([...targets]);
}

/** HTTP callers receive an acknowledgment before any destructive PM2 command. */
export async function restartAfterResponse(
  res: Response,
  targets: readonly string[],
): Promise<void> {
  await runRestart([...targets], res);
}

async function runRestart(
  targets: readonly string[],
  response?: Response,
): Promise<RestartOutcome> {
  if (!isSupervised()) {
    return unavailable(response, "not running under PM2");
  }

  if (restarting) {
    throw new HttpError(409, "restartInProgress", {
      code: "RESTART_IN_PROGRESS",
      defaultMessage: "Another restart request is still in progress",
    });
  }

  restarting = true;
  let pm2: Pm2Api | undefined;
  let accepted = false;

  try {
    pm2 = await loadPm2();
    if (!pm2) return unavailable(response, "pm2 is not installed");

    await bounded((callback) => pm2!.connect(callback));

    const root = realpathSync(
      fileURLToPath(new URL("../../../", import.meta.url)),
    );
    const selected = selectTargets(await list(pm2), targets, root);
    const names = [...new Set(selected.map((target) => target.name))];

    if (response) {
      // finish means Node handed the entire response to the operating system.
      // It does not prove that a remote client received or processed the bytes.
      accepted = await acknowledge(response, names);
      if (!accepted) return { supervised: true, restarted: [] };
    }

    for (const target of selected) {
      // A response delay or an earlier worker restart can outlive PM2 inventory
      // changes. Never apply a prepared numeric ID to a different process.
      const current = ownedProcesses(await list(pm2), root);
      const unchanged = current.some(
        (entry) =>
          entry.id === target.id &&
          entry.pid === target.pid &&
          entry.name === target.name,
      );

      if (!unchanged) {
        throw new HttpError(409, "restartTargetChanged", {
          code: "RESTART_TARGET_CHANGED",
          defaultMessage:
            "A selected process changed before its restart could begin",
        });
      }

      await bounded((callback) => pm2!.restart(target.id, callback));
    }

    return { supervised: true, restarted: names };
  } catch (error) {
    if (accepted) {
      // The 202 is already final. Report a stable operational signal instead of
      // attempting a second HTTP response or exposing driver/connection details.
      console.error("[settings] accepted restart did not complete", {
        code: "RESTART_FAILED",
      });

      return {
        supervised: true,
        restarted: [],
        reason: "accepted restart failed",
      };
    }

    if (error instanceof HttpError) throw error;

    throw new HttpError(503, "restartUnavailable", {
      code: "RESTART_UNAVAILABLE",
      defaultMessage: "The restart request could not be prepared",
    });
  } finally {
    try {
      pm2?.disconnect();
    } catch {
      console.error("[settings] PM2 disconnect failed", {
        code: "RESTART_CLEANUP_FAILED",
      });
    } finally {
      restarting = false;
    }
  }
}

function unavailable(
  response: Response | undefined,
  reason: string,
): RestartOutcome {
  if (response) {
    throw new HttpError(503, "notSupervised", {
      code: "NOT_SUPERVISED",
      defaultMessage:
        "PM2 supervision is unavailable; restart the application manually",
    });
  }

  return { supervised: false, restarted: [], reason };
}

async function loadPm2(): Promise<Pm2Api | undefined> {
  try {
    // Keep PM2 runtime-optional: plain development installs need not provide its
    // package or TypeScript declarations.
    const specifier = "pm2";
    const imported = (await import(specifier)) as { default?: Pm2Api };
    const pm2 = imported.default;

    if (!pm2?.connect || !pm2.list || !pm2.restart || !pm2.disconnect)
      return undefined;

    return pm2;
  } catch {
    return undefined;
  }
}

function ownedProcesses(running: Pm2Process[], root: string): RestartTarget[] {
  const owned: RestartTarget[] = [];

  for (const entry of running) {
    if (
      !entry.name ||
      !Number.isInteger(entry.pm_id) ||
      entry.pm_id! < 0 ||
      !Number.isInteger(entry.pid) ||
      entry.pid! < 0 ||
      !entry.pm2_env?.pm_cwd
    ) {
      continue;
    }

    try {
      if (realpathSync(entry.pm2_env.pm_cwd) !== root) continue;
    } catch {
      continue;
    }

    owned.push({ id: entry.pm_id!, pid: entry.pid!, name: entry.name });
  }

  return owned;
}

function selectTargets(
  running: Pm2Process[],
  targets: readonly string[],
  root: string,
): RestartTarget[] {
  // Validate the entire request before accepting it or restarting any member.
  const owned = ownedProcesses(running, root);
  const allowedNames = new Set(owned.map((entry) => entry.name));

  if (targets.some((name) => !allowedNames.has(name))) {
    throw new HttpError(400, "invalidRestartTargets", {
      code: "INVALID_RESTART_TARGETS",
      defaultMessage:
        "Every restart target must name a process belonging to this application",
    });
  }

  if (!owned.length) {
    throw new HttpError(503, "noAppProcesses", {
      code: "NO_APP_PROCESSES",
      defaultMessage: "PM2 has no verified processes for this application",
    });
  }

  const selected = owned.filter(
    (entry) => !targets.length || targets.includes(entry.name),
  );
  const self = Number(process.env.pm_id);

  return [
    ...selected.filter((entry) => entry.id !== self),
    ...selected.filter((entry) => entry.id === self),
  ];
}

function list(pm2: Pm2Api): Promise<Pm2Process[]> {
  return bounded<Pm2Process[]>((callback) => pm2.list(callback));
}

/** A silent daemon cannot retain the response or shared-client lock indefinitely. */
function bounded<T = void>(
  operation: (callback: (error?: Error, value?: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PM2 operation timed out")),
      TIMEOUT_MS,
    );

    try {
      operation((error, value) => {
        clearTimeout(timer);

        if (error) reject(error);
        else resolve(value as T);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

/** Cancel on an incomplete response; register observers before sending its body. */
function acknowledge(res: Response, names: string[]): Promise<boolean> {
  if (res.destroyed) return Promise.resolve(false);

  return new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      res.off("finish", finished);
      res.off("close", cancelled);
      res.off("error", cancelled);
    };

    const finished = () => {
      cleanup();
      resolve(true);
    };

    const cancelled = () => {
      cleanup();
      resolve(false);
    };

    const timer = setTimeout(() => {
      cancelled();
      res.destroy();
    }, TIMEOUT_MS);

    res.once("finish", finished);
    res.once("close", cancelled);
    res.once("error", cancelled);

    try {
      res.respond({
        status: 202,
        data: { supervised: true, accepted: true, scheduled: names },
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
