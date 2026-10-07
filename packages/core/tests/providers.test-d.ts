import type { BootHandle, DatabaseCtx, ModelsCapability, Provider } from "../src/boot/index.js";
import { requireModels } from "../src/boot/index.js";
import type { BootReport } from "../src/errors/index.js";

/**
 * The models seam as a consumer and a provider author see it. ModelsCapability
 * is empty in core and augmented by a provider's declarations; whether `.get()`
 * exists is therefore decided by which packages are in the compilation, which
 * the packed core-only fixture (S09.5) proves — this shared test program
 * cannot, because the built-in store's augmentation is part of it.
 */

declare const database: DatabaseCtx;
declare const handle: BootHandle;

// The slot exists after phase 8; its members come from the provider's augmentation.
const models: ModelsCapability = database.models;
void models;

// @ts-expect-error Legacy handle.connection is gone; providers expose status only.
handle.connection;

const statuses: readonly { capability: string; provider: string; label: string; ready: boolean }[] = handle.providers;
void statuses;

const required: ModelsCapability = requireModels(database);
void required;

// A provider author's contract. The value's shape is whatever the augmented
// capability says it is; in this program that is the built-in store's shape.
declare const report: BootReport;
declare const value: ModelsCapability;

const valid: Provider<"models"> = {
  contract: 2,
  capability: "models",
  name: "fake",
  async acquire({ ctx, files }, incoming, own) {
    void ctx.mode;
    void files[0]?.modelFiles;
    void (incoming satisfies BootReport);
    own({ dispose: () => undefined, status: () => ({ label: "fake", ready: true }) });
    return value;
  },
};
void valid;

const wrongContract: Provider<"models"> = {
  // @ts-expect-error Only contract 2 exists.
  contract: 1,
  capability: "models",
  name: "fake",
  async acquire() { return value; },
};
void wrongContract;

const wrongCapability: Provider<"models"> = {
  contract: 2,
  // @ts-expect-error The declared capability must match.
  capability: "queues",
  name: "fake",
  async acquire() { return value; },
};
void wrongCapability;

const incompleteResource: Provider<"models"> = {
  contract: 2,
  capability: "models",
  name: "fake",
  async acquire(_ctx, _report, own) {
    // @ts-expect-error A resource must report its status for the banner.
    own({ dispose: () => undefined });
    return value;
  },
};
void incompleteResource;
void report;
