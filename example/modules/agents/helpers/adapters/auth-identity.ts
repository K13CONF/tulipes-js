import { isTokenLive } from "@app/auth";
import type { ToolActor } from "@tulipes/core/agent";
import { requireModels, type Ctx } from "@tulipes/core/boot";

import type { Identity, RunActor } from "../harness/contracts.ts";

/**
 * Who a run acts as, now. The user is read again at every step, so the
 * role is the one they hold now, as in the MCP process; a run started by
 * an API token stops when that token is revoked, expires or is retired by
 * a password change. The scopes are the snapshot taken when the run was
 * created: they only ever narrow.
 */
export class AuthIdentity implements Identity {
  readonly #ctx: Ctx;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
  }

  async resolve(actor: RunActor): Promise<ToolActor | null> {
    const users = requireModels(this.#ctx).get("User");
    const user = await users.findById(actor.userId);
    if (!user) return null;
    if (actor.tokenId && !(await isTokenLive(this.#ctx, actor.tokenId, actor.userId))) return null;
    return {
      isAuthenticated: true,
      // The auth module types its User document as core's AuthUser; the
      // model store's generic document is that same object.
      user: user as unknown as ToolActor["user"],
      session: null,
      role: String((user as { role?: unknown }).role),
      ...(actor.scopes && { scopes: actor.scopes }),
      ...(actor.tokenId && { credentialId: actor.tokenId }),
    };
  }
}
