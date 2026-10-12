/**
 * The RAI grammar — one place, so the route scan, agent actions, the ACL
 * and every tool that reads an id agree on what one is.
 *
 *   {module}:{scope}:{resource}[:{extra}]
 *
 *   users:bo:list              module=users scope=bo     resource=list
 *   users:mobile:profile       module=users scope=mobile resource=profile
 *   users:bo:detail:delete     module=users scope=bo     resource=detail extra=delete
 *
 * - **module** — the declaring module's short name, as its package.json
 *   spells it (`@app/user-profiles` → `user-profiles`). A convention: the
 *   boot does not check who declared what.
 * - **scope** — the surface the permission serves: `bo`, `web`, `mobile`,
 *   anything the app names. Free-form; the ACL does not interpret it.
 * - **resource** — what is being reached: `list`, `detail`, `profile`.
 * - **extra** — optional, a variant or sub-action of the resource.
 *
 * Every segment is lowercase, starts with a letter and may contain digits
 * and hyphens: `[a-z][a-z0-9-]*`.
 */

/** One segment of a RAI id. */
export const RAI_SEGMENT = /^[a-z][a-z0-9-]*$/;

/** How an id is described in a boot report. */
export const RAI_SHAPE =
  '"module:scope:resource" or "module:scope:resource:extra", lowercase segments ([a-z][a-z0-9-]*)';

/**
 * A RAI id, as far as the type system can tell: at least three segments.
 * `rai({ id: "users:read" })` is an error in the editor; the boot scan is
 * the authority on the rest (casing, a fifth segment).
 */
export type Rai = `${string}:${string}:${string}`;

export interface RaiParts {
  module: string;
  scope: string;
  resource: string;
  extra?: string;
}

const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 4;

/** True for a well-formed id: three or four valid segments. */
export function isRai(id: unknown): id is Rai {
  if (typeof id !== "string") return false;
  const segments = id.split(":");
  return (
    segments.length >= MIN_SEGMENTS &&
    segments.length <= MAX_SEGMENTS &&
    segments.every((segment) => RAI_SEGMENT.test(segment))
  );
}

/**
 * Splits an id into its named parts. Throws on an invalid one, so a caller
 * holding `req.rai.id` (which the boot already validated) never checks.
 *
 *   const { scope } = parseRai(req.rai!.id);
 */
export function parseRai(id: string): RaiParts {
  if (!isRai(id)) throw new TypeError(`"${id}" is not a RAI id — expected ${RAI_SHAPE}`);
  const [module, scope, resource, extra] = id.split(":") as [string, string, string, string?];
  return extra === undefined ? { module, scope, resource } : { module, scope, resource, extra };
}

/**
 * What `acl.allow()` accepts: a full id, `*`, or one to three valid
 * segments followed by `:*`.
 *
 *   *                       everything
 *   users:*                 every users permission, any scope
 *   users:bo:*              every users permission in the bo scope
 *   users:bo:detail:*       users:bo:detail and all its extras
 */
export function isGrant(resource: unknown): resource is string {
  if (typeof resource !== "string") return false;
  if (resource === "*") return true;
  if (isRai(resource)) return true;
  if (!resource.endsWith(":*")) return false;
  const segments = resource.slice(0, -2).split(":");
  return (
    segments.length >= 1 &&
    segments.length <= MAX_SEGMENTS - 1 &&
    segments.every((segment) => RAI_SEGMENT.test(segment))
  );
}

/**
 * Every grant that reaches `permission`, most specific first: the id
 * itself, then each prefix wildcard from longest to shortest, then `*`.
 * The ACL, `tulipes routes` and the spec generator all resolve through
 * this, so a document cannot disagree with the gate.
 */
export function grantsCovering(permission: string): string[] {
  const segments = permission.split(":");
  const covering = [permission];
  for (let length = segments.length; length >= 1; length--) {
    covering.push(`${segments.slice(0, length).join(":")}:*`);
  }
  covering.push("*");
  return covering;
}
