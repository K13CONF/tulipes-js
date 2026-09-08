import type { DatabaseCtx } from "@tulipes/core/boot";

import { setPassword } from "../helpers/passwords.js";
import type { UserDoc } from "../helpers/documents.js";

/**
 * Seeds the first admin: the account and its credential together.
 *
 * It lives in auth rather than users because only auth knows how to store
 * a password — which is the whole reason credentials are a separate model.
 * Auth reaches the User model through the model store by name, not by
 * importing the users module: auth is sys-tier and users is app-tier, and
 * a sys module may not depend on an app module.
 */
export default async function seedAdmin(ctx: DatabaseCtx): Promise<void> {
  const email = String(ctx.Environment.get("AUTH_ADMIN_EMAIL")).toLowerCase();
  const User = ctx.models.get<UserDoc>("User");

  let user: Pick<UserDoc, "_id"> | null = await User.findOne({ email }).lean();

  if (!user) {
    try {
      user = await User.create({ email, role: "admin" });
    } catch (error) {
      // Backend and worker boot together, so both may reach this at once.
      // The loser of that race just reads the row the winner inserted.
      if ((error as { code?: number }).code !== 11000) throw error;
      user = await User.findOne({ email }).lean();
    }
  }

  // Only set the password when there is no credential yet, so a rotated
  // admin password is not silently reset to the seed value on next boot.
  const existing = await ctx.models
    .get("Credential")
    .countDocuments({ user: user!._id })
    .limit(1);

  if (existing === 0) {
    await setPassword(ctx, String(user!._id), String(ctx.Environment.get("AUTH_ADMIN_PASSWORD")));
  }
}
