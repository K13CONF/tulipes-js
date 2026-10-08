import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

/** Who wrote a namespace; the console fills it from req.auth, boot from itself. */
export interface Actor {
  id: string;
  label?: string;
}

export const SYSTEM_ACTOR: Actor = { id: "system", label: "first boot" };

/** One namespace as the store holds it. `values` is validated by the manager, never by the store. */
export interface StoredSettings {
  values: Record<string, unknown>;
  /** 1 on the first write; a save names the version it read, or the write is refused. */
  version: number;
  updated_at: string;
  updated_by: Actor;
}

/**
 * The seam between core and wherever settings persist. Core ships the file
 * store below; `@tulipes/mongoose` ships the collection-backed one an app
 * selects with `"tulipes": { "providers": { "settings": "@tulipes/mongoose" } }`.
 * A store validates nothing: it keeps whatever the manager hands it and
 * reports what it holds.
 */
export interface SettingsStore {
  /** A namespace never written is `undefined`, which the manager seeds with defaults. */
  load(namespace: string): Promise<StoredSettings | undefined>;
  /**
   * Write `values` as the version after `expectedVersion` (0 for a namespace
   * never written). A different current version means someone wrote in
   * between: throw a SettingsConflictError carrying what is there now.
   */
  save(namespace: string, values: Record<string, unknown>, expectedVersion: number, actor: Actor): Promise<StoredSettings>;
  /** Changes made elsewhere — another process, another replica. Optional; polling stores and files implement it. */
  watch?(listener: (namespace: string, stored: StoredSettings) => void): () => void;
  /** Shown in the startup banner; never contains credentials. */
  status(): { label: string; ready: boolean };
  dispose?(): void | Promise<void>;
}

export class SettingsConflictError extends Error {
  readonly namespace: string;
  readonly current: StoredSettings | undefined;
  readonly expectedVersion: number;

  constructor(namespace: string, current: StoredSettings | undefined, expectedVersion: number) {
    super(`settings "${namespace}": version ${expectedVersion} is stale, the store holds version ${current?.version ?? 0}`);
    this.name = "SettingsConflictError";
    this.namespace = namespace;
    this.current = current;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * A store that keeps nothing: every namespace reads as never written, so
 * the manager seeds the defaults, and a save is remembered only for the
 * life of the process. Inspection uses it; tests can.
 */
export class MemorySettingsStore implements SettingsStore {
  readonly #entries = new Map<string, StoredSettings>();
  readonly #label: string;

  constructor(label = "memory") {
    this.#label = label;
  }

  async load(namespace: string): Promise<StoredSettings | undefined> {
    return this.#entries.get(namespace);
  }

  async save(namespace: string, values: Record<string, unknown>, expectedVersion: number, actor: Actor): Promise<StoredSettings> {
    const current = this.#entries.get(namespace);
    if ((current?.version ?? 0) !== expectedVersion) throw new SettingsConflictError(namespace, current, expectedVersion);
    const stored: StoredSettings = { values, version: expectedVersion + 1, updated_at: new Date().toISOString(), updated_by: actor };
    this.#entries.set(namespace, stored);
    return stored;
  }

  status(): { label: string; ready: boolean } {
    return { label: this.#label, ready: true };
  }
}

type FileDocument = Record<string, StoredSettings>;

/**
 * The store an app has when it declares no settings provider: one JSON
 * file per APP_ENV under `config/`, every namespace keyed by module name.
 * Good enough for the minimal preset and for local development of the
 * production one; a deployment with replicas declares the Mongo store.
 */
export class FileSettingsStore implements SettingsStore {
  readonly file: string;
  #watcher: FSWatcher | undefined;
  #poll: ReturnType<typeof setInterval> | undefined;
  /** Versions this process has seen per namespace, so a watch only reports real changes. */
  readonly #seen = new Map<string, number>();

  constructor(rootDir: string, appEnv: string) {
    this.file = join(rootDir, "config", `settings.${appEnv}.json`);
  }

  async load(namespace: string): Promise<StoredSettings | undefined> {
    const stored = this.#read()[namespace];
    if (stored) this.#seen.set(namespace, stored.version);
    return stored;
  }

  async save(namespace: string, values: Record<string, unknown>, expectedVersion: number, actor: Actor): Promise<StoredSettings> {
    const document = this.#read();
    const current = document[namespace];
    if ((current?.version ?? 0) !== expectedVersion) throw new SettingsConflictError(namespace, current, expectedVersion);
    const stored: StoredSettings = { values, version: expectedVersion + 1, updated_at: new Date().toISOString(), updated_by: actor };
    document[namespace] = stored;
    this.#write(document);
    this.#seen.set(namespace, stored.version);
    return stored;
  }

  watch(listener: (namespace: string, stored: StoredSettings) => void): () => void {
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      let document: FileDocument;
      try {
        document = this.#read();
      } catch {
        return; // half-written or invalid: the next change will be read
      }
      for (const [namespace, stored] of Object.entries(document)) {
        if ((this.#seen.get(namespace) ?? 0) >= stored.version) continue;
        this.#seen.set(namespace, stored.version);
        listener(namespace, stored);
      }
    };
    // Watch the directory, not the file: an atomic replace renames a new
    // inode into place, and a watcher on the old one goes silent.
    this.#watcher = watch(dir, (_event, filename) => {
      if (filename && filename !== basename(this.file)) return;
      clearTimeout(timer);
      timer = setTimeout(check, 50);
    });
    // fs.watch drops events under load on macOS; the poll is the floor, as
    // it is for the Mongo store. Neither may hold a worker or script open.
    this.#poll = setInterval(check, 2_000);
    this.#poll.unref();
    this.#watcher.unref();
    return () => this.dispose();
  }

  status(): { label: string; ready: boolean } {
    return { label: `file ${relative(process.cwd(), this.file) || this.file}`, ready: true };
  }

  dispose(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    clearInterval(this.#poll);
    this.#poll = undefined;
  }

  #read(): FileDocument {
    if (!existsSync(this.file)) return {};
    const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${this.file} must hold an object keyed by module name`);
    }
    return parsed as FileDocument;
  }

  #write(document: FileDocument): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(document, null, 2) + "\n");
    renameSync(temporary, this.file);
  }
}
