import type { AclBuilder } from "@tulipes/core/acl";

/**
 * The infrastructure console is `sysadmin`-only.
 *
 * That boundary is real rather than nominal because the auth module no
 * longer grants `admin` the `*` wildcard — a wildcard would reach these
 * ids like any other, and "sysadmin only" would have been a label rather
 * than a rule.
 */
export default function settingsAcl(acl: AclBuilder): void {
  acl.allow("sysadmin", "settings:*");
}
