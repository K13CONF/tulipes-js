<div align="center">

<img src="assets/tulipesjs-logo.png" alt="TulipesJs" width="440">

**The Express framework that refuses to start when something is wrong.**

[![npm](https://img.shields.io/npm/v/@tulipes/core?color=%23cb3837&label=%40tulipes%2Fcore)](https://www.npmjs.com/package/@tulipes/core)
[![npm](https://img.shields.io/npm/v/@tulipes/spec?color=%23cb3837&label=%40tulipes%2Fspec)](https://www.npmjs.com/package/@tulipes/spec)

</div>

---

This is the Tulipes monorepo — the framework, its spec generator, and the
reference app they are developed against.

| | |
|---|---|
| [`packages/core`](./packages/core) | `@tulipes/core` — the framework and the `tulipes` CLI |
| [`packages/spec`](./packages/spec) | `@tulipes/spec` — OpenAPI 3.1 and Postman from a booted app's routes |
| [`example`](./example) | the reference application: six modules, exercising every contract |

Start with **[packages/core/README.md](./packages/core/README.md)** — that is
the documentation. This file only says where things live.

## Working in here

```sh
corepack enable          # once per machine — activates the pinned yarn 4
yarn install
yarn typecheck           # every public workspace
yarn example             # boot the reference app (needs MongoDB and Redis)
```

The example is not a demo kept alive by hand: CI scaffolds a fresh app with
`tulipes init` and diffs its `modules/` against `example/modules/`, so the
two cannot drift.

## Releasing

Bump `packages/core/package.json`, then push a matching tag:

```sh
git tag v0.7.1 && git push origin v0.7.1
```

The publish workflow refuses a tag that disagrees with the package version,
and publishes `@tulipes/spec` only when its own version has moved.

---

<div align="center">
<sub>Built by <b>k13.conf</b></sub>
</div>
