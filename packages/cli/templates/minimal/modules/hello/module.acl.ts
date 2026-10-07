import type { AclBuilder } from "@tulipes/core/acl";
export default function permissions(acl: AclBuilder) { acl.allow("guest", "hello:read"); }
