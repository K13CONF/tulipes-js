import type { Server as HttpServer } from "node:http";
import { Server, type Namespace, type ServerOptions } from "socket.io";

import { BootReport } from "../errors/boot-error.js";

/**
 * Wraps the process-wide Socket.IO server (backend branch only, phase 11b).
 *
 * Namespaces are the socket-side equivalent of route prefixes, and get the
 * same ownership rule as everything else in Tulipes: a module claims its
 * namespace ("/users") exactly once, and emitting into a namespace nobody
 * claimed throws instead of silently broadcasting to nothing.
 */
export class SocketManager {
  readonly #io: Server;
  /** namespace name → owning module */
  readonly #namespaces = new Map<string, string>();

  constructor(httpServer: HttpServer, options?: Partial<ServerOptions>) {
    this.#io = new Server(httpServer, options);
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
   * Disconnects every client. Deliberately NOT io.close() — that would also
   * close the attached http server, whose lifecycle belongs to boot.
   */
  close(): void {
    this.#io.disconnectSockets(true);
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
