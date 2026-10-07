import type { Ctx } from "@tulipes/core/boot";
import type { Auth } from "@tulipes/core/http";
import type { UserDoc } from "./documents.ts";
import { isRevoked, loadSession } from "./tokens.ts";

/** Capture the authenticated token identity, then reload its authority on demand. */
export function createAccessCheck(
  ctx: Ctx,
  auth: Auth,
  permission: string,
): (signal: AbortSignal) => Promise<boolean> {
  // Copy scalars; do not retain a mutable request/user document as authorization.
  const userId = auth.user ? String(auth.user._id) : "";
  const sid = auth.session?.sid;
  const jti = auth.session?.access_jti;
  const version = auth.session?.credential_version;
  const expiresAt = auth.session?.access_expires_at.getTime() ?? 0;

  return async (signal) => {
    signal.throwIfAborted();
    if (!userId || !sid || !jti || !version || Date.now() >= expiresAt) {
      return false;
    }

    // loadSession checks owner, current credential version and live expiration.
    // It also rejects a family expired by refresh-token reuse.
    const session = await loadSession(ctx, sid, userId);
    signal.throwIfAborted();
    if (!session || session.credential_version !== version) return false;

    const revoked = await isRevoked(ctx, jti);
    signal.throwIfAborted();
    if (revoked) return false;

    const user = await ctx.models!.get<UserDoc>("User").findById(userId);
    signal.throwIfAborted();

    return Boolean(
      user && Date.now() < expiresAt && ctx.acl?.can(user.role, permission),
    );
  };
}
