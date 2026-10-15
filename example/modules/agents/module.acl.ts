import type { AclBuilder } from "@tulipes/core/acl";

/**
 * A signed-in person runs agents of their own. The back office's
 * `agents:bo:*` reaches every run through the admin and sysadmin grants of
 * `agents:*` in the auth module, where the roles are defined.
 */
export default function agentsAcl(acl: AclBuilder): void {
  acl.allow("user", "agents:web:runs:*");
}
