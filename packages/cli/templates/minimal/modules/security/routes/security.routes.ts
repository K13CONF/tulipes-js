import express from "express";
import helmet from "helmet";
import { defineRoutes } from "@tulipes/core/http";
export default defineRoutes(({ app }) => {
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
});
