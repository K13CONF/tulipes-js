import type { AclBuilder } from "@tulipes/core/acl";

/**
 * Roles are global and defined once by the auth module; a feature module
 * only attaches grants, and always on its own RAIs ("hello:…"). Granting
 * the same role+resource from two modules crashes the boot.
 *
 * A grant ending in `:*` covers everything under it, the bare resource
 * included: `hello:web:greet:*` reaches `hello:web:greet` and
 * `hello:web:greet:by-name`.
 */
export default function helloAcl(acl: AclBuilder): void {
  // Public: the greeting endpoints are granted to guest, which is
  // how an endpoint is made public — there is no "skip auth" flag.
  acl.allow("guest", "hello:web:greet:*", "hello:web:demo:*");

  // Signed in: the secret, and listing and using greetings. The reset
  // action is `hello:bo:greetings:reset`, which only admin's `hello:*`
  // reaches.
  acl.allow("user", "hello:web:secret", "hello:web:greetings:*");
}
