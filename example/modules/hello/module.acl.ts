import type { AclBuilder } from "@tulipes/core/acl";

/**
 * Roles are global and defined once by the sys core module; a feature
 * module only attaches grants, and always on resources namespaced by
 * its own name ("hello:*"). Granting the same role+resource from two
 * modules crashes the boot.
 */
export default function helloAcl(acl: AclBuilder): void {
  // Public: the greeting endpoints are granted to guest, which is
  // how an endpoint is made public — there is no "skip auth" flag.
  acl.allow("guest", "hello:greet", "hello:greet-name", "hello:demo-missing");

  // Signed in: the secret needs a real role.
  acl.allow("user", "hello:read", "hello:list-greetings", "hello:use-greeting");
}
