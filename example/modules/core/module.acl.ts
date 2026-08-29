import type { AclBuilder } from "@tulipes/core/acl";

/**
 * The sys core module owns the global role vocabulary. Business modules
 * never define roles — they attach grants to these.
 */
export default function coreAcl(acl: AclBuilder): void {
  acl.defineRole("admin").defineRole("user");

  // admin can do everything, per resource-namespace wildcard rules.
  acl.allow("admin", "*");
}
