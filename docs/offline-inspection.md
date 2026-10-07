# Inspection

`tulipes routes` and `tulipes spec` boot the application in **inspection**:
the normal boot with nothing acquired. Every `routes/*.routes.ts` runs
through the same loader and the same scan as a serving process, so what the
tools describe is exactly what is mounted; what differs is the context the
routes files receive:

| | serving | inspection |
|---|---|---|
| `ctx.Environment` | resolved and validated | declared and validated, every read throws |
| `ctx.models`, `ctx.queues`, `ctx.sockets` | the declared providers | stubs that throw on use (undefined when not declared) |
| `ctx.config.<module>` | the settings store | each schema's defaults, in memory |
| bootstrap | runs | skipped |
| listener, transports | yes | no |

The consequence is a rule a routes file already follows when it is written
well: build the router from the context and use infrastructure inside
handlers. A controller keeps `ctx` and reads `ctx.models` when a request
arrives; a middleware that needs a variable or a client is built on its
first request (`lazy()` in the reference app's core module). A file that
reads a variable or a model while building fails inspection with its path
and the reason, which is the right outcome: it would have coupled routing
to a service.

```sh
tulipes routes
tulipes spec --openapi docs/openapi.json --postman docs/collection.json
tulipes spec --openapi docs/openapi.json --url https://api.example.com
```

Programmatically, `boot({ rootDir, mode: "backend", inspect: true })` returns
the same handle a serving boot does, with `ctx.routes.all()`, `ctx.acl` and
`ctx.config` filled; the reference app's tests compare the inspection's
documents with the running app's. Provider declarations (`tulipes.providers`
in the root manifest, `requires` in module manifests) are validated for
consistency, but no provider is resolved or imported, so an uninstalled
provider is not an inspection error. A custom access checker installed while
building is reported as dynamic: generated documents make no static role or
public-access claim for it.

Before 0.11 inspection was an opt-in path (`tulipes.offline`,
`defineRoutes()`, `runtime()`, `--offline`); those forms are refused by name
and the migration guide says what replaces each.
