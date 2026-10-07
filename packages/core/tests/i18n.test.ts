import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { fixture, url } from "./fixture.ts";

/**
 * S13.4 — the translation guarantee core keeps: `req.t`, `req.hasTranslation`,
 * `req.locale` and `ctx.t` exist in every app, error envelopes never depend
 * on a translation existing, locales negotiate within what the app ships, and
 * gaps fall back to the default locale.
 */

const acl = `export default acl => acl.defineRole('guest').allow('guest', 'probe:say').allow('guest', 'probe:fail').allow('guest', 'probe:prose');`;
const routes = `
  import { Router } from 'express';
  import { HttpError } from '@tulipes/core/http';
  export default ctx => {
    const r = Router();
    r.get('/say', ctx.rai({ id: 'probe:say' }), (req, res) => {
      res.respond({ data: { locale: req.locale, text: req.t('greeting', { name: 'Ada' }), known: req.hasTranslation('greeting'), other: req.t('other:title') } });
    });
    r.get('/fail', ctx.rai({ id: 'probe:fail' }), () => { throw new HttpError(404, 'notFound'); });
    r.get('/prose', ctx.rai({ id: 'probe:prose' }), () => { throw new HttpError(400, 'badInput', { defaultMessage: 'The input could not be used' }); });
    return r;
  };
`;
const get = async (handle: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["boot"]>>, path: string, headers: Record<string, string> = {}) => {
  const response = await fetch(url(handle) + path, { headers });
  return { status: response.status, body: await response.json() as { data?: Record<string, unknown>; errors?: { field: string | null; message: string; code: string }[] } };
};

test("an app with no translation files still translates: keys come back as keys and errors keep their envelope", async () => {
  const app = await fixture({ "modules/probe/module.acl.js": acl, "modules/probe/routes/probe.routes.js": routes });
  const handle = await app.boot();

  expect(handle.i18n.namespaces).toEqual([]);
  expect(handle.i18n.settings).toEqual({ defaultLocale: "en", supportedLocales: ["en"] });
  expect(handle.ctx.t("probe")("greeting")).toBe("greeting");

  const say = await get(handle, "/say?lang=fr");
  // i18next hands back the key — minus a namespace prefix it never loaded.
  expect(say.body.data).toEqual({ locale: "en", text: "greeting", known: false, other: "title" });

  const fail = await get(handle, "/fail");
  expect(fail.status).toBe(404);
  // No translation anywhere: the key is the message and the code derives from the status.
  expect(fail.body.errors).toEqual([{ field: null, message: "notFound", code: "NOT_FOUND" }]);

  // A key with a defaultMessage: the code still derives from the key, the text is the fallback prose.
  const prose = await get(handle, "/prose");
  expect(prose.body.errors).toEqual([{ field: null, message: "The input could not be used", code: "BAD_INPUT" }]);
});

test("locales negotiate within the shipped set, gaps fall back to the default and other namespaces are addressable", async () => {
  const app = await fixture({
    "config/app.config.js": `export default () => ({ i18n: { defaultLocale: 'en', supportedLocales: ['en', 'fr'] } });`,
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes,
    "modules/probe/i18n/en.json": JSON.stringify({ greeting: "Hello {{name}}", notFound: "Nothing here" }),
    "modules/probe/i18n/fr.json": JSON.stringify({ greeting: "Bonjour {{name}}" }),
    "modules/other/package.json": JSON.stringify({ name: "@test/other", type: "module" }),
    "modules/other/i18n/en.json": JSON.stringify({ title: "Other module" }),
    "modules/other/i18n/fr.json": JSON.stringify({ title: "Autre module" }),
  });
  const handle = await app.boot();

  expect([...handle.i18n.namespaces].sort()).toEqual(["other", "probe"]);

  expect((await get(handle, "/say")).body.data).toEqual({ locale: "en", text: "Hello Ada", known: true, other: "Other module" });
  expect((await get(handle, "/say?lang=fr")).body.data).toEqual({ locale: "fr", text: "Bonjour Ada", known: true, other: "Autre module" });
  expect((await get(handle, "/say", { "accept-language": "fr-CA;q=0.9, de;q=1" })).body.data).toMatchObject({ locale: "fr" });
  expect((await get(handle, "/say?lang=de")).body.data).toMatchObject({ locale: "en" });

  // fr has no notFound: the default locale answers, and the code comes from the key.
  const fail = await get(handle, "/fail?lang=fr");
  expect(fail.body.errors).toEqual([{ field: null, message: "Nothing here", code: "NOT_FOUND" }]);

  expect(handle.ctx.t("probe", "fr")("greeting", { name: "Bob" })).toBe("Bonjour Bob");
});

test("outside production, a locale's gaps are written next to its file; production never writes", async () => {
  const files = {
    "config/app.config.js": `export default () => ({ i18n: { defaultLocale: 'en', supportedLocales: ['en', 'fr'] } });`,
    "modules/probe/module.acl.js": acl,
    "modules/probe/routes/probe.routes.js": routes,
    "modules/probe/i18n/en.json": JSON.stringify({ greeting: "Hello {{name}}", notFound: "Nothing here" }),
    "modules/probe/i18n/fr.json": JSON.stringify({ greeting: "Bonjour {{name}}" }),
  };

  const dev = await fixture(files);
  await dev.boot({ appEnv: "development" });
  const gaps = JSON.parse(await readFile(dev.rootDir + "/modules/probe/i18n/fr.missing.json", "utf8")) as Record<string, string>;
  expect(gaps).toEqual({ notFound: "Nothing here" });

  const prod = await fixture(files);
  await prod.boot();
  await expect(readFile(prod.rootDir + "/modules/probe/i18n/fr.missing.json", "utf8")).rejects.toThrow();
});

test("an unsupported default locale or a locale file the app does not ship is refused at boot", async () => {
  const app = await fixture({
    "config/app.config.js": `export default () => ({ i18n: { defaultLocale: 'de', supportedLocales: ['en'] } });`,
    "modules/probe/i18n/en.json": "{}",
  });

  await expect(app.boot({ mode: "script" })).rejects.toThrow(/Boot aborted during "i18n"/);
});
