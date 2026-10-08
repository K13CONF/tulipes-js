import { requireModels, type Ctx } from "@tulipes/core/boot";

/**
 * One query, two callers: the list route pages it, the agent action reads
 * the first page. Logic a route and an action share lives here, so neither
 * calls the other.
 */
export function findGreetings(ctx: Ctx, { skip = 0, limit = 20 } = {}) {
  const Greeting = requireModels(ctx).get("Greeting");
  return Promise.all([
    Greeting.find().select("name message times_used -_id").skip(skip).limit(limit).lean(),
    Greeting.countDocuments(),
  ]);
}
