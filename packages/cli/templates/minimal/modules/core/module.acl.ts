import type { AclBuilder } from "@tulipes/core/acl";
export default function permissions(acl: AclBuilder) {
  acl.defineRole("guest").allow("guest", "core:health");
}
