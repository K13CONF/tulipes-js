import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Ctx } from "@tulipes/core/boot";
import type { Auth } from "@tulipes/core/http";

import type { ApiTokenAttrs, UserAttrs, UserDoc } from "./documents.ts";
import { currentCredentialVersion } from "./passwords.ts";
import { forgetToken, readTokenIdentity, writeTokenIdentity } from "./session-cache.ts";

/**
 * API tokens: what a user hands an agent, an MCP client or a script — a
 * credential that does not expire in fifteen minutes, can be limited to
 * scopes, and is revoked by name.
 *
 *   <app>_<token_id>_<secret>      shop-api_3f9c…_9b1e…
 *
 * The prefix is the app's name, so two apps' tokens cannot be confused in
 * a shell and a secret scanner can be taught this app's shape. Resolution
 * reads only the last two parts: renaming the app does not retire tokens.
 *
 * The role always comes from the user, never from the token, and the
 * scopes only narrow it (core checks role first, then scopes).
 */
const BEARER = /^[a-z0-9][a-z0-9.-]*_([a-f0-9]{16})_([a-f0-9]{64})$/;

/** Whether a bearer is an API token rather than a JWT — by shape, before any lookup. */
export function isApiToken(bearer: string): boolean {
  return BEARER.test(bearer);
}

export interface IssuedToken {
  token_id: string;
  name: string;
  scopes: string[] | null;
  expires_at: Date | null;
  created_at: Date;
  /** The bearer. Returned here and never again. */
  secret: string;
}

export async function issueToken(
  ctx: Ctx,
  userId: string,
  options: { name: string; scopes?: string[]; expiresInDays?: number },
): Promise<IssuedToken> {
  const credentialVersion = await currentCredentialVersion(ctx, userId);
  if (!credentialVersion) throw new Error("the user has no credential to issue a token against");

  const token_id = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const row = await ctx.models!.get<ApiTokenAttrs>("ApiToken").create({
    token_id,
    user: userId,
    name: options.name,
    secret_hash: hash(secret),
    scopes: options.scopes,
    credential_version: credentialVersion,
    ...(options.expiresInDays !== undefined && { expires_at: new Date(Date.now() + options.expiresInDays * 86_400_000) }),
  });
  return { ...describeToken(row), secret: `${prefix(ctx)}_${token_id}_${secret}` };
}

/** A user's live tokens, newest first, without secrets. */
export async function listTokens(ctx: Ctx, userId: string) {
  const version = await currentCredentialVersion(ctx, userId);
  const rows = await ctx.models!.get<ApiTokenAttrs>("ApiToken")
    .find({ user: userId, credential_version: version, $or: [{ expires_at: { $exists: false } }, { expires_at: { $gt: new Date() } }] })
    .sort({ created_at: -1 })
    .lean();
  return rows.map((row) => ({ ...describeToken(row), last_used_at: row.last_used_at ?? null }));
}

/** Revoke one of the user's tokens. False when it is not theirs (or does not exist). */
export async function revokeToken(ctx: Ctx, userId: string, tokenId: string): Promise<boolean> {
  // The row goes first, then the cached identity. The other order leaves a
  // window: a request between the two finds the row, caches the token
  // again, and it outlives its revocation until the cache entry expires.
  const result = await ctx.models!.get("ApiToken").deleteOne({ token_id: tokenId, user: userId });
  if (result.deletedCount !== 1) return false;
  await forgetToken(ctx, tokenId);
  return true;
}

/**
 * The caller behind an API token, or undefined: unknown, wrong secret,
 * expired, revoked, issued before the last password change, or its user
 * gone. Cached like a session's identity, and forgotten by every path that
 * revokes (`revokeToken`, `forgetUser`, so password and role changes too).
 */
export async function identifyApiToken(ctx: Ctx, bearer: string): Promise<Auth | undefined> {
  const match = BEARER.exec(bearer);
  if (!match) return undefined;
  const [, tokenId, secret] = match as unknown as [string, string, string];

  const cached = await readTokenIdentity(ctx, tokenId);
  if (cached && cached.token.secret_hash && sameHash(cached.token.secret_hash, hash(secret)) && live(cached.token)) {
    // A touch rewrites the entry, as a session's does: the cached
    // last_used_at is what the next hit compares against, and a stale one
    // would turn every later hit into a write.
    if (await touch(ctx, cached.token)) await writeTokenIdentity(ctx, tokenId, cached);
    return resolve(ctx, cached.user, cached.token);
  }

  const Tokens = ctx.models!.get<ApiTokenAttrs>("ApiToken");
  const token = await Tokens.findOne({ token_id: tokenId }).select("+secret_hash").lean();
  if (!token?.secret_hash || !sameHash(token.secret_hash, hash(secret)) || !live(token)) return undefined;
  if (token.credential_version !== await currentCredentialVersion(ctx, String(token.user))) return undefined;

  const user = await ctx.models!.get<UserDoc>("User").findById(token.user).lean();
  if (!user) return undefined;

  await touch(ctx, token);
  await writeTokenIdentity(ctx, tokenId, { user: user as UserAttrs, token });
  return resolve(ctx, user as UserAttrs, token);
}

function resolve(ctx: Ctx, user: UserAttrs, token: ApiTokenAttrs): Auth {
  return {
    isAuthenticated: true,
    user: ctx.models!.get<UserDoc>("User").hydrate(user) as UserDoc,
    // A token is not a session: whatever needs one (changing the password,
    // issuing another token) is refused to it.
    session: null,
    ...(token.scopes && { scopes: token.scopes }),
    credentialId: token.token_id,
  };
}

/**
 * Whether a token still authenticates its user: not revoked, not expired,
 * not retired by a password change. For work that outlives the request
 * that started it — an agent run checks this before every step.
 */
export async function isTokenLive(ctx: Ctx, tokenId: string, userId: string): Promise<boolean> {
  const token = await ctx.models!.get<ApiTokenAttrs>("ApiToken").findOne({ token_id: tokenId, user: userId }).lean();
  if (!token || !live(token)) return false;
  return token.credential_version === await currentCredentialVersion(ctx, userId);
}

function live(token: ApiTokenAttrs): boolean {
  return !token.expires_at || new Date(token.expires_at).getTime() > Date.now();
}

/**
 * `last_used_at` at most once a minute: a write per request costs more than
 * the field is worth. True when it wrote, so a caller holding a cached copy
 * knows to store the new value.
 */
async function touch(ctx: Ctx, token: ApiTokenAttrs): Promise<boolean> {
  const last = token.last_used_at ? new Date(token.last_used_at).getTime() : 0;
  if (Date.now() - last < 60_000) return false;
  token.last_used_at = new Date();
  await ctx.models!.get("ApiToken").updateOne({ token_id: token.token_id }, { last_used_at: token.last_used_at });
  return true;
}

function describeToken(row: ApiTokenAttrs) {
  return {
    token_id: row.token_id,
    name: row.name,
    scopes: row.scopes ?? null,
    expires_at: row.expires_at ?? null,
    created_at: row.created_at,
  };
}

/** The app's name as a bearer prefix: `@acme/billing-api` → `billing-api`. */
function prefix(ctx: Ctx): string {
  const name = String((ctx.config.app as { name?: unknown } | undefined)?.name ?? "app");
  return name.replace(/^@[^/]+\//, "").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[^a-z0-9]+/, "") || "app";
}

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
