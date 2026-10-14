import { expectTypeOf, test } from "vitest";
import { z } from "zod4";
import { z as z3 } from "zod/v4";

import { defineConfig } from "../src/config/define-config.ts";

/**
 * Regression for TS2589: a module whose own zod is 4.x declared settings and
 * TypeScript gave up comparing the two copies' internals. Both copies must
 * declare, flat and nested, with `onChange` typed from the schema's output.
 */
test("a settings schema from zod 4.x declares, flat and nested, with a typed onChange", () => {
  const flat = defineConfig({ schema: z.object({ ceiling: z.number().int().default(5) }) });
  const nested = defineConfig({
    schema: z.object({ limits: z.object({ daily: z.number().default(10), burst: z.number().default(2) }) }),
    onChange(next) {
      expectTypeOf(next.limits.daily).toBeNumber();
    },
  });
  const own = defineConfig({ schema: z3.object({ greeting: z3.string().default("Hello") }) });

  expectTypeOf(flat.schema._zod.output).toEqualTypeOf<{ ceiling: number }>();
  expectTypeOf(nested.schema._zod.output.limits).toEqualTypeOf<{ daily: number; burst: number }>();
  expectTypeOf(own.schema._zod.output).toEqualTypeOf<{ greeting: string }>();
});
