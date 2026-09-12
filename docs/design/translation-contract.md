# Translation contract (S13)

Status: decided on 2026-09-12 against `eaaef83` (core 0.10.0-rc.2 with the
CLI split). Outcome: **retain i18next in core as an always-available
guarantee**; no provider, no extraction. S13.3 is therefore "not justified"
and S13.4 is the retained-behavior suite added with this decision.

## 1. Inventory (S13.1)

| Where | What | Kind |
|---|---|---|
| `packages/core/src/i18n/i18n.ts` | `I18n` — one i18next instance per boot (`createInstance`), `i18next-fs-backend` loading `modules/<m>/i18n/<locale>.json` per module namespace in phase 6b; `saveMissing` outside production writes `<locale>.missing.json`; `recordGaps` lists what the default locale says and a locale does not; `readSettings` validates `config.i18n` leniently (default `en`/`["en"]`) | runtime, always |
| `packages/core/src/i18n/locale.ts` | `resolveLocale`: `?lang` → `Accept-Language` (q-values, `fr-CA` → `fr`) → default, narrowed to `supportedLocales` | runtime, always |
| `packages/core/src/i18n/index.ts` | `declare global Express.Request { t: TFunction; hasTranslation; locale }`; re-exports `TFunction` and `i18n as I18nextInstance` from i18next | **public types name i18next** |
| `packages/core/src/boot/boot.ts` | `I18n` created before phase 6, filled at 6b; `ctx.t(namespace, locale?)`, `ctx.i18n` (the instance) on every `Ctx`; `rai()` binds `req.t`/`hasTranslation`/`locale` per matched module | runtime, always |
| `packages/core/src/http/error-handler.ts` | `resolve()` asks `req.hasTranslation?.(message)` **before** translating; a key becomes text via `req.t`, prose stays prose, `defaultMessage` is the untranslated fallback, `code` derives from the key or the status | runtime, depends only on the two request members being present |
| `packages/spec` | no translation use | — |
| Providers | none use translation | — |
| Reference app | `req.t` in auth/hello controllers; `ctx.t("users", job.data.locale)` in the users queue processor; settings module **edits** `i18n/<locale>.json` files directly (app code) | application |
| Presets | both ship `i18n/en.json` in at least one module; the minimal preset's `hello` module translates its greeting | application |
| Cost (fixture A, `5f787cb`) | `i18next` 521,383 B + `i18next-fs-backend` 686,356 B = 1,207,739 B, **15.9%** of the 7,578,707 B runtime install; import cost is inside the 77 ms `import_boot` | measured |

What a locale-free minimal app needs: nothing beyond the default — with no
`i18n/` directories, `I18n.load` registers no namespaces, `req.t` returns the
key, `req.hasTranslation` is false, error envelopes carry the key (or
`defaultMessage`) and a status-derived code. Verified by the suite below.

## 2. Decision (S13.2)

| Option | Cost | Benefit | Verdict |
|---|---|---|---|
| A — keep i18next always available (status quo) | 1.2 MB / 16% of the runtime install; i18next types (`TFunction`, `I18nextInstance`) in core's public declarations | one guarantee for every app: `req.t`, `ctx.t`, error envelopes, settings editing, `.missing.json` tooling all work without configuration | **selected** |
| B — `i18n` provider with a key-returning core fallback | a sixth runtime package; a core-owned translator interface replacing `TFunction` on `Request` and `Ctx` (every `req.t` caller's types change); the reference app's settings module and both presets would declare the provider — no supported journey is provider-free | 1.2 MB off a runtime install that never translates; no such preset exists | rejected |
| C — provider required, no fallback | same as B, and `req.t` could be undefined in a route, which the error handler and every controller would have to defend against | none over B | rejected |

Reasoning: every supported starter translates, so a provider would be
declared by 100% of generated apps and the fallback would serve no one. The
extraction program's aim — a core-only install that carries nothing the app
did not select — is met for infrastructure the app *may* omit (database,
queues, sockets, tooling). Translation is not optional in this framework's
contract: `HttpError` messages are i18n keys by rule 6/9 of the app
guidelines, and the error handler's key-vs-prose distinction is what makes
that rule safe. 16% of 7.6 MB is the price of a guarantee every app relies on.

The public type exposure is acknowledged and retained: `req.t` is an i18next
`TFunction` (plurals, interpolation, `returnObjects`) and `ctx.i18n` is the
documented escape hatch. Replacing them with a narrower core-owned interface
would be churn for every controller without removing the dependency.

### The guarantee, stated

1. `ctx.t`, `ctx.i18n`, `req.t`, `req.hasTranslation` and `req.locale` exist
   in every process and every request that reached a `rai()` route. They are
   never undefined and never require configuration.
2. With no translation files, `req.t(key)` returns the key (a namespaced key
   loses its unloaded prefix), `req.hasTranslation` is false, and error
   envelopes carry the key or `defaultMessage` with a code derived from the
   key (when a `defaultMessage` marks it as a key) or from the status.
3. Locales negotiate `?lang` → `Accept-Language` → `config.i18n.defaultLocale`,
   narrowed to `supportedLocales`; a locale's gap falls back to the default
   locale's text; another module's strings are reached as `module:key`.
4. Outside production, keys a locale lacks are written to
   `<locale>.missing.json` beside the file; production never writes.
5. An unsupported default locale, or a shipped locale file outside
   `supportedLocales`, is a boot refusal in the `i18n` phase.
6. Error handling never fails because translation is absent: `resolve()`
   only needs the two request members, which `rai()` always binds.

## 3. Not done (S13.3)

No extraction. Recorded as consciously deferred: if a future preset ships
without any `i18n/` directory *and* measurement shows the 1.2 MB matters to
its users, option B is the design to revisit — the interface would be
`{ t(key, vars), exists(key), locale }` bound per request, with i18next
supplying it as the first provider.

## 4. Retained behavior (S13.4)

`packages/core/tests/i18n.test.ts` (4 tests, no services):

| Scenario | Asserted |
|---|---|
| No translation files anywhere | no namespaces; default settings; `ctx.t` returns keys; `req.t` returns the key, `hasTranslation` false, `?lang=fr` narrows to `en`; `HttpError(404, "notFound")` → `{ message: "notFound", code: "NOT_FOUND" }`; a key with `defaultMessage` → fallback prose with a key-derived code |
| Two locales, two modules | `?lang=fr` and `Accept-Language: fr-CA;q=0.9, de;q=1` resolve `fr`, `?lang=de` falls to `en`; interpolation; `other:title` cross-namespace; `fr` lacking `notFound` answers with the default locale's text and `NOT_FOUND` |
| Missing-key files | development boot writes `fr.missing.json` with the default locale's text; production boot writes nothing |
| Invalid settings | default locale outside the supported set → boot refused in the `i18n` phase |

Offline tooling never initializes translations (`inspectRoutes` builds no
`I18n`), unchanged since Sprint 02; core's emitted declarations name i18next
by design (§2), and no provider type leaks — there is no provider.
