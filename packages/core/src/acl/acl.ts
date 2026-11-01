import { BootReport } from "../errors/boot-error.ts";
import { grantsCovering, isGrant, isUnscopedRai } from "./rai-id.ts";

/**
 * The extra properties an app puts on a role, typed by augmentation — the
 * same pattern as RouteInfo and KnownVariables:
 *
 *   declare module "@tulipes/core/acl" {
 *     interface RoleMeta { level?: number; dashboard?: "bo" | "web" }
 *   }
 *
 * Anything not declared here is still accepted (a role definition is an
 * open record); declaring it is what types `acl.role("admin")?.level`.
 */
export interface RoleMeta {}

/** What `defineRole(name, definition)` takes. */
export type RoleDefinition = { description?: string } & RoleMeta & { [key: string]: unknown };

/** A role as the ACL holds it: its definition, its name and who defined it. */
export type RoleRecord = RoleDefinition & {
  readonly name: string;
  /** The module whose module.acl.ts defined it. */
  readonly definedBy: string;
};

/** Keys a definition may not set: the ACL owns them. */
const RESERVED = ["name", "definedBy"] as const;

/**
 * Global ACL registry.
 *
 * Roles are app-global (the role-owning module defines them); every other
 * module attaches permission grants to existing roles for its own
 * resources. A permission is a RAI id — `users:bo:list` — and a grant is
 * an id or a prefix wildcard: `users:bo:*`, `users:*`, `*`.
 *
 * Every mutation happens through a per-module `AclBuilder` so each role
 * definition and grant records who made it: that is what lets a conflict
 * crash the boot with both module names in the message.
 */
export class Acl {
  /** role → its record, in definition order */
  readonly #roles = new Map<string, RoleRecord>();
  /** role → (resource → module that granted it) */
  readonly #grants = new Map<string, Map<string, string>>();

  forModule(moduleName: string, report: BootReport): AclBuilder {
    return new AclBuilder(this, moduleName, report);
  }

  /**
   * Runtime permission check. Unknown roles simply deny — at request time
   * the safe answer to "can this unheard-of role do X?" is always no.
   *
   * A grant reaches a permission exactly, through any prefix wildcard
   * (`users:bo:detail:*` reaches `users:bo:detail` and
   * `users:bo:detail:delete`), or through `*`.
   */
  can(role: string, permission: string): boolean {
    const grants = this.#grants.get(role);
    if (!grants) return false;
    return grantsCovering(permission).some((grant) => grants.has(grant));
  }

  /** Every role that holds `permission`, sorted — the inverse of `can()`. */
  rolesFor(permission: string): string[] {
    return [...this.#grants.keys()].filter((role) => this.can(role, permission)).sort();
  }

  hasRole(role: string): boolean {
    return this.#roles.has(role);
  }

  roles(): string[] {
    return [...this.#roles.keys()];
  }

  /** One role's record — description and extras included — or undefined. */
  role(name: string): RoleRecord | undefined {
    return this.#roles.get(name);
  }

  /** Every role with its metadata, in definition order. */
  describeRoles(): RoleRecord[] {
    return [...this.#roles.values()];
  }

  /** Flat grant list — feeds logs, docs and the spec generator. */
  describe(): { role: string; resource: string; grantedBy: string }[] {
    return [...this.#grants.entries()].flatMap(([role, grants]) =>
      [...grants.entries()].map(([resource, grantedBy]) => ({
        role,
        resource,
        grantedBy,
      })),
    );
  }

  /** @internal AclBuilder only. */
  defineRole_(role: string, definition: RoleDefinition, moduleName: string): string | undefined {
    const existing = this.#roles.get(role);
    if (existing) return existing.definedBy;
    this.#roles.set(role, Object.freeze({ ...definition, name: role, definedBy: moduleName }));
    this.#grants.set(role, new Map());
    return undefined;
  }

  /** @internal AclBuilder only. */
  grant_(role: string, resource: string, moduleName: string): string | undefined {
    const grants = this.#grants.get(role);
    if (!grants) return undefined; // caller reports the unknown role
    const existing = grants.get(resource);
    if (existing) return existing;
    grants.set(resource, moduleName);
    return undefined;
  }
}

const ROLE = /^[a-z][a-z0-9-]*$/;

/**
 * The module-scoped facade handed to `module.acl.ts`. All validation issues
 * flow into the boot report — collected, never thrown — so a module with
 * three bad grants shows all three.
 */
export class AclBuilder {
  readonly #acl: Acl;
  readonly #module: string;
  readonly #report: BootReport;

  constructor(acl: Acl, moduleName: string, report: BootReport) {
    this.#acl = acl;
    this.#module = moduleName;
    this.#report = report;
  }

  /**
   * Introducing a role is deliberately explicit — a typo in `allow()` must
   * be an error, never a silently created role. The definition is
   * optional and open: a description, plus anything the app wants to read
   * back later through `acl.role(name)`.
   *
   *   acl.defineRole("admin", { description: "Runs the back office", level: 2 });
   */
  defineRole(role: string, definition: RoleDefinition = {}): this {
    if (!ROLE.test(role)) {
      this.#issue(`role "${role}" is invalid — lowercase kebab-case required`);
      return this;
    }
    if (!isPlainObject(definition)) {
      this.#issue(`role "${role}": the definition must be a plain object`);
      return this;
    }
    if (definition.description !== undefined && typeof definition.description !== "string") {
      this.#issue(`role "${role}": description must be a string`);
      return this;
    }
    const clean: RoleDefinition = { ...definition };
    for (const key of RESERVED) {
      if (key in clean) {
        this.#issue(`role "${role}": "${key}" is set by the ACL and cannot be defined`);
        delete clean[key];
      }
    }
    const definedBy = this.#acl.defineRole_(role, clean, this.#module);
    if (definedBy) {
      this.#issue(`role "${role}" is already defined by module "${definedBy}"`);
    }
    return this;
  }

  /**
   * Grants `role` each resource. A module grants its own ids
   * (`hello` grants `hello:…`); only the module that defined the role may
   * grant it another module's ids or `*`. Otherwise any feature module
   * could open the users back office, or everything, to guest — so that
   * refuses the boot with both module names rather than passing silently.
   */
  allow(role: string, ...resources: string[]): this {
    if (!this.#acl.hasRole(role)) {
      this.#issue(
        `allow() on unknown role "${role}" — roles must be defined first (defineRole)`,
      );
      return this;
    }
    for (const resource of resources) {
      if (!isGrant(resource)) {
        this.#issue(
          isUnscopedRai(resource)
            ? `resource "${resource}" has no scope — since 0.12 a grant is "module:scope:resource[:extra]" ` +
                `or a prefix wildcard (\`tulipes migrate 0.12\` rewrites a 0.11 app)`
            : `resource "${resource}" is invalid — expected a RAI id ("module:scope:resource[:extra]"), ` +
                `a prefix wildcard ("module:*", "module:scope:*", "module:scope:resource:*") or "*"`,
        );
        continue;
      }
      const owner = this.#acl.role(role)!.definedBy;
      const namespace = resource === "*" ? undefined : resource.split(":")[0];
      if (namespace !== this.#module && owner !== this.#module) {
        this.#issue(
          resource === "*"
            ? `grants "${role}" everything ("*") — only module "${owner}", which defines "${role}", may grant "*"`
            : `grants "${role}" "${resource}", an id of module "${namespace}" — a module grants its own ids ` +
                `("${this.#module}:…"); grants on another module's ids belong in "${owner}", which defines "${role}"`,
        );
        continue;
      }
      const grantedBy = this.#acl.grant_(role, resource, this.#module);
      if (grantedBy) {
        this.#issue(
          `"${role}" already granted "${resource}" by module "${grantedBy}" — duplicate grant`,
        );
      }
    }
    return this;
  }

  #issue(message: string): void {
    this.#report.add({ scope: "acl", module: this.#module, message });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
