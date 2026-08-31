import type { Ctx } from "@tulipes/core/boot";

/** Idempotent: upsert keeps repeated boots from stacking admin accounts. */
export default async function seedAdmin({ Environment, models }: Ctx): Promise<void> {
  const User = models!.get("User");
  const email = Environment.get("USERS_ADMIN_EMAIL");

  try {
    await User.updateOne(
      { email },
      { $setOnInsert: { email, role: "admin" } },
      { upsert: true },
    );
  } catch (error) {
    // Bootstrap tasks run in EVERY process, and backend and worker start
    // together — concurrent upserts on a unique index race by design, and
    // the loser gets a duplicate-key error. The row exists either way,
    // which is all this task wanted.
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  console.log(`[users] admin ensured: ${email}`);
}
