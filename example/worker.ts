import { boot } from "@tulipes/core/boot";

// Worker mode refuses to start until at least one module registers a
// queue processor — a consumer with nothing to consume is a
// misconfigured deployment, not a valid idle state.
await boot({ rootDir: import.meta.dirname, mode: "worker" });
