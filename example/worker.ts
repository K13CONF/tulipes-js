import { boot } from "@tulipes/core/boot";

await boot({ rootDir: import.meta.dirname, mode: "worker" });
