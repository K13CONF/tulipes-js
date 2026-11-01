import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { CredentialDoc } from "./documents.ts";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";
import { forgetUser } from "./session-cache.ts";

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

const dummies = new Map<number, Promise<string>>();

/**
 * Burn one compare when there is no account or no credential, at the
 * configured cost, so a failed login takes as long either way and the
 * response time does not tell which emails have accounts.
 */
export async function verifyNothing(ctx: Ctx, plain: string): Promise<false> {
  const cost = rounds(ctx);
  if (!dummies.has(cost)) dummies.set(cost, bcrypt.hash(randomUUID(), cost));
  await bcrypt.compare(plain, await dummies.get(cost)!);
  return false;
}

/**
 * Set or replace a user's password and invalidate every session they have.
 *
 * Revoking here is the whole point of changing a password after a suspected
 * compromise: leaving other devices signed in would defeat it.
 */
export async function setPassword(ctx: Ctx, userId: string, plain: string, expectedVersion?: string): Promise<string> {
  // bcrypt ignores bytes past 72; the schemas refuse those, and so does this, for every other caller.
  if (Buffer.byteLength(plain, "utf8") > 72) throw new HttpError(422, "passwordTooLong", { field: "password" });
  const password_hash = await hashPassword(ctx, plain);
  const version = randomUUID();

  // The password and its session version change in one atomic document write.
  // Returning the previous version lets delayed cleanup target only that version.
  const previous = await ctx.models!.get<CredentialDoc>("Credential").findOneAndUpdate(
    { user: userId, ...(expectedVersion === undefined ? {} : { version: expectedVersion }) },
    { $set: { password_hash, version } },
    { upsert: expectedVersion === undefined, returnDocument: "before" },
  );
  if (expectedVersion !== undefined && !previous) throw new HttpError(401, "invalidCredentials");

  // Authorization already rejects the previous version even if cleanup fails.
  // Never delete sessions issued under a newer, concurrent password change.
  // Cached identities of this user go first: they carry the old version.
  await forgetUser(ctx, userId);
  await ctx.models!.get("Session").deleteMany({
    user: userId,
    credential_version: previous?.version ?? { $exists: false },
  });
  return version;
}

/** Read only the version, never the hash, during session authorization. */
export async function currentCredentialVersion(ctx: Ctx, userId: string): Promise<string | undefined> {
  const credential = await ctx.models!.get<CredentialDoc>("Credential")
    .findOne({ user: userId }).select("version").lean();
  return credential?.version;
}
