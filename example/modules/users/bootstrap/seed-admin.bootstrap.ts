import type { Ctx } from "@forgex/core/boot";

/** Idempotent: upsert keeps repeated boots from stacking admin accounts. */
export default async function seedAdmin({ Environment, models }: Ctx): Promise<void> {
  const User = models!.get("User");
  const email = Environment.get("USERS_ADMIN_EMAIL");

  await User.updateOne(
    { email },
    { $setOnInsert: { email, role: "admin" } },
    { upsert: true },
  );
  console.log(`[users] admin ensured: ${email}`);
}
