import type { AclBuilder } from "@tulipes/core/acl";

/**
 * The roles, defined once. A RAI id is "module:scope:resource[:extra]";
 * a grant names one or a prefix ending in ":*". `pnpm tulipes roles`
 * prints every role with its grants.
 */
export default function permissions(acl: AclBuilder) {
  acl.defineRole("guest", { description: "Any request without a valid token" });
}
