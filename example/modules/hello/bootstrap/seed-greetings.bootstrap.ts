import type { Ctx } from "@tulipes/core/boot";

/**
 * Runs after models are registered and before the server accepts
 * traffic — the place for indexes, seed rows and defaults.
 *
 * MUST be idempotent: it runs on every boot of every process, backend and
 * worker alike. Upsert; never blind-insert.
 */
export default async function seedGreetings({ models }: Ctx): Promise<void> {
  const Greeting = models!.get("Greeting");

  try {
    await Greeting.updateOne(
      { name: "world" },
      { $setOnInsert: { name: "world", message: "Hello, world!" } },
      { upsert: true },
    );
  } catch (error) {
    // Bootstrap tasks run in EVERY process, and backend and worker
    // start together — concurrent upserts on a unique index race by
    // design, and the loser gets a duplicate-key error. The row
    // exists either way, which is all this task wanted.
    if ((error as { code?: number }).code !== 11000) throw error;
  }
}
