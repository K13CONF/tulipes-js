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
}

interface Pm2Api {
  connect(cb: (error?: Error) => void): void;
  list(cb: (error: Error | undefined, list: Pm2Process[]) => void): void;
  restart(target: string, cb: (error?: Error) => void): void;
  disconnect(): void;
}

/**
 * `PM2_HOME` (or the daemon's own env marker) is present only inside a
 * process PM2 started, which is a more honest test than "is pm2
 * installed" — a developer may well have it globally and not be using it.
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

  await promisify(pm2.connect.bind(pm2));

  try {
    const running = await new Promise<Pm2Process[]>((resolve, reject) => {
      pm2.list((error, list) => (error ? reject(error) : resolve(list)));
    });

    const names = running
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name))
      .filter((name) => targets.length === 0 || targets.includes(name));

    // Restarting the process that is serving this request kills the
    // response, so it goes last — the caller still gets its answer.
    const self = process.env.name;
    const ordered = [...names.filter((n) => n !== self), ...names.filter((n) => n === self)];

    for (const name of ordered) {
      await promisify((cb: (error?: Error) => void) => pm2.restart(name, cb));
    }

    return { supervised: true, restarted: ordered };
  } finally {
    pm2.disconnect();
  }
}

function promisify(fn: (cb: (error?: Error) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    fn((error) => (error ? reject(error) : resolve()));
  });
}
