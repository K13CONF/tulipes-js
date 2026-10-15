import type { ToolActor } from "@tulipes/core/agent";
import type { RuntimeCtx } from "@tulipes/core/boot";
import { HttpError, ValidationError } from "@tulipes/core/http";

import type { ToolCatalog, ToolOutcome, ToolSource } from "../harness/contracts.ts";

/**
 * The app's actions as the harness's tools: `ctx.agent.manifest(actor)` for
 * what the actor may call — already filtered by role and scopes, so the
 * model is never shown a tool it will be refused — and `invoke()` for the
 * call, through the same gate as a route. The harness adds no authority.
 */
export class RegistryToolSource implements ToolSource {
  readonly #ctx: RuntimeCtx;
  readonly #onError: (error: unknown, tool: string) => void;

  /** `onError`: where an unexpected failure is reported; the model only learns that it failed. */
  constructor(ctx: RuntimeCtx, onError: (error: unknown, tool: string) => void) {
    this.#ctx = ctx;
    this.#onError = onError;
  }

  async catalog(actor: ToolActor): Promise<ToolCatalog> {
    const manifest = this.#ctx.agent.manifest(actor);
    return {
      modules: manifest.modules.flatMap((module) => (module.summary ? [{ name: module.name, summary: module.summary }] : [])),
      tools: manifest.tools
        .map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema, readOnly: tool.read_only }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    };
  }

  async call(name: string, input: unknown, actor: ToolActor): Promise<ToolOutcome> {
    try {
      return { ok: true, data: await this.#ctx.agent.invoke(name, input, actor) };
    } catch (error) {
      if (error instanceof ValidationError) {
        const issues = error.issues.map((issue) => `${issue.field ?? "input"}: ${issue.message}`).join("; ");
        return { ok: false, message: `422: the input was rejected — ${issues}. Correct these fields and call again.` };
      }
      if (error instanceof HttpError) return { ok: false, message: refusal(error) };
      this.#onError(error, name);
      throw error;
    }
  }
}

/** What the model reads for a refusal: the status, the reason, and what it means for the next step. */
function refusal(error: HttpError): string {
  const reason = error.defaultMessage ?? error.message;
  const code = error.code ? ` (${error.code})` : "";
  const next: Record<number, string> = {
    401: "The run is no longer signed in; finish with run_finish.",
    403: "This run may not do this; do not retry it — find another way or finish as blocked.",
    404: "It does not exist; check the name or id with a read-only tool.",
  };
  return `${error.status}: ${reason}${code}.${next[error.status] ? ` ${next[error.status]}` : ""}`;
}
