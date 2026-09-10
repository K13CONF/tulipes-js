import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request } from "express";
import type { Ctx } from "@tulipes/core/boot";
import { HttpError } from "@tulipes/core/http";
import { currentCredentialVersion } from "./passwords.js";

import type { SessionDoc } from "./documents.js";

/**
 * What a verified token tells us. Roles are never trusted from here.
 *
 * `sid` names the session both tokens of a pair belong to; `jti` names the
 * individual token. The split is what lets an access token find its own
 * session row, whose refresh jti has meanwhile rotated out from under it.
 */
export interface TokenClaims {
  sub: string;
  sid: string;
  jti: string;
  typ: "access" | "refresh";
  iat: number;
  exp: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: string;
}

/** Where a session was started, for the row and for the user to review. */
export interface SessionOrigin {
  ip?: string;
  user_agent?: string;
}

const secret = (ctx: Ctx, typ: "access" | "refresh"): string =>
  String(ctx.Environment.get(typ === "access" ? "JWT_ACCESS_SECRET" : "JWT_REFRESH_SECRET"));

const ttl = (ctx: Ctx, typ: "access" | "refresh"): string =>
  String(ctx.Environment.get(typ === "access" ? "JWT_ACCESS_TTL" : "JWT_REFRESH_TTL"));

/**
 * Mint a pair for an existing session.
 *
 * The access token deliberately carries no role. Roles change, tokens do
 * not, and a stale role in a signed token is a privilege bug waiting to
 * happen — the request pipeline reloads the user instead.
 */
function mint(ctx: Ctx, userId: string, sid: string): TokenPair & { refreshJti: string; refreshExp: number } {
  const refreshJti = randomUUID();

  const access_token = jwt.sign({ typ: "access", sid }, secret(ctx, "access"), {
    subject: userId,
    jwtid: randomUUID(),
    expiresIn: ttl(ctx, "access") as jwt.SignOptions["expiresIn"],
  });

  const refresh_token = jwt.sign({ typ: "refresh", sid }, secret(ctx, "refresh"), {
    subject: userId,
    jwtid: refreshJti,
    expiresIn: ttl(ctx, "refresh") as jwt.SignOptions["expiresIn"],
  });

  const { exp } = jwt.decode(refresh_token) as { exp: number };
  return {
    access_token,
    refresh_token,
    expires_in: ttl(ctx, "access"),
    refreshJti,
    refreshExp: exp,
  };
}

/** Open a session — a sign-in, from a device worth remembering. */
export async function startSession(
  ctx: Ctx,
  userId: string,
  credentialVersion: string,
  origin: SessionOrigin = {},
): Promise<TokenPair> {
  const sid = randomUUID();
  const { refreshJti, refreshExp, ...pair } = mint(ctx, userId, sid);

  await ctx.models!.get("Session").create({
    sid,
    user: userId,
    credential_version: credentialVersion,
    refresh_jti: refreshJti,
    ip: origin.ip,
    user_agent: origin.user_agent,
    expires_at: new Date(refreshExp * 1000),
  });

  // A password change may have committed while this insert was in flight.
  if (!await loadSession(ctx, sid, userId)) {
    await endSession(ctx, sid);
    throw new HttpError(401, "invalidCredentials");
  }
  return pair;
}

/**
 * Rotate the pair, keeping the session. The update is conditional on the
 * refresh jti presented still being the current one, which is what makes
 * a replayed refresh token match nothing — atomically, so two racing
 * requests cannot both win.
 */
export async function rotateSession(
  ctx: Ctx,
  claims: TokenClaims,
): Promise<TokenPair | undefined> {
  const version = await currentCredentialVersion(ctx, claims.sub);
  if (!version) return undefined;
  const sid = claims.sid;
  const { refreshJti, refreshExp, ...pair } = mint(ctx, claims.sub, sid);

  const session = await ctx.models!.get("Session").findOneAndUpdate(
    { sid, user: claims.sub, credential_version: version, refresh_jti: claims.jti, expires_at: { $gt: new Date() } },
    {
      refresh_jti: refreshJti,
      expires_at: new Date(refreshExp * 1000),
      last_seen_at: new Date(),
    },
  );

  return session ? pair : undefined;
}

/** Verify signature and type. Returns undefined rather than throwing. */
export function verify(
  ctx: Ctx,
  token: string,
  typ: "access" | "refresh",
): TokenClaims | undefined {
  try {
    const claims = jwt.verify(token, secret(ctx, typ)) as TokenClaims;
    return claims.typ === typ ? claims : undefined;
  } catch {
    return undefined;
  }
}

/** A live session owned by the token subject. TTL cleanup is not authorization. */
export async function loadSession(ctx: Ctx, sid: string, userId: string): Promise<SessionDoc | null> {
  const version = await currentCredentialVersion(ctx, userId);
  if (!version) return null;
  return ctx.models!.get<SessionDoc>("Session").findOne({ sid, user: userId, credential_version: version, expires_at: { $gt: new Date() } });
}

/**
 * Record that a session is still in use — at most once per `afterSeconds`,
 * because a write on every request would cost more than the field is worth.
 */
export async function touchSession(
  ctx: Ctx,
  session: SessionDoc,
  afterSeconds: number,
): Promise<void> {
  const age = Date.now() - (session.last_seen_at?.getTime() ?? 0);
  if (age < afterSeconds * 1000) return;

  const now = new Date();
  session.last_seen_at = now;
  await ctx.models!.get("Session").updateOne({ sid: session.sid }, { last_seen_at: now });
}

/** End one session: the refresh half dies with its row. */
export async function endSession(ctx: Ctx, sid: string): Promise<boolean> {
  const result = await ctx.models!.get("Session").deleteOne({ sid });
  return result.deletedCount === 1;
}

/** Blacklist an access token for whatever is left of its lifetime. */
export async function revokeAccess(ctx: Ctx, claims: TokenClaims): Promise<void> {
  await ctx.models!.get("RevokedToken").updateOne(
    { jti: claims.jti },
    { $setOnInsert: { jti: claims.jti, expires_at: new Date(claims.exp * 1000) } },
    { upsert: true },
  );
}

export async function isRevoked(ctx: Ctx, jti: string): Promise<boolean> {
  return (await ctx.models!.get("RevokedToken").countDocuments({ jti }).limit(1)) > 0;
}

/** Drop stored sessions for a user; this alone does not block concurrent sign-ins. */
export async function endAllSessions(ctx: Ctx, userId: string): Promise<void> {
  await ctx.models!.get("Session").deleteMany({ user: userId });
}

/** Active devices, newest first, including when expired rows await TTL cleanup. */
export async function listSessions(ctx: Ctx, userId: string): Promise<SessionDoc[]> {
  const version = await currentCredentialVersion(ctx, userId);
  if (!version) return [];
  return ctx.models!.get<SessionDoc>("Session").find({ user: userId, credential_version: version, expires_at: { $gt: new Date() } }).sort({ created_at: -1 });
}

/** Where a request came from, for the session row. */
export function originOf(req: Request): SessionOrigin {
  return { ip: req.ip, user_agent: req.header("user-agent") };
}
