import { z } from "zod/v4";

/** Validated by rai(), and described in the generated spec. */
export const variableName = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "invalidVariableName"),
});

export const variableValue = z.object({
  // Always a string: it is coerced against the variable's own declared
  // type afterwards, which is the only place that knows what it should be.
  value: z.string("valueRequired"),
});

export const revealQuery = z.object({
  reveal: z.enum(["true", "false"]).optional(),
});

export const localeParams = z.object({
  module: z.string().regex(/^[a-z][a-z0-9-]*$/, "invalidModuleName"),
  locale: z.string().regex(/^[a-z]{2}(-[A-Za-z0-9]+)?$/, "invalidLocale"),
});

export const translationsBody = z.object({
  translations: z.record(z.string(), z.unknown()),
});

export const rebootBody = z.object({
  /** Empty or absent restarts every process PM2 runs for this app. */
  targets: z.array(z.string()).optional(),
});

export const logQuery = z.object({
  process: z.enum(["backend", "worker"]).optional(),
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  tail: z.coerce.number().int().min(0).max(1000).optional(),
});
