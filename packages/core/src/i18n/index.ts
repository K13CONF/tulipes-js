import type { TFunction } from "i18next";

export { I18n, type I18nSettings } from "./i18n.ts";
export { LOCALE_QUERY, resolveLocale } from "./locale.ts";
export type { TFunction, i18n as I18nextInstance } from "i18next";

/**
 * A module is a namespace, and an endpoint belongs to exactly one module —
 * so `req.t` is already bound to the right one by the time a handler runs.
 * Nothing to import, nothing to pass:
 *
 *   res.json({ message: req.t("created", { email }) });
 *
 * inside a users endpoint reads `modules/users/i18n/<locale>.json`. Reach
 * another module's strings by naming it: `req.t("auth:invalid")`.
 *
 * Both fields are set by `rai()` — which is one more reason every route
 * must declare one. An undeclared route belongs to no module, and so has
 * no namespace to bind.
 */
declare global {
  namespace Express {
    interface Request {
      /** Translator bound to the matched route's module namespace. */
      t: TFunction;
      /**
       * Whether this module defines that key — a question worth asking
       * before translating a string that may already be finished prose,
       * because `t()` on a non-key records it as missing.
       */
      hasTranslation: (key: string) => boolean;
      /** The negotiated locale: `?lang`, then Accept-Language, then default. */
      locale: string;
    }
  }
}
