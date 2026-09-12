<div align="center">

<img src="https://cdn.jsdelivr.net/npm/@tulipes/core@0.7.1/assets/tulipesjs-logo.png" alt="TulipesJs" width="340">

</div>

# @tulipes/cli

The `tulipes` command line for [Tulipes](https://www.npmjs.com/package/@tulipes/core)
apps: scaffold, sync generated types, validate the environment, inspect routes,
generate OpenAPI/Postman documents, run in watch mode, add modules and upgrade.
It is separate from the runtime on purpose — a running app installs
`@tulipes/core` alone, without this package, its templates or the TypeScript
loader it carries.

```sh
npm install -g @tulipes/cli@next
tulipes init my-api            # minimal preset; --preset production for the full app
cd my-api && corepack enable && yarn install && yarn dev
```

Generated apps also list `@tulipes/cli` in `devDependencies`, so `yarn dev`,
`yarn sync`, `yarn spec` and `yarn tulipes new module <name>` work without a
global install and always match the app.

| Command | What it does |
|---|---|
| `tulipes init [dir] [--minimal \| --preset minimal \| --preset production]` | scaffold an application; no services |
| `tulipes dev [entry]` | regenerate types, then run under tsx watch |
| `tulipes sync` | regenerate `types/config.d.ts` and `.env.example` |
| `tulipes env:check` | validate the environment without booting |
| `tulipes routes [--offline \| --runtime]` | list declared endpoints |
| `tulipes spec [--offline \| --runtime] [--openapi file] [--postman file] [--url base]` | generate documents (needs `@tulipes/spec` in the app) |
| `tulipes new module <name> [--model\|--no-model] [--queues\|--no-queues] [--sockets\|--no-sockets]` | scaffold a module for the providers the app declares |
| `tulipes update` | upgrade the global CLI and, inside an app, its core and CLI ranges |
| `tulipes -v` | print the CLI version, its bundled core, and the app's core when they differ |

Every command that touches an app boots or inspects it through **the app's
own** `@tulipes/core`, so there is one copy of every framework singleton; the
bundled core is only a fallback for directories with no install. Generated
dependency ranges follow the core this CLI bundles.

## Versions

`0.1.0-rc.1` bundles core `0.10.0-rc.3` and scaffolds for it. See core's
[MIGRATING.md](https://github.com/kemora13conf/bp-backend-express/blob/master/packages/core/MIGRATING.md#unreleased--install-the-cli-package).
