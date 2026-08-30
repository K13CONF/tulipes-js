import { boot } from "@tulipes/core/boot";
import { registerBasePlugins } from "./lib/mongoose/index.js";

// Global schema plugins must exist before any model compiles (phase 8).
registerBasePlugins();

await boot({ rootDir: import.meta.dirname, mode: "backend" });
