import { BootReport } from "../errors/boot-error.ts";

/**
 * Global ACL registry.
 *
 * Roles are app-global (the sys core module defines them); every other
 * module attaches permission grants to existing roles for its own resources.
 * Resources are namespaced strings — `users:write`, `categories:read`,
 * `users:*` — where the prefix is, by convention, the owning module.
 *
 * Every mutation happens through a per-module `AclBuilder` so each role
 * definition and grant records who made it: that is what lets a conflict
 * crash the boot with both module names in the message.
 */
export class Acl {
  /** role → module that defined it */
  readonly #roles = new Map<string, string>();
  /** role → (resource → module that granted it) */
  readonly #grants = new Map<string, Map<string, string>>();

  forModule(moduleName: string, report: BootReport): AclBuilder {
    return new AclBuilder(this, moduleName, report);
  }

  /**
   * Runtime permission check. Unknown roles simply deny — at request time
   * the safe answer to "can this unheard-of role do X?" is always no.
   */
  can(role: string, permission: string): boolean {
    const grants = this.#grants.get(role);
    if (!grants) return false;
    if (grants.has(permission) || grants.has("*")) return true;
    const namespace = permission.split(":")[0];
    return grants.has(`${namespace}:*`);
  }

  hasRole(role: string): boolean {
    return this.#roles.has(role);
  }

  roles(): string[] {
    return [...this.#roles.keys()];
  }

  /** Flat grant list — feeds logs, docs and the future postman generator. */
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
  defineRole_(role: string, moduleName: string): string | undefined {
    const existing = this.#roles.get(role);
    if (existing) return existing;
    this.#roles.set(role, moduleName);
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

/** `name:action`, `name:*`, or the standalone `*`. */
const RESOURCE = /^([a-z0-9-]+:[a-z0-9-]+|[a-z0-9-]+:\*|\*)$/;
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
   * be an error, never a silently created role.
   */
  defineRole(role: string): this {
    if (!ROLE.test(role)) {
      this.#issue(`role "${role}" is invalid — lowercase kebab-case required`);
      return this;
    }
    const definedBy = this.#acl.defineRole_(role, this.#module);
    if (definedBy) {
      this.#issue(`role "${role}" is already defined by module "${definedBy}"`);
    }
    return this;
  }

  allow(role: string, ...resources: string[]): this {
    if (!this.#acl.hasRole(role)) {
      this.#issue(
        `allow() on unknown role "${role}" — roles must be defined first (defineRole)`,
      );
      return this;
    }
    for (const resource of resources) {
      if (!RESOURCE.test(resource)) {
        this.#issue(
          `resource "${resource}" is invalid — expected "name:action", "name:*" or "*"`,
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
