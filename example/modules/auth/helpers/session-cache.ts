import { appCache } from "@app/core";
import type { Ctx } from "@tulipes/core/boot";

import type { ApiTokenAttrs, SessionAttrs, UserAttrs } from "./documents.ts";

/**
 * What a bearer token resolves to, kept in the app cache (Redis in
 * production, shared by every replica) under the session id. A hit is one
 * Redis read in place of the three Mongo reads the cold path performs
 * (RevokedToken, Session, User); the entry lives no longer than
 * `auth.cacheTtlSeconds`, and every path that revokes — logout, refresh
 * reuse, rotation, session end, password change, user deletion — deletes
 * it before answering, so a revoked session is refused on the very next
 * request on any replica, as strictly as the cold path refuses it.
 *
 * The cache is best effort: a Redis outage is a miss, never an error, and
 * the cold path is what every request takes then.
 */
export interface CachedIdentity {
  user: UserAttrs;
  session: SessionAttrs;
}

const KEY = "auth:session:";
const TOKEN_KEY = "auth:token:";

/** How long an entry may live: the setting, bounded by the access token's own lifetime. */
export function cacheTtlSeconds(ctx: Ctx): number {
  const configured = Number(ctx.config.auth?.cacheTtlSeconds ?? 60);
  const access = durationSeconds(String(ctx.config.auth?.accessTtl ?? "15m"));
  return Math.max(0, Math.min(configured, access));
}

export async function readIdentity(ctx: Ctx, sid: string): Promise<CachedIdentity | null> {
  if (cacheTtlSeconds(ctx) === 0) return null;
  return appCache(ctx).get<CachedIdentity>(KEY + sid);
}

export async function writeIdentity(ctx: Ctx, sid: string, identity: CachedIdentity): Promise<void> {
  const ttl = cacheTtlSeconds(ctx);
  if (ttl === 0) return;
  await appCache(ctx).set(KEY + sid, identity, ttl);
}

/** Forget one session: the next request with its token takes the cold path. */
export async function forgetSession(ctx: Ctx, sid: string): Promise<void> {
  await appCache(ctx).del(KEY + sid);
}

/**
 * What an API token resolves to: its user and the token row. The row keeps
 * its `secret_hash`, so a hit still proves the bearer holds the secret —
 * an entry is never enough by its id alone.
 */
export interface CachedTokenIdentity {
  user: UserAttrs;
  token: ApiTokenAttrs;
}

export async function readTokenIdentity(ctx: Ctx, tokenId: string): Promise<CachedTokenIdentity | null> {
  if (cacheTtlSeconds(ctx) === 0) return null;
  return appCache(ctx).get<CachedTokenIdentity>(TOKEN_KEY + tokenId);
}

export async function writeTokenIdentity(ctx: Ctx, tokenId: string, identity: CachedTokenIdentity): Promise<void> {
  const ttl = cacheTtlSeconds(ctx);
  if (ttl === 0) return;
  await appCache(ctx).set(TOKEN_KEY + tokenId, identity, ttl);
}

/** Forget one API token: the next request with it takes the cold path. */
export async function forgetToken(ctx: Ctx, tokenId: string): Promise<void> {
  await appCache(ctx).del(TOKEN_KEY + tokenId);
}

/**
 * Forget every session and API token of a user — after a password change,
 * a role change or a deletion. The ids come from the rows that exist now,
 * so this runs BEFORE the rows are deleted when both happen.
 */
export async function forgetUser(ctx: Ctx, userId: string): Promise<void> {
  const [sessions, tokens] = await Promise.all([
    ctx.models!.get<{ sid: string }>("Session").find({ user: userId }).select("sid -_id").lean(),
    ctx.models!.get<{ token_id: string }>("ApiToken").find({ user: userId }).select("token_id -_id").lean(),
  ]);
  await Promise.all([
    ...sessions.map((row) => forgetSession(ctx, row.sid)),
    ...tokens.map((row) => forgetToken(ctx, row.token_id)),
  ]);
}

/** `15m`, `1h`, `30d`, `900` (seconds) — the subset of ms/jsonwebtoken durations a TTL is written in. */
function durationSeconds(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)?\s*$/i.exec(value);
  if (!match) return 15 * 60;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  const factor = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86_400, w: 604_800, y: 31_557_600 }[unit] ?? 1;
  return Math.floor(amount * factor);
}
