import type { Request } from "express";

import type { BootReport } from "../errors/boot-error.ts";

/**
 * Boot phase 7b — time zones.
 *
 * Instants are stored and sent as UTC, always: Mongo keeps a Date as UTC,
 * and every ISO string the API returns ends in `Z`. A time zone is how an
 * instant is *read* — what "today" means for a report, the wall-clock time
 * in a notification, when a nightly job fires — so it is app policy, kept
 * in `config.timezone` beside `config.i18n`:
 *
 *   timezone: {
 *     default: "Africa/Casablanca",
 *     supported: ["Africa/Casablanca", "Europe/Paris"], // optional allow-list
 *   }
 *
 * A request reads instants in the zone it asked for, negotiated like the
 * locale: `?tz=Europe/Paris`, then an `X-Timezone` header, then the default.
 */

export interface TimezoneSettings {
  /** The app's zone: the fallback for a request, and the zone of code with no request. */
  default: string;
  /**
   * Zones a request may ask for. Omitted, any valid IANA zone is accepted;
   * a zone outside the list falls through to the default.
   */
  supported?: readonly string[];
  /**
   * Whether `process.env.TZ` follows `default`, so `Date#getHours()`, log
   * timestamps and daily file rotation agree with the app. On by default
   * once an app names a zone; an app with no `timezone` block never has its
   * process zone touched.
   */
  applyToProcess: boolean;
}

/** The query parameter that overrides the header. */
export const TIMEZONE_QUERY = "tz";
/** The header a client sends its zone in. */
export const TIMEZONE_HEADER = "x-timezone";

const DEFAULT_SETTINGS: TimezoneSettings = { default: "UTC", applyToProcess: false };

/**
 * The canonical spelling of an IANA zone, or undefined when the runtime
 * does not know it. `europe/paris` reads as `Europe/Paris`; `Etc/UTC` and
 * `UTC` stay as written.
 */
export function canonicalTimezone(zone: string | undefined): string | undefined {
  if (!zone) return undefined;
  const trimmed = zone.trim();
  if (!trimmed) return undefined;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function isValidTimezone(zone: string): boolean {
  return canonicalTimezone(zone) !== undefined;
}

export function resolveTimezone(req: Request, settings: TimezoneSettings): string {
  const asked = req.query?.[TIMEZONE_QUERY];
  for (const candidate of [typeof asked === "string" ? asked : undefined, req.header(TIMEZONE_HEADER)]) {
    const zone = accept(candidate, settings);
    if (zone) return zone;
  }
  return settings.default;
}

function accept(candidate: string | undefined, settings: TimezoneSettings): string | undefined {
  const zone = canonicalTimezone(candidate);
  if (!zone) return undefined;
  if (!settings.supported) return zone;
  return settings.supported.find((allowed) => canonicalTimezone(allowed) === zone);
}

/**
 * Minutes east of UTC for `zone` at `date`: 60 for Paris in winter, 120 in
 * summer, -300 for New York in winter. Daylight saving is why it takes a
 * date — a zone has no single offset.
 */
export function offsetMinutes(date: Date | number | string, zone: string): number {
  const instant = toDate(date);
  const parts = wallClock(instant, zone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The same instant as an ISO 8601 string in `zone`, with its offset:
 * `2026-10-13T15:00:00.000+01:00`. Parses back to the identical instant, so
 * it is safe to hand to a client that wants local wall-clock time.
 */
export function toZonedISO(date: Date | number | string, zone: string): string {
  const instant = toDate(date);
  const parts = wallClock(instant, zone);
  const offset = offsetMinutes(instant, zone);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const ms = String(instant.getUTCMilliseconds()).padStart(3, "0");
  return `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)}.${ms}${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/**
 * The UTC instant at which the calendar day containing `date` begins in
 * `zone` — what "today" means for a query:
 *
 *   const from = startOfDay(new Date(), req.timezone);
 *   Order.find({ created_at: { $gte: from } });
 */
export function startOfDay(date: Date | number | string, zone: string): Date {
  const { year, month, day } = wallClock(toDate(date), zone);
  return zonedTimeToUtc({ year, month, day }, zone);
}

/**
 * The UTC instant of a wall-clock time in `zone`: 09:00 on 2026-10-13 in
 * Casablanca. A time skipped by a daylight-saving jump resolves forward; a
 * repeated one resolves to its first occurrence.
 */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number; millisecond?: number },
  zone: string,
): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0, wall.millisecond ?? 0);
  // A wall-clock time is read with the offset in force a day either side of
  // it; a candidate counts only if the zone agrees with it at that instant.
  // Two survive a repeated hour (take the first), none a skipped one (read
  // it with the offset from before the jump, which lands after it).
  const before = offsetMinutes(guess - 86_400_000, zone);
  const after = offsetMinutes(guess + 86_400_000, zone);
  const candidates = [...new Set([before, after])]
    .map((offset) => guess - offset * 60_000)
    .filter((candidate) => offsetMinutes(candidate, zone) * 60_000 === guess - candidate)
    .sort((a, b) => a - b);
  return new Date(candidates[0] ?? guess - before * 60_000);
}

export interface FormatDateOptions extends Intl.DateTimeFormatOptions {
  /** Defaults to the request's locale, or the app's default locale. */
  locale?: string;
}

/**
 * `date` formatted for a reader in `zone` — the place a wall-clock time
 * ends up in an email or a PDF. Without style options it prints the date
 * and time at medium length.
 */
export function formatDate(date: Date | number | string, zone: string, options: FormatDateOptions = {}): string {
  const { locale, ...format } = options;
  const styled = Object.keys(format).length > 0 ? format : { dateStyle: "medium", timeStyle: "short" } as const;
  return new Intl.DateTimeFormat(locale, { ...styled, timeZone: zone }).format(toDate(date));
}

/** Zone-aware helpers with the zone already chosen — `req.time` and `ctx.time`. */
export interface ZonedTime {
  /** The zone every method below reads in. */
  readonly zone: string;
  /** See {@link formatDate}; the locale defaults to the caller's. */
  format(date: Date | number | string, options?: FormatDateOptions): string;
  /** See {@link toZonedISO}. */
  toISO(date: Date | number | string): string;
  /** See {@link startOfDay}. */
  startOfDay(date?: Date | number | string): Date;
  /** See {@link zonedTimeToUtc}. */
  fromWallClock(wall: Parameters<typeof zonedTimeToUtc>[0]): Date;
  /** See {@link offsetMinutes}. */
  offsetMinutes(date?: Date | number | string): number;
}

export function zonedTime(zone: string, locale?: string): ZonedTime {
  return Object.freeze({
    zone,
    format: (date, options = {}) => formatDate(date, zone, { ...(locale && { locale }), ...options }),
    toISO: (date) => toZonedISO(date, zone),
    startOfDay: (date = new Date()) => startOfDay(date, zone),
    fromWallClock: (wall) => zonedTimeToUtc(wall, zone),
    offsetMinutes: (date = new Date()) => offsetMinutes(date, zone),
  } satisfies ZonedTime);
}

export class Timezones {
  #settings: TimezoneSettings = DEFAULT_SETTINGS;
  #previousProcessTz: string | undefined;
  #applied = false;

  get settings(): TimezoneSettings {
    return this.#settings;
  }

  /** The app's zone. */
  get zone(): string {
    return this.#settings.default;
  }

  /** Helpers in `zone` (the app's zone when omitted). */
  in(zone?: string, locale?: string): ZonedTime {
    return zonedTime(canonicalTimezone(zone) ?? this.#settings.default, locale);
  }

  /** @internal Binds `req.timezone` and `req.time`. */
  attach_(req: Request): void {
    const zone = resolveTimezone(req, this.#settings);
    req.timezone = zone;
    req.time = zonedTime(zone, req.locale);
  }

  /** @internal Phase 7b. */
  load(settings: TimezoneSettings): void {
    this.#settings = settings;
    if (settings.applyToProcess && process.env.TZ !== settings.default) {
      this.#previousProcessTz = process.env.TZ;
      this.#applied = true;
      // Node re-reads TZ on assignment: every later Date local method,
      // pino-pretty's SYS: times and pino-roll's daily rotation follow it.
      process.env.TZ = settings.default;
    }
  }

  /** @internal Shutdown: give the process back the zone it had, for the next boot in it. */
  restore_(): void {
    if (!this.#applied) return;
    if (this.#previousProcessTz === undefined) delete process.env.TZ;
    else process.env.TZ = this.#previousProcessTz;
    this.#applied = false;
  }

  /**
   * Reads `config.timezone` leniently: an app with no block reads instants
   * in UTC and keeps whatever process zone it was started with.
   */
  static readSettings(raw: unknown, report: BootReport): TimezoneSettings {
    if (raw === undefined || raw === null) return DEFAULT_SETTINGS;
    const block = raw as Partial<{ default: unknown; supported: unknown; applyToProcess: unknown }>;
    const problem = (message: string) => report.add({ scope: "timezone", message });

    const asked = typeof block.default === "string" ? block.default : "UTC";
    if (block.default !== undefined && typeof block.default !== "string") problem("config.timezone.default must be an IANA zone name such as \"Europe/Paris\"");
    const zone = canonicalTimezone(asked);
    if (!zone) problem(`config.timezone.default "${asked}" is not a time zone this runtime knows (an IANA name such as "Europe/Paris")`);

    let supported: string[] | undefined;
    if (block.supported !== undefined) {
      if (!Array.isArray(block.supported) || block.supported.some((entry) => typeof entry !== "string")) {
        problem("config.timezone.supported must be an array of IANA zone names");
      } else {
        supported = [];
        for (const entry of block.supported as string[]) {
          const canonical = canonicalTimezone(entry);
          if (canonical) supported.push(canonical);
          else problem(`config.timezone.supported names "${entry}", which is not a time zone this runtime knows`);
        }
        if (supported.length === 0) problem("config.timezone.supported is empty");
        else if (zone && !supported.includes(zone)) {
          // Otherwise every fallback lands on a zone the app refuses to serve.
          problem(`config.timezone.default "${zone}" is not in supported (${supported.join(", ")})`);
        }
      }
    }

    if (block.applyToProcess !== undefined && typeof block.applyToProcess !== "boolean") {
      problem("config.timezone.applyToProcess must be true or false");
    }

    return {
      default: zone ?? "UTC",
      ...(supported && { supported }),
      applyToProcess: block.applyToProcess !== false,
    };
  }
}

function toDate(value: Date | number | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(date: Date, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      era: "short",
    });
    formatters.set(zone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(date)) parts[type] = value;
  const year = Number(parts.year);
  return {
    year: parts.era === "BC" || parts.era === "B" ? 1 - year : year,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}
