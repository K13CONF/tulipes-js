#!/usr/bin/env node
// Published bin entry — compiled to dist/bin.js. The dev workspace runs
// this source through node's native type stripping instead; publishConfig.bin
// swaps the compiled one in at pack time.
import { main } from "./main.ts";

await main(process.argv.slice(2));
