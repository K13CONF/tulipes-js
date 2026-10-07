import type { AclBuilder } from "@tulipes/core/acl";

/**
 * The console. Reading what the app is configured with is an
 * administrator's job; changing it is the deployment's, so writes stay
 * with `sysadmin`. The boundary is real because the auth module never
 * grants `admin` the `*` wildcard.
 */
export default function configAcl(acl: AclBuilder): void {
  acl.allow("admin", "config:read", "config:describe");
  acl.allow("sysadmin", "config:*");
}
