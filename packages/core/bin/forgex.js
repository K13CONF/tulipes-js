#!/usr/bin/env node
// Dev-phase shim: the CLI lives in TypeScript sources, so route through
// tsx's programmatic loader. A published build will point bin at dist/ and
// drop this indirection.
import { tsImport } from "tsx/esm/api";

const { main } = await tsImport("../src/cli/main.ts", import.meta.url);
await main(process.argv.slice(2));
