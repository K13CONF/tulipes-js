---
name: tulipes-i18n
description: Use when writing any user-facing string in a Tulipes app — an error message, a response body, an email subject — or when adding a locale, translating a module, or working out why an endpoint answers in the wrong language. Covers req.t, ctx.t, module namespaces and the missing-key files.
---

# Translating

Every user-facing string is a key. A module is a namespace, and it owns
its strings:

```
modules/users/i18n/
  en.json          the default locale — must be complete
  fr.json          gaps fall back to en
  fr.missing.json  generated; never edit, never commit
```

## In an endpoint

`req.t` is already bound to the module that declared the route, because
`rai()` binds it. Nothing to import, nothing to pass:

```ts
res.json({ message: req.t("created", { email }) });
throw new HttpError(404, req.t("notFound"));
```

with `modules/users/i18n/en.json`:

```json
{
  "created": "User {{email}} created",
  "notFound": "No such user",
  "list": { "count_one": "{{count}} user", "count_other": "{{count}} users" }
}
```

- **Nesting** is a `.` in the key: `req.t("list.count", { count })`.
- **Plurals** come from `count` — i18next picks `_one` / `_other` (and the
  categories a language actually has) so no handler writes a ternary.
- **Another module's strings**: name the namespace, `req.t("auth:invalid")`.
  Rare, and worth a second thought — a string two modules need usually
  belongs to whichever one owns the concept.
- `req.locale` is the negotiated locale, if you need it in a payload.

## Outside a request

A queue processor, script or bootstrap task has no request to negotiate
from, so it names both the namespace and the locale:

```ts
const t = ctx.t("users", recipient.locale);
await sendMail(t("welcome.subject", { name }));
```

Which means the locale has to travel with the work — put it in the job
payload when you enqueue, since the worker cannot recover it later:

```ts
await ctx.queues!.add("users.welcome", "welcome", { email, locale: req.locale });
```

`ctx.i18n` is the i18next instance underneath, for anything else.

## How a locale is chosen

1. `?lang=fr` — an explicit override, so a locale is testable with curl
   and survives a shared link
2. `Accept-Language`, q-values honoured
3. `config.i18n.defaultLocale`

Every candidate is narrowed to `config.i18n.supportedLocales`, so an
unsupported `?lang=xx` falls through rather than serving raw keys. A
region the app does not ship resolves to its base language: `fr-CA` is
served by `fr` unless `fr-CA.json` exists.

## Adding a locale

1. Add it to `supportedLocales` in `config/app.config.ts`.
2. Boot. Every module now has `<locale>.missing.json` listing everything
   it needs, with the English text as the value.
3. Translate into `<locale>.json`, delete nothing — the missing file
   disappears on the next boot once the gaps are gone.

## Rules

- **Never concatenate a translated string.** Put the variable in the key:
  `"Welcome, {{name}}"`, not `t("welcome") + name`. Word order differs
  between languages, and the concatenation is untranslatable.
- **Only `en.json` (the default locale) must be complete.** A missing key
  in another locale falls back to it — a feature can ship before its
  translations do.
- **`*.missing.json` is generated.** It is git-ignored, rewritten on every
  non-production boot, and never written in production.
- Invalid JSON in a locale file, or an `i18n/` folder with no
  default-locale file, aborts the boot — i18next would otherwise serve raw
  keys with nothing in the log to explain it.
- A module with no `i18n/` folder is fine; it simply has nothing to say.
