import { expect, test } from "vitest";
import { BootReport } from "../src/errors/boot-error.ts";
import {
  Timezones,
  canonicalTimezone,
  formatDate,
  offsetMinutes,
  startOfDay,
  toZonedISO,
  zonedTimeToUtc,
} from "../src/time/index.ts";
import { fixture, url } from "./fixture.ts";

/**
 * 0.12-S06 — time zones: instants stay UTC on the wire, `config.timezone`
 * names the app's zone, a request negotiates its own like a locale, and the
 * process follows the app's zone for the life of the boot.
 */

const acl = `export default acl => acl.defineRole('guest').allow('guest', 'probe:web:now');`;
const routes = `
  import { Router } from 'express';
  export default ctx => {
    const r = Router();
    r.get('/now', ctx.rai({ id: 'probe:web:now' }), (req, res) => {
      const instant = new Date('2026-07-01T12:00:00.000Z');
      res.respond({ data: {
        timezone: req.timezone,
        local: req.time.toISO(instant),
        midnight: req.time.startOfDay(instant).toISOString(),
        utc: instant,
        app: ctx.time.zone,
      } });
    });
    return r;
  };
`;
const app = (config?: string) => fixture({
  ...(config && { "config/app.config.js": `export default () => (${config});` }),
  "modules/probe/module.acl.js": acl,
  "modules/probe/routes/probe.routes.js": routes,
});
type Handle = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["boot"]>>;
const now = async (handle: Handle, query = "", headers: Record<string, string> = {}) => {
  const response = await fetch(url(handle) + "/now" + query, { headers });
  return (await response.json() as { data: Record<string, string> }).data;
};

test("offsets, zoned ISO strings and local midnight follow daylight saving", () => {
  const winter = new Date("2026-01-15T12:00:00.000Z");
  const summer = new Date("2026-07-15T12:00:00.000Z");

  expect(offsetMinutes(winter, "Europe/Paris")).toBe(60);
  expect(offsetMinutes(summer, "Europe/Paris")).toBe(120);
  expect(offsetMinutes(winter, "America/New_York")).toBe(-300);
  expect(offsetMinutes(winter, "Asia/Kolkata")).toBe(330);
  expect(offsetMinutes(winter, "UTC")).toBe(0);

  expect(toZonedISO(summer, "Europe/Paris")).toBe("2026-07-15T14:00:00.000+02:00");
  expect(toZonedISO(winter, "America/New_York")).toBe("2026-01-15T07:00:00.000-05:00");
  expect(toZonedISO(new Date("2026-01-15T12:00:00.123Z"), "UTC")).toBe("2026-01-15T12:00:00.123+00:00");
  // The same instant, whatever the zone it is written in.
  expect(new Date(toZonedISO(summer, "Asia/Tokyo")).getTime()).toBe(summer.getTime());

  // 23:30 UTC is already the next day in Paris; its midnight is 22:00 UTC.
  expect(startOfDay(new Date("2026-07-15T23:30:00.000Z"), "Europe/Paris").toISOString()).toBe("2026-07-15T22:00:00.000Z");
  expect(startOfDay(new Date("2026-07-15T03:00:00.000Z"), "America/New_York").toISOString()).toBe("2026-07-14T04:00:00.000Z");
});

test("a wall-clock time resolves to one instant across a daylight-saving jump", () => {
  expect(zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 9 }, "Europe/Paris").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  // 02:30 on 29 March does not exist in Paris: it resolves forward, to 03:30 CEST.
  expect(zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, "Europe/Paris").toISOString()).toBe("2026-03-29T01:30:00.000Z");
  // 02:30 on 25 October happens twice: the first, still CEST.
  expect(zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, "Europe/Paris").toISOString()).toBe("2026-10-25T00:30:00.000Z");
});

test("formatting reads the instant in the zone and the locale", () => {
  const instant = new Date("2026-07-15T12:00:00.000Z");
  expect(formatDate(instant, "Asia/Tokyo", { locale: "en-US", hour: "numeric", minute: "2-digit", hour12: false })).toBe("21:00");
  expect(formatDate(instant, "Europe/Paris", { locale: "fr", dateStyle: "long" })).toBe("15 juillet 2026");
  expect(() => toZonedISO("not a date", "UTC")).toThrow(RangeError);
});

test("zone names are canonicalised and unknown ones refused", () => {
  expect(canonicalTimezone("europe/paris")).toBe("Europe/Paris");
  expect(canonicalTimezone("UTC")).toBe("UTC");
  expect(canonicalTimezone("Mars/Olympus")).toBeUndefined();
  expect(canonicalTimezone("  ")).toBeUndefined();

  const report = new BootReport();
  expect(Timezones.readSettings(undefined, report)).toEqual({ default: "UTC", applyToProcess: false });
  expect(Timezones.readSettings({ default: "africa/casablanca" }, report)).toEqual({ default: "Africa/Casablanca", applyToProcess: true });
  expect(Timezones.readSettings({ default: "UTC", supported: ["UTC", "europe/paris"], applyToProcess: false }, report))
    .toEqual({ default: "UTC", supported: ["UTC", "Europe/Paris"], applyToProcess: false });
  expect(report.issues).toEqual([]);

  const bad = new BootReport();
  Timezones.readSettings({ default: "Mars/Olympus" }, bad);
  Timezones.readSettings({ default: "UTC", supported: ["Europe/Paris"] }, bad);
  Timezones.readSettings({ default: "UTC", supported: [] }, bad);
  Timezones.readSettings({ default: "UTC", applyToProcess: "yes" }, bad);
  expect(bad.issues.map((issue) => issue.message)).toEqual([
    expect.stringContaining('"Mars/Olympus" is not a time zone'),
    expect.stringContaining('default "UTC" is not in supported (Europe/Paris)'),
    "config.timezone.supported is empty",
    "config.timezone.applyToProcess must be true or false",
  ]);
});

test("with no timezone block a request reads UTC unless it asks, and the process zone is untouched", async () => {
  const before = process.env.TZ;
  const handle = await (await app()).boot();

  expect(handle.timezones.settings).toEqual({ default: "UTC", applyToProcess: false });
  expect(process.env.TZ).toBe(before);

  expect(await now(handle)).toEqual({
    timezone: "UTC",
    local: "2026-07-01T12:00:00.000+00:00",
    midnight: "2026-07-01T00:00:00.000Z",
    // Dates on the wire stay UTC whatever the caller's zone.
    utc: "2026-07-01T12:00:00.000Z",
    app: "UTC",
  });
  expect(await now(handle, "?tz=Europe/Paris")).toMatchObject({ timezone: "Europe/Paris", local: "2026-07-01T14:00:00.000+02:00", midnight: "2026-06-30T22:00:00.000Z", utc: "2026-07-01T12:00:00.000Z" });
  expect(await now(handle, "", { "X-Timezone": "america/new_york" })).toMatchObject({ timezone: "America/New_York", local: "2026-07-01T08:00:00.000-04:00" });
  // The query wins over the header; an unknown zone falls through to the next candidate.
  expect((await now(handle, "?tz=Asia/Tokyo", { "X-Timezone": "Europe/Paris" })).timezone).toBe("Asia/Tokyo");
  expect((await now(handle, "?tz=Mars/Olympus", { "X-Timezone": "Europe/Paris" })).timezone).toBe("Europe/Paris");
  expect((await now(handle, "?tz=Mars/Olympus")).timezone).toBe("UTC");
});

test("a configured zone is the app's and the process's for the life of the boot, and a request is narrowed to the supported list", async () => {
  const before = process.env.TZ;
  const handle = await (await app(`{ i18n: { defaultLocale: 'fr', supportedLocales: ['fr'] }, timezone: { default: 'Asia/Tokyo', supported: ['Asia/Tokyo', 'Europe/Paris'] } }`)).boot();

  expect(process.env.TZ).toBe("Asia/Tokyo");
  expect(new Date("2026-07-01T00:00:00.000Z").getHours()).toBe(9);
  expect(handle.ctx.time.zone).toBe("Asia/Tokyo");
  expect(handle.ctx.time.toISO(new Date("2026-07-01T00:00:00.000Z"))).toBe("2026-07-01T09:00:00.000+09:00");
  expect(handle.ctx.time.in("Europe/Paris").zone).toBe("Europe/Paris");
  // Formatting with no locale reads in the app's default locale, not the machine's.
  expect(handle.ctx.time.format(new Date("2026-07-01T00:00:00.000Z"), { dateStyle: "long" })).toBe("1 juillet 2026");
  // An unknown zone handed to ctx.time.in reads in the app's.
  expect(handle.ctx.time.in("Mars/Olympus").zone).toBe("Asia/Tokyo");

  expect(await now(handle)).toMatchObject({ timezone: "Asia/Tokyo", local: "2026-07-01T21:00:00.000+09:00", app: "Asia/Tokyo" });
  expect((await now(handle, "?tz=Europe/Paris")).timezone).toBe("Europe/Paris");
  expect((await now(handle, "?tz=America/New_York")).timezone).toBe("Asia/Tokyo");

  await handle.shutdown();
  expect(process.env.TZ).toBe(before);
});

test("applyToProcess: false keeps the process zone; inspection never moves it", async () => {
  const before = process.env.TZ;
  const kept = await (await app(`{ timezone: { default: 'Asia/Tokyo', applyToProcess: false } }`)).boot();
  expect(process.env.TZ).toBe(before);
  expect(kept.ctx.time.zone).toBe("Asia/Tokyo");
  await kept.shutdown();

  const inspected = await (await app(`{ timezone: { default: 'Asia/Tokyo' } }`)).boot({ inspect: true });
  expect(process.env.TZ).toBe(before);
  expect(inspected.ctx.time.zone).toBe("Asia/Tokyo");
});

test("an unknown zone aborts the boot in its own phase", async () => {
  await expect((await app(`{ timezone: { default: 'Mars/Olympus' } }`)).boot({ mode: "script" }))
    .rejects.toThrow(/Boot aborted during "timezone"/);
});
