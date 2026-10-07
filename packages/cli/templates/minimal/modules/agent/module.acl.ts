import type { AclBuilder } from "@tulipes/core/acl";
// Open to every caller: the manifest shows only what the role may call.
export default function permissions(acl: AclBuilder) { acl.allow("guest", "agent:*"); }
