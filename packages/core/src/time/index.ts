import type { ZonedTime } from "./timezone.ts";

export {
  Timezones,
  TIMEZONE_HEADER,
  TIMEZONE_QUERY,
  canonicalTimezone,
  formatDate,
  isValidTimezone,
  offsetMinutes,
  resolveTimezone,
  startOfDay,
  toZonedISO,
  zonedTime,
  zonedTimeToUtc,
  type FormatDateOptions,
  type TimezoneSettings,
  type ZonedTime,
} from "./timezone.ts";

/**
 * Every request knows the zone its caller reads time in, negotiated the
 * way the locale is — `?tz=`, then `X-Timezone`, then
 * `config.timezone.default` — and helpers already bound to it:
 *
 *   const since = req.time.startOfDay();              // local midnight, as a UTC Date
 *   const label = req.time.format(order.created_at);  // "13 Oct 2026, 15:00"
 *
 * Both are set by `rai()`, beside `req.locale`.
 */
declare global {
  namespace Express {
    interface Request {
      /** The negotiated IANA zone: `?tz`, then X-Timezone, then the default. */
      timezone: string;
      /** Zone-aware helpers bound to `req.timezone` and `req.locale`. */
      time: ZonedTime;
    }
  }
}
