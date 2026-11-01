import { describe, expect, test } from "vitest";

import { Acl } from "../src/acl/acl.ts";
import { grantsCovering, isGrant, isRai, parseRai } from "../src/acl/rai-id.ts";
import { BootReport } from "../src/errors/boot-error.ts";

/**
 * The RAI grammar and the ACL that resolves it, without a boot: what an id
 * is, what a grant reaches, and what a role carries besides its name.
 */

const messages = (report: BootReport) => report.issues.map(({ message }) => message);

describe("the RAI grammar", () => {
  test.each([
    "users:bo:list",
    "users:mobile:profile",
    "users:bo:detail:delete",
    "user-profiles:web:avatar",
    "auth:web:sessions:end",
    "v2:bo:report-2024",
  ])("%s is an id", (id) => {
    expect(isRai(id)).toBe(true);
    expect(isGrant(id)).toBe(true);
  });

  test.each([
    ["users:read", "two segments: the scope is missing"],
    ["users", "one segment"],
    ["users:bo:detail:delete:now", "five segments"],
    ["Users:bo:list", "uppercase"],
    ["users::list", "an empty segment"],
    ["users:bo:list:", "a trailing colon"],
    ["users:b o:list", "a space"],
    ["users:bo:2fa", "a segment starting with a digit"],
    ["users_admin:bo:list", "an underscore"],
    ["users:*:list", "a wildcard inside an id"],
    ["", "the empty string"],
  ])("%s is not an id (%s)", (id) => {
    expect(isRai(id)).toBe(false);
  });

  test("a non-string is never an id or a grant", () => {
    expect(isRai(undefined)).toBe(false);
    expect(isRai(42)).toBe(false);
    expect(isGrant(null)).toBe(false);
  });

  test("parseRai names each part, and omits extra when there is none", () => {
    expect(parseRai("users:bo:list")).toEqual({ module: "users", scope: "bo", resource: "list" });
    expect(parseRai("users:bo:detail:delete")).toEqual({
      module: "users",
      scope: "bo",
      resource: "detail",
      extra: "delete",
    });
    expect(() => parseRai("users:read")).toThrow(/"users:read" is not a RAI id — expected "module:scope:resource"/);
  });

  test.each([
    ["*", true],
    ["users:*", true],
    ["users:bo:*", true],
    ["users:bo:detail:*", true],
    ["users:bo:detail:delete:*", false],
    ["*:bo:*", false],
    ["users:*:list", false],
    ["users:bo", false],
    ["Users:*", false],
    [":*", false],
  ])("%s as a grant: %s", (grant, valid) => {
    expect(isGrant(grant)).toBe(valid);
  });

  test("the grants covering a permission run from the id itself to everything", () => {
    expect(grantsCovering("users:bo:detail:delete")).toEqual([
      "users:bo:detail:delete",
      "users:bo:detail:delete:*",
      "users:bo:detail:*",
      "users:bo:*",
      "users:*",
      "*",
    ]);
  });
});

describe("grants", () => {
  const build = (grant: (acl: ReturnType<Acl["forModule"]>) => void) => {
    const acl = new Acl();
    const report = new BootReport();
    const builder = acl.forModule("auth", report);
    builder.defineRole("guest").defineRole("user").defineRole("admin");
    grant(builder);
    return { acl, report };
  };

  test("a wildcard reaches every permission under its prefix, at every depth", () => {
    const { acl, report } = build((acl) => {
      acl.allow("guest", "users:web:list");
      acl.allow("user", "users:bo:detail:*");
      acl.allow("admin", "users:*");
    });

    expect(report.issues).toEqual([]);

    expect(acl.can("guest", "users:web:list")).toBe(true);
    expect(acl.can("guest", "users:web:list:deleted")).toBe(false);
    expect(acl.can("guest", "users:web:profile")).toBe(false);

    // A prefix wildcard covers the bare resource as well as its extras.
    expect(acl.can("user", "users:bo:detail")).toBe(true);
    expect(acl.can("user", "users:bo:detail:delete")).toBe(true);
    expect(acl.can("user", "users:bo:list")).toBe(false);
    expect(acl.can("user", "users:web:detail")).toBe(false);

    expect(acl.can("admin", "users:bo:detail:delete")).toBe(true);
    expect(acl.can("admin", "users:mobile:profile")).toBe(true);
    expect(acl.can("admin", "orders:bo:list")).toBe(false);
  });

  test("a prefix that only shares characters is not a parent", () => {
    const { acl } = build((acl) => acl.allow("user", "users:bo:*"));

    expect(acl.can("user", "users:bob:list")).toBe(false);
    expect(acl.can("user", "users-admin:bo:list")).toBe(false);
  });

  test("* reaches everything, and an unknown role reaches nothing", () => {
    const { acl } = build((acl) => acl.allow("admin", "*"));

    expect(acl.can("admin", "anything:at:all")).toBe(true);
    expect(acl.can("ghost", "anything:at:all")).toBe(false);
  });

  test("rolesFor answers the inverse question with the same resolution", () => {
    const { acl } = build((acl) => {
      acl.allow("guest", "users:web:list");
      acl.allow("user", "users:web:*");
      acl.allow("admin", "*");
    });

    expect(acl.rolesFor("users:web:list")).toEqual(["admin", "guest", "user"]);
    expect(acl.rolesFor("users:web:profile")).toEqual(["admin", "user"]);
    expect(acl.rolesFor("users:bo:list")).toEqual(["admin"]);
  });

  test("invalid grants are reported, all of them, and grant nothing", () => {
    const { acl, report } = build((acl) => {
      acl.allow("user", "users:read", "*:bo:*", "users:bo:detail:delete:*", "users:web:list");
    });

    expect(messages(report)).toEqual([
      expect.stringMatching(/^resource "users:read" has no scope — since 0\.12 a grant is "module:scope:resource\[:extra\]" or a prefix wildcard \(`tulipes migrate 0\.12` rewrites a 0\.11 app\)$/),
      expect.stringMatching(/^resource "\*:bo:\*" is invalid — expected a RAI id/),
      expect.stringMatching(/^resource "users:bo:detail:delete:\*" is invalid/),
    ]);
    expect(report.issues.every(({ scope, module }) => scope === "acl" && module === "auth")).toBe(true);
    expect(acl.can("user", "users:web:list")).toBe(true);
    expect(acl.can("user", "users:bo:list")).toBe(false);
  });

  test("a module grants its own ids; only the role's owner grants another module's ids or *", () => {
    const acl = new Acl();
    const report = new BootReport();
    acl.forModule("auth", report).defineRole("guest").defineRole("admin")
      .allow("admin", "users:*", "*"); // the owner may
    acl.forModule("hello", report)
      .allow("guest", "hello:web:greet", "hello:*") // its own ids
      .allow("guest", "users:bo:list", "users:*", "*");

    expect(messages(report)).toEqual([
      'grants "guest" "users:bo:list", an id of module "users" — a module grants its own ids ("hello:…"); grants on another module\'s ids belong in "auth", which defines "guest"',
      'grants "guest" "users:*", an id of module "users" — a module grants its own ids ("hello:…"); grants on another module\'s ids belong in "auth", which defines "guest"',
      'grants "guest" everything ("*") — only module "auth", which defines "guest", may grant "*"',
    ]);
    expect(report.issues.slice(-3).every(({ module }) => module === "hello")).toBe(true);
    expect(acl.can("guest", "hello:web:greet")).toBe(true);
    expect(acl.can("guest", "users:bo:list")).toBe(false);
    expect(acl.can("admin", "orders:bo:list")).toBe(true);
  });

  test("a duplicate grant and a grant on an unknown role are reported", () => {
    const { report } = build((acl) => {
      acl.allow("user", "users:web:list");
      acl.allow("user", "users:web:list");
      acl.allow("ghost", "users:web:list");
    });

    expect(messages(report)).toEqual([
      '"user" already granted "users:web:list" by module "auth" — duplicate grant',
      'allow() on unknown role "ghost" — roles must be defined first (defineRole)',
    ]);
  });
});

describe("roles", () => {
  test("a role carries its description and any extra property, read back with who defined it", () => {
    const acl = new Acl();
    const report = new BootReport();

    acl.forModule("auth", report)
      .defineRole("guest")
      .defineRole("admin", { description: "Runs the back office", level: 2, dashboard: "bo" });

    expect(report.issues).toEqual([]);
    expect(acl.role("guest")).toEqual({ name: "guest", definedBy: "auth" });
    expect(acl.role("admin")).toEqual({
      name: "admin",
      definedBy: "auth",
      description: "Runs the back office",
      level: 2,
      dashboard: "bo",
    });
    expect(acl.role("ghost")).toBeUndefined();
    expect(acl.describeRoles().map(({ name }) => name)).toEqual(["guest", "admin"]);
    expect(acl.roles()).toEqual(["guest", "admin"]);
  });

  test("a role record cannot be changed after the ACL loads", () => {
    const acl = new Acl();
    acl.forModule("auth", new BootReport()).defineRole("admin", { description: "Runs the back office" });

    const record = acl.role("admin")!;

    expect(Object.isFrozen(record)).toBe(true);
    expect(() => {
      (record as { description?: string }).description = "changed";
    }).toThrow(TypeError);
  });

  test("the definition is copied, so mutating the caller's object changes nothing", () => {
    const acl = new Acl();
    const definition: { description: string; tags: string[] } = { description: "Signed in", tags: [] };

    acl.forModule("auth", new BootReport()).defineRole("user", definition);
    definition.description = "changed";

    expect(acl.role("user")?.description).toBe("Signed in");
  });

  test("a bad definition is reported with the role, and reserved keys are dropped", () => {
    const acl = new Acl();
    const report = new BootReport();
    const builder = acl.forModule("auth", report);

    builder.defineRole("a", [] as never);
    builder.defineRole("b", { description: 42 } as never);
    builder.defineRole("c", { name: "other", definedBy: "billing", description: "Kept" } as never);
    builder.defineRole("Bad");
    builder.defineRole("c");

    expect(messages(report)).toEqual([
      'role "a": the definition must be a plain object',
      'role "b": description must be a string',
      'role "c": "name" is set by the ACL and cannot be defined',
      'role "c": "definedBy" is set by the ACL and cannot be defined',
      'role "Bad" is invalid — lowercase kebab-case required',
      'role "c" is already defined by module "auth"',
    ]);
    expect(acl.hasRole("a")).toBe(false);
    expect(acl.hasRole("b")).toBe(false);
    expect(acl.role("c")).toEqual({ name: "c", definedBy: "auth", description: "Kept" });
  });
});
