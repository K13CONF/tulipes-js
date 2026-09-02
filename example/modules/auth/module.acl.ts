import type { AclBuilder } from "@tulipes/core/acl";

/**
 * The auth module owns the role vocabulary, because roles only mean
 * anything alongside the thing that assigns them.
 *
 * `guest` is the fallback for a request with no valid token. That is what
 * makes "public endpoint" an ordinary ACL grant rather than a second
 * mechanism: login is public because guest may do it, not because a path
 * appears on an allowlist somewhere else.
 */
export default function authAcl(acl: AclBuilder): void {
  acl.defineRole("guest").defineRole("user").defineRole("admin");

  // Anyone may attempt to authenticate. Refresh is public because the
  // refresh token itself is the credential — an expired access token must
  // not stand in the way of renewing it.
  acl.allow("guest", "auth:login", "auth:register", "auth:refresh");

  // Signed in: end your session, read yourself, change your own password.
  acl.allow("user", "auth:logout", "auth:me", "auth:password");
  acl.allow("admin", "*");
}
