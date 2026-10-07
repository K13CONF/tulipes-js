import type { AclBuilder } from "@tulipes/core/acl";

/**
 * The agent door is open to every role, including guest: the manifest is
 * filtered to what the caller's role may call, and an action checks its
 * own permission before running, so these grants reveal and allow nothing
 * the ACL does not already.
 */
export default function agentAcl(acl: AclBuilder): void {
  acl.allow("guest", "agent:*");
  acl.allow("user", "agent:*");
  acl.allow("admin", "agent:*");
  acl.allow("sysadmin", "agent:*");
}
