import type { Collection, Connection, mongo } from "mongoose";

type ChangeStream = mongo.ChangeStream;

import { SettingsConflictError, type Actor, type SettingsStore, type StoredSettings } from "@tulipes/core/config";

/** One namespace, as the `settings` collection holds it. */
export interface SettingsDocument {
  _id: string;
  values: Record<string, unknown>;
  version: number;
  updated_at: Date;
  updated_by: Actor;
}

/** The document a write replaced, kept for the console to show and revert. */
export interface SettingsHistoryDocument extends Omit<SettingsDocument, "_id"> {
  namespace: string;
  replaced_at: Date;
  replaced_by: Actor;
}

export interface MongoSettingsStoreOptions {
  collection?: string;
  historyCollection?: string;
  /** How often to look for other processes' writes when no change stream is available. */
  pollIntervalMs?: number;
}

/**
 * The settings store an app selects with
 * `"tulipes": { "providers": { "settings": "@tulipes/mongoose/settings" } }`:
 * one document per namespace in `settings`, keyed by module name, with
 * the version the manager hands back on every save. A write is a
 * `findOneAndUpdate` on `{ _id, version: expected }`, so two operators
 * cannot overwrite each other, and the document it replaced goes to
 * `settings_history`. Other processes' writes arrive through a change
 * stream on a replica set and through polling otherwise; the manager
 * validates them before applying, so the store validates nothing.
 */
export class MongoSettingsStore implements SettingsStore {
  readonly #connection: Connection;
  readonly #settings: Collection<SettingsDocument>;
  readonly #history: Collection<SettingsHistoryDocument>;
  readonly #pollIntervalMs: number;
  /** Versions this process has seen per namespace, so a watch only reports real changes. */
  readonly #seen = new Map<string, number>();
  #stream: ChangeStream | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #transport: "change stream" | "poll" | "idle" = "idle";

  constructor(connection: Connection, options: MongoSettingsStoreOptions = {}) {
    this.#connection = connection;
    this.#settings = connection.collection(options.collection ?? "settings") as unknown as Collection<SettingsDocument>;
    this.#history = connection.collection(options.historyCollection ?? "settings_history") as unknown as Collection<SettingsHistoryDocument>;
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
  }

  async load(namespace: string): Promise<StoredSettings | undefined> {
    const document = await this.#settings.findOne({ _id: namespace });
    if (!document) return undefined;
    this.#seen.set(namespace, document.version);
    return toStored(document);
  }

  async save(namespace: string, values: Record<string, unknown>, expectedVersion: number, actor: Actor): Promise<StoredSettings> {
    const next: SettingsDocument = { _id: namespace, values, version: expectedVersion + 1, updated_at: new Date(), updated_by: actor };

    if (expectedVersion === 0) {
      try {
        await this.#settings.insertOne(next);
      } catch (error) {
        // Another process seeded first: the conflict carries its document.
        if ((error as { code?: number }).code !== 11000) throw error;
        throw new SettingsConflictError(namespace, await this.load(namespace), expectedVersion);
      }
    } else {
      const previous = await this.#settings.findOneAndUpdate(
        { _id: namespace, version: expectedVersion },
        { $set: { values, version: next.version, updated_at: next.updated_at, updated_by: actor } },
        { returnDocument: "before" },
      );
      if (!previous) throw new SettingsConflictError(namespace, await this.load(namespace), expectedVersion);
      const { _id, ...replaced } = previous;
      await this.#history.insertOne({ ...replaced, namespace: _id, replaced_at: next.updated_at, replaced_by: actor });
    }

    this.#seen.set(namespace, next.version);
    return toStored(next);
  }

  /**
   * A change stream needs a replica set; on a standalone server its first
   * use fails with code 40573, and the store falls back to polling without
   * anyone configuring which deployment this is.
   */
  watch(listener: (namespace: string, stored: StoredSettings) => void): () => void {
    const emit = (document: SettingsDocument) => {
      if ((this.#seen.get(document._id) ?? 0) >= document.version) return;
      this.#seen.set(document._id, document.version);
      listener(document._id, toStored(document));
    };
    const poll = () => {
      this.#transport = "poll";
      this.#timer = setInterval(() => {
        this.#settings.find({}).toArray().then((documents) => documents.forEach(emit), () => undefined);
      }, this.#pollIntervalMs);
      // A poller must never hold a worker or script open on its own.
      this.#timer.unref();
    };
    try {
      const stream = this.#settings.watch([{ $match: { operationType: { $in: ["insert", "update", "replace"] } } }], { fullDocument: "updateLookup" });
      this.#stream = stream;
      this.#transport = "change stream";
      stream.on("change", (change) => {
        const document = (change as { fullDocument?: SettingsDocument }).fullDocument;
        if (document) emit(document);
      });
      stream.on("error", () => {
        void stream.close().catch(() => undefined);
        if (this.#stream === stream) {
          this.#stream = undefined;
          if (!this.#timer) poll();
        }
      });
    } catch {
      poll();
    }
    return () => void this.dispose();
  }

  status(): { label: string; ready: boolean } {
    const { host, port, name } = this.#connection;
    const transport = this.#transport === "idle" ? "" : ` (${this.#transport})`;
    return { label: `mongodb://${host}:${port}/${name}.${this.#settings.collectionName}${transport}`, ready: this.#connection.readyState === 1 };
  }

  async dispose(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    const stream = this.#stream;
    this.#stream = undefined;
    this.#transport = "idle";
    if (stream) await stream.close().catch(() => undefined);
  }
}

function toStored(document: SettingsDocument): StoredSettings {
  return {
    values: document.values,
    version: document.version,
    updated_at: document.updated_at instanceof Date ? document.updated_at.toISOString() : String(document.updated_at),
    updated_by: document.updated_by,
  };
}
