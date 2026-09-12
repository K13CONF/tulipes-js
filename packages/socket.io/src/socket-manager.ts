import type { Server as HttpServer } from "node:http";
import { Server, type Namespace, type ServerOptions } from "socket.io";

import type { SocketsCapability } from "@tulipes/core/boot";
import type { BootReport } from "@tulipes/core/errors";

/**
 * What `ctx.sockets` is once this provider is in the compilation. Core's
 * SocketsCapability is empty; an app that imports anything from this package
 * (its socket files do, for SocketRegistry) sees these members typed.
 */
declare module "@tulipes/core/boot" {
  interface SocketsCapability {
    readonly io: Server;
    of(name: string): Namespace;
    namespaces(): string[];
  }
}

/**
 * Wraps the process-wide Socket.IO server (backend branch only). Created
 * unattached during provider acquisition so modules can claim namespaces;
 * core hands it the HTTP server through attach() just before listen().
 *
 * Namespaces are the socket-side equivalent of route prefixes, and get the
 * same ownership rule as everything else in Tulipes: a module claims its
 * namespace ("/users") exactly once, and emitting into a namespace nobody
 * claimed throws instead of silently broadcasting to nothing.
 */
export class SocketManager implements SocketsCapability {
  readonly #io: Server;
  /** namespace name → owning module */
  readonly #namespaces = new Map<string, string>();

  constructor(options?: Partial<ServerOptions>) {
    this.#io = new Server(options);
  }

  /** Bind to the server that will accept the upgrades; once, before it listens. */
  attach(httpServer: HttpServer): void {
    this.#io.attach(httpServer);
  }

  /** Escape hatch for advanced use — prefer `of()` for claimed namespaces. */
  get io(): Server {
    return this.#io;
  }

  /** Emit-side accessor, fail-closed on unclaimed namespaces. */
  of(name: string): Namespace {
    if (!this.#namespaces.has(name)) {
      throw new Error(
        `Socket namespace "${name}" was never claimed by any module (known: ${[...this.#namespaces.keys()].join(", ") || "none"})`,
      );
    }
    return this.#io.of(name);
  }

  /** Claimed namespace names — for the startup banner and tooling. */
  namespaces(): string[] {
    return [...this.#namespaces.keys()];
  }

  /** @internal Module-scoped facade for the loader. */
  forModule(moduleName: string, report: BootReport): SocketRegistry {
    return new SocketRegistry(this, moduleName, report);
  }

  /** @internal SocketRegistry only. */
  claim_(name: string, owner: string): string | undefined {
    const existing = this.#namespaces.get(name);
    if (existing) return existing;
    this.#namespaces.set(name, owner);
    return undefined;
  }

  /**
   * Close namespace clients and the underlying Engine.IO transports.
   * This also closes HTTP; boot starts and awaits HTTP draining alongside it.
   */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.#io.close(() => resolve());
    });
  }
}

/** "/", or "/name" — lowercase kebab-case. */
const NAMESPACE = /^\/([a-z0-9-]+)?$/;

export class SocketRegistry {
  readonly #manager: SocketManager;
  readonly #module: string;
  readonly #report: BootReport;

  constructor(manager: SocketManager, moduleName: string, report: BootReport) {
    this.#manager = manager;
    this.#module = moduleName;
    this.#report = report;
  }

  /**
   * Claim a namespace and wire it up. The setup callback receives the live
   * Namespace — attach middleware and connection handlers there.
   */
  namespace(name: string, setup: (nsp: Namespace) => void): this {
    if (!NAMESPACE.test(name)) {
      this.#issue(`namespace "${name}" is invalid — expected "/" or "/kebab-case-name"`);
      return this;
    }
    const owner = this.#manager.claim_(name, this.#module);
    if (owner) {
      this.#issue(`namespace "${name}" is already claimed by module "${owner}"`);
      return this;
    }
    setup(this.#manager.io.of(name));
    return this;
  }

  #issue(message: string): void {
    this.#report.add({ scope: "boot", module: this.#module, message });
  }
}
