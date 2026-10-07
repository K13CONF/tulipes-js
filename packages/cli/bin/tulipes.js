#!/usr/bin/env node
// Dev-phase shim: the CLI lives in TypeScript sources, which node runs as
// they are. A published build points bin at dist/ and drops this indirection.
const { main } = await import("../src/main.ts");
await main(process.argv.slice(2));
