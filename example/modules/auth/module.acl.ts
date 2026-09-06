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
  acl.defineRole("guest").defineRole("user").defineRole("admin").defineRole("sysadmin");

  // Anyone may attempt to authenticate. Refresh is public because the
  // refresh token itself is the credential — an expired access token must
  // not stand in the way of renewing it.
  acl.allow("guest", "auth:login", "auth:register", "auth:refresh");

  // Signed in: end your session, read yourself, change your own password,
  // and manage the devices you are signed in on.
  acl.allow(
    "user",
    "auth:logout",
    "auth:me",
    "auth:password",
    "auth:sessions",
    "auth:session-end",
  );
  // `admin` is granted each feature namespace EXPLICITLY rather than "*".
  // A wildcard would also reach settings:*, and the infrastructure console
  // is meant to be a boundary an ordinary administrator cannot cross — a
  // grant that quietly includes everything makes "sysadmin only" a label
  // rather than a rule. Add your own namespaces here as modules arrive.
  acl.allow("admin", "auth:*", "users:*", "hello:*");

  // `sysadmin` is an admin who can also administer the deployment. The
  // settings grant is NOT here: a module grants its own namespace, so
  // `settings:*` is declared by the settings module itself.
  acl.allow("sysadmin", "auth:*", "users:*", "hello:*");
}
