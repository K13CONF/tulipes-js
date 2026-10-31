import type { RuntimeCtx } from "@tulipes/core/boot";

import { configureListQueries } from "../helpers/query/index.ts";

/**
 * The list-query defaults, set once for the whole app from
 * config.pagination, so a controller calls toMongoose(query, req.page)
 * and only passes an option when it means something different.
 */
export default function listQueries(ctx: RuntimeCtx): void {
  configureListQueries({ maxTimeMS: ctx.config.pagination?.maxTimeMs });
}
