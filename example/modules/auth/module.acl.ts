import type { AclBuilder } from "@tulipes/core/acl";

/**
 * Roles carry whatever the app wants to read back about them. Declaring an
 * extra here types it everywhere: `ctx.acl.role("admin")?.level` is a
 * number. Anything undeclared is still accepted, just untyped.
 */
declare module "@tulipes/core/acl" {
  interface RoleMeta {
    /** Higher reaches more. For display and ordering; the ACL decides access. */
    level?: number;
  }
}

/**
 * The auth module owns the role vocabulary, because roles only mean
 * anything alongside the thing that assigns them. `pnpm tulipes roles`
 * prints them with their descriptions and every grant they hold.
 *
 * `guest` is the fallback for a request with no valid token. That is what
 * makes "public endpoint" an ordinary ACL grant rather than a second
 * mechanism: login is public because guest may do it, not because a path
 * appears on an allowlist somewhere else.
 *
 * Every permission is a RAI id, `module:scope:resource[:extra]`. This app
 * has two scopes: `web`, what a signed-in client calls, and `bo`, the back
 * office. A grant names one id or a prefix: `users:bo:*` is the whole users
 * back office, `users:*` every users surface, `*` everything.
 */
export default function authAcl(acl: AclBuilder): void {
  acl
    .defineRole("guest", { description: "Any request without a valid token", level: 0 })
    .defineRole("user", { description: "A signed-in account", level: 1 })
    .defineRole("admin", { description: "Runs the back office", level: 2 })
    .defineRole("sysadmin", { description: "Administers the deployment and its settings", level: 3 });

  // Anyone may attempt to authenticate. Refresh is public because the
  // refresh token itself is the credential — an expired access token must
  // not stand in the way of renewing it.
  acl.allow("guest", "auth:web:login", "auth:web:register", "auth:web:refresh");

  // Signed in: end your session, read yourself, change your own password,
  // manage the devices you are signed in on (`auth:web:sessions:*` covers
  // listing them and ending one) and your API tokens.
  acl.allow(
    "user",
    "auth:web:logout",
    "auth:web:me",
    "auth:web:password",
    "auth:web:sessions:*",
    "auth:web:tokens:*",
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
