#!/usr/bin/env node
// Published bin entry — compiled to dist/cli/bin.js. The dev workspace uses
// bin/tulipes.js (a tsx shim over the same main) instead; publishConfig.bin
// swaps this one in at pack time.
import { main } from "./main.js";

await main(process.argv.slice(2));
