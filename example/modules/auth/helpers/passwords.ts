import bcrypt from "bcryptjs";
import type { Ctx } from "@tulipes/core/boot";

/**
 * bcryptjs — pure JavaScript, so installs never need a native toolchain.
 * The cost factor comes from config rather than a literal: raising it is
 * how you keep pace with hardware, and it should not require a code change.
 */
const rounds = (ctx: Ctx): number => Number(ctx.config.security?.passwordRounds ?? 12);

export async function hashPassword(ctx: Ctx, plain: string): Promise<string> {
  return bcrypt.hash(plain, rounds(ctx));
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Set or replace a user's password and invalidate every session they have.
 *
 * Revoking here is the whole point of changing a password after a suspected
 * compromise: leaving other devices signed in would defeat it.
 */
export async function setPassword(ctx: Ctx, userId: string, plain: string): Promise<void> {
  const password_hash = await hashPassword(ctx, plain);

  await ctx.models!.get("Credential").updateOne(
    { user: userId },
    { $set: { password_hash } },
    { upsert: true },
  );

  // Bumps the epoch that the request pipeline compares every access token
  // against, so tokens issued before this moment stop being accepted.
  await ctx.models!.get("User").updateOne(
    { _id: userId },
    { $set: { tokens_valid_from: new Date() } },
  );

  const { endAllSessions } = await import("./tokens.js");
  await endAllSessions(ctx, userId);
}
