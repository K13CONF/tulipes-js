import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Ctx } from "@tulipes/core/boot";

/** What a verified token tells us. Roles are never trusted from here. */
export interface TokenClaims {
  sub: string;
  jti: string;
  typ: "access" | "refresh";
  iat: number;
  exp: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

const secret = (ctx: Ctx, typ: "access" | "refresh"): string =>
  String(ctx.Environment.get(typ === "access" ? "JWT_ACCESS_SECRET" : "JWT_REFRESH_SECRET"));

const ttl = (ctx: Ctx, typ: "access" | "refresh"): string =>
  String(ctx.Environment.get(typ === "access" ? "JWT_ACCESS_TTL" : "JWT_REFRESH_TTL"));

/**
 * Issue a pair and record the refresh token so it can be revoked.
 *
 * The access token deliberately carries no role. Roles change, tokens do
 * not, and a stale role in a signed token is a privilege bug waiting to
 * happen — the request pipeline reloads the user instead.
 */
export async function issuePair(ctx: Ctx, userId: string): Promise<TokenPair> {
  const accessJti = randomUUID();
  const refreshJti = randomUUID();

  const accessToken = jwt.sign({ typ: "access" }, secret(ctx, "access"), {
    subject: userId,
    jwtid: accessJti,
    expiresIn: ttl(ctx, "access") as jwt.SignOptions["expiresIn"],
  });

  const refreshToken = jwt.sign({ typ: "refresh" }, secret(ctx, "refresh"), {
    subject: userId,
    jwtid: refreshJti,
    expiresIn: ttl(ctx, "refresh") as jwt.SignOptions["expiresIn"],
  });

  const { exp } = jwt.decode(refreshToken) as { exp: number };
  await ctx.models!.get("RefreshToken").create({
    jti: refreshJti,
    user: userId,
    expiresAt: new Date(exp * 1000),
  });

  return { accessToken, refreshToken, expiresIn: ttl(ctx, "access") };
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

/** Consume a refresh token: valid only if its row still exists. */
export async function consumeRefresh(ctx: Ctx, jti: string): Promise<boolean> {
  const result = await ctx.models!.get("RefreshToken").deleteOne({ jti });
  return result.deletedCount === 1;
}

/** Blacklist an access token for whatever is left of its lifetime. */
export async function revokeAccess(ctx: Ctx, claims: TokenClaims): Promise<void> {
  await ctx.models!.get("RevokedToken").updateOne(
    { jti: claims.jti },
    { $setOnInsert: { jti: claims.jti, expiresAt: new Date(claims.exp * 1000) } },
    { upsert: true },
  );
}

export async function isRevoked(ctx: Ctx, jti: string): Promise<boolean> {
  return (await ctx.models!.get("RevokedToken").countDocuments({ jti }).limit(1)) > 0;
}

/** Drop every refresh token a user holds — used after a password change. */
export async function revokeAllForUser(ctx: Ctx, userId: string): Promise<void> {
  await ctx.models!.get("RefreshToken").deleteMany({ user: userId });
}
