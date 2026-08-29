import type { AclBuilder } from "@forgex/core/acl";

export default function usersAcl(acl: AclBuilder): void {
  acl.allow("user", "users:read");
}
