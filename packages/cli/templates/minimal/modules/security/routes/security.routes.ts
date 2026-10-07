import express from "express";
import helmet from "helmet";
import type { BackendCtx } from "@tulipes/core/boot";
export default function securityRoutes({ app }: BackendCtx): void {
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
}
