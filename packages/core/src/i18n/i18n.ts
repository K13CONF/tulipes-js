import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import i18next, { type i18n as I18nextInstance, type TFunction } from "i18next";
import FsBackend from "i18next-fs-backend";

import type { AppEnv } from "../env/environment.js";
import type { BootReport } from "../errors/boot-error.js";
import type { ModuleFiles } from "../modules/explorer.js";
import { resolveLocale } from "./locale.js";

/**
 * Boot phase 6b — translations.
 *
 * A module is a namespace. `modules/users/i18n/en.json` holds every string
 * the users module can say, and nothing reaches into it by accident:
 * `req.t("created")` inside a users endpoint reads users' file, because the
 * RAI already recorded which module declared that route.
 *
 * Locales are app policy and come from `config.i18n`; the strings belong to
 * the modules. Neither side has to know about the other.
 */

export interface I18nSettings {
  /** Served when nothing better is negotiated, and the fallback for gaps. */
  defaultLocale: string;
  /** Every locale the app ships. A request never resolves outside this. */
  supportedLocales: readonly string[];
}

const DEFAULT_SETTINGS: I18nSettings = { defaultLocale: "en", supportedLocales: ["en"] };

export class I18n {
  /**
   * The i18next instance itself — the escape hatch for anything the two
   * methods below do not cover (plural rules, formatters, adding resources
   * at runtime). It exists from the first moment of boot and is never
   * replaced, so holding a reference to it is always safe; phase 6b fills
   * it with resources.
   */
  readonly instance: I18nextInstance = i18next.createInstance();
  #settings: I18nSettings = DEFAULT_SETTINGS;
  #namespaces: readonly string[] = [];

  get settings(): I18nSettings {
    return this.#settings;
  }

  /** Modules that actually ship translations. */
  get namespaces(): readonly string[] {
    return this.#namespaces;
  }

  /**
   * A translator bound to one module's namespace, for code with no request
   * to negotiate from — a queue processor translating a welcome email
   * against the recipient's stored locale, a script, a bootstrap task:
   *
   *   const t = ctx.t("users", user.locale);
   *   await sendMail(t("welcome.subject", { name: user.name }));
   */
  t(namespace: string, locale?: string): TFunction {
    return this.instance.getFixedT(locale ?? this.#settings.defaultLocale, namespace);
  }

  /** @internal Binds `req.locale` and `req.t` — called by `rai()`. */
  attach_(req: Request, module: string): void {
    const { supportedLocales, defaultLocale } = this.#settings;
    req.locale = resolveLocale(req, supportedLocales, defaultLocale);
    req.t = this.instance.getFixedT(req.locale, module);
  }

  /**
   * Reads `config.i18n` leniently: an app with no i18n block still gets a
   * working single-locale runtime, so `req.t` is never undefined and adding
   * a second language later is a config change rather than a refactor.
   */
  static readSettings(raw: unknown, report: BootReport): I18nSettings {
    const block = (raw ?? {}) as Partial<I18nSettings>;
    const defaultLocale = block.defaultLocale ?? DEFAULT_SETTINGS.defaultLocale;
    const supportedLocales = block.supportedLocales ?? [defaultLocale];

    if (supportedLocales.length === 0) {
      report.add({ scope: "i18n", message: "config.i18n.supportedLocales is empty" });
    } else if (!supportedLocales.includes(defaultLocale)) {
      // Otherwise every fallback lands on a locale the app refuses to serve.
      report.add({
        scope: "i18n",
        message:
          `config.i18n.defaultLocale "${defaultLocale}" is not in supportedLocales ` +
          `(${supportedLocales.join(", ")})`,
      });
    }

    return { defaultLocale, supportedLocales };
  }

  async load(
    explored: readonly ModuleFiles[],
    settings: I18nSettings,
    appEnv: AppEnv,
    report: BootReport,
  ): Promise<void> {
    this.#settings = settings;

    // Namespace → the module's i18n folder. A module's folder name is not
    // required to match its short name, so the mapping is recorded here
    // rather than baked into a path template.
    const dirs = new Map<string, string>();
    for (const { module } of explored) {
      const dir = join(module.dir, "i18n");
      if (!existsSync(dir)) continue; // a module with nothing to say
      if (validate(module.name, dir, settings, report)) dirs.set(module.name, dir);
    }
    this.#namespaces = [...dirs.keys()];

    // The backend hands `read` a single namespace and `create` an array of
    // them, so both shapes are normalised before the lookup. The returned
    // template keeps `{{lng}}` for the backend to interpolate.
    const pathFor = (suffix: string) => (_lng: string | readonly string[], ns: string | readonly string[]) => {
      const dir = dirs.get(typeof ns === "string" ? ns : (ns[0] ?? ""));
      // Unreachable for a namespace registered above; a path outside the
      // app still beats one that lands in a module folder by coincidence.
      return dir ? join(dir, `{{lng}}${suffix}`) : join("/dev/null", `{{lng}}${suffix}`);
    };

    await this.instance.use(FsBackend).init({
      // Load the files during init rather than in a later tick, so the app
      // is never briefly up and answering in raw keys.
      initAsync: false,
      lng: settings.defaultLocale,
      fallbackLng: settings.defaultLocale,
      supportedLngs: [...settings.supportedLocales],
      preload: [...settings.supportedLocales],
      ns: this.#namespaces,
      // No default namespace: every lookup is either bound to a module by
      // its RAI or names the namespace explicitly. An implicit default is
      // the accident this design exists to prevent.
      defaultNS: false,
      fallbackNS: false,
      // Outside production a key with no translation ANYWHERE is written to
      // `<locale>.missing.json`, beside the file it should have been in, so
      // new keys collect themselves as they are hit. Keys a locale is
      // merely behind on never reach this — the default locale answers them
      // — which is what `recordGaps` below exists to catch.
      // Production never writes: the filesystem may be read-only, and
      // several instances would race over the same file.
      saveMissing: appEnv !== "production",
      saveMissingTo: "current",
      backend: {
        loadPath: pathFor(".json"),
        addPath: pathFor(".missing.json"),
      },
      // Values land in JSON bodies and log lines rather than HTML, so
      // escaping would turn every apostrophe into &#39; for every consumer.
      interpolation: { escapeValue: false },
    });

    if (appEnv !== "production") {
      for (const dir of dirs.values()) recordGaps(dir, settings);
    }
  }
}

/**
 * Everything the default locale says that another locale does not, written
 * to the same `<locale>.missing.json` i18next appends to at runtime — with
 * the default-locale string as the value, which is what a translator needs
 * in front of them.
 *
 * The file is rewritten rather than merged, so a key that has since been
 * translated leaves it: it always describes what is missing now. Never runs
 * in production, and a read-only filesystem is not an error — this is a
 * working note, and failing a boot over one would be absurd.
 */
function recordGaps(dir: string, settings: I18nSettings): void {
  const source = flatten(readJson(join(dir, `${settings.defaultLocale}.json`)));

  for (const locale of settings.supportedLocales) {
    if (locale === settings.defaultLocale) continue;

    const file = join(dir, `${locale}.missing.json`);
    const translated = flatten(readJson(join(dir, `${locale}.json`)));
    const gaps = [...source].filter(([key]) => !translated.has(key));

    try {
      if (gaps.length === 0) {
        if (existsSync(file)) rmSync(file);
        continue;
      }
      const nested: Record<string, unknown> = {};
      for (const [key, value] of gaps) setPath(nested, key.split("."), value);
      writeFileSync(file, `${JSON.stringify(nested, null, 2)}\n`);
    } catch {
      // read-only filesystem, or a race with i18next's own writer
    }
  }
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {}; // absent or unparseable — validate() has already reported it
  }
}

/** `{ list: { empty: "…" } }` → `Map { "list.empty" => "…" }`. */
function flatten(source: Record<string, unknown>, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as Record<string, unknown>, path)) out.set(k, v);
    } else {
      out.set(path, String(value));
    }
  }
  return out;
}

function setPath(target: Record<string, unknown>, path: string[], value: string): void {
  const last = path.pop()!;
  let node = target;
  for (const segment of path) {
    node[segment] ??= {};
    node = node[segment] as Record<string, unknown>;
  }
  node[last] = value;
}

/**
 * Guards the two failures i18next would otherwise swallow: a file that is
 * not valid JSON, and an i18n folder with no default-locale file. Both
 * serve raw keys to users at runtime with nothing in the log to say why.
 */
function validate(
  moduleName: string,
  dir: string,
  settings: I18nSettings,
  report: BootReport,
): boolean {
  let ok = true;

  if (!existsSync(join(dir, `${settings.defaultLocale}.json`))) {
    report.add({
      scope: "i18n",
      module: moduleName,
      message:
        `i18n/ exists but has no ${settings.defaultLocale}.json — ` +
        "the default locale is what every other locale falls back to",
    });
    ok = false;
  }

  // Only the locales the app ships: a stray de.json in a two-locale app is
  // dead weight, not a parse error waiting to happen.
  for (const locale of settings.supportedLocales) {
    const file = join(dir, `${locale}.json`);
    if (!existsSync(file)) continue; // gaps fall back; saveMissing records them
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      report.add({
        scope: "i18n",
        module: moduleName,
        message: `i18n/${locale}.json is not valid JSON: ${(error as Error).message}`,
      });
      ok = false;
    }
  }

  return ok;
}
