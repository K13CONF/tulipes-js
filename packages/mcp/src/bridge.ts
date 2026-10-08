import type { AgentManifest, AgentTool } from "@tulipes/core/agent";

/**
 * The app's agent door, as the reference app mounts it:
 *
 *   GET  <url>/tools        the manifest, filtered to the caller's role
 *   POST <url>/tools/<name> run an action
 *
 * Every request carries the same bearer token, so the app's own auth
 * module decides who is calling and its ACL what they may do — this
 * bridge adds no identity of its own.
 */
export interface BridgeOptions {
  /** The agent door, e.g. `http://localhost:3000/api/v1/agent`. */
  url: string;
  /** A bearer token the app's auth module accepts; none calls as guest. */
  token?: string;
  fetch?: typeof fetch;
}

/** The one response shape every Tulipes endpoint answers with. */
export interface Envelope<T = unknown> {
  success: boolean;
  data: T | null;
  errors: { field: string | null; message: string; code: string }[];
  meta: Record<string, unknown>;
}

export interface CallResult {
  status: number;
  envelope: Envelope;
}

export class AgentBridge {
  readonly #door: URL;
  readonly #token: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(options: BridgeOptions) {
    this.#door = new URL(options.url.replace(/\/$/, "") + "/");
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async manifest(): Promise<AgentManifest> {
    const { status, envelope } = await this.#request("GET", new URL("tools", this.#door));
    if (!envelope.success || !envelope.data) {
      throw new Error(`manifest request failed (${status}): ${describe(envelope)}`);
    }
    return envelope.data as AgentManifest;
  }

  /** Run one tool with the input an agent supplied, as the app answers it. */
  async call(tool: AgentTool, input: unknown): Promise<CallResult> {
    return this.#request("POST", new URL(`tools/${encodeURIComponent(tool.name)}`, this.#door), input ?? {});
  }

  async #request(method: string, url: URL, body?: unknown): Promise<CallResult> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await this.#fetch(url, { method, headers, ...(body !== undefined && { body: JSON.stringify(body) }) });
    const text = await response.text();
    let envelope: Envelope;
    try {
      envelope = JSON.parse(text) as Envelope;
    } catch {
      envelope = { success: false, data: null, errors: [{ field: null, message: text.slice(0, 200) || response.statusText, code: `HTTP_${response.status}` }], meta: {} };
    }
    return { status: response.status, envelope };
  }
}

export function describe(envelope: Envelope): string {
  return envelope.errors.map((error) => (error.field ? `${error.field}: ` : "") + `${error.message} (${error.code})`).join("; ") || "no detail";
}
