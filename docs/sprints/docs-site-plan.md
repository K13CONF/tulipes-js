# Docs site — the Tulipes documentation on GitHub Pages

Status: planned on 2026-10-31 against `be58e97` (0.13.2). Nothing implemented.
Decisions in §7 settled on 2026-10-31.

The brief, in the maintainer's words: a documentation site for the framework,
deployed with GitHub Pages, covering every detail, built to rank well in search.

Section 1 lists what already exists. Section 2 covers the design decisions,
section 3 the site map, section 4 the SEO requirements, section 5 the sprint
breakdown with acceptance criteria, section 6 the evidence, section 7 the open
decisions and section 8 the backlog.

## 1. What exists today

| Source | Size | Becomes |
|---|---|---|
| `packages/core/README.md` (17 sections) | 835 lines | Guides and concepts, split one page per section |
| `packages/*/README.md` (7 other packages) | ~650 lines | One overview page per package |
| `packages/core/MIGRATING.md` | 1,465 lines, 25 sections | One upgrade page per version line |
| `packages/core/CHANGELOG.md` | 988 lines | Changelog page, linked from every version page |
| `docs/security-model.md`, `testing.md`, `support.md`, `releasing.md` | ~680 lines | Security, testing and support pages |
| `docs/design/*.md` (13 files) | — | "Under the hood" explanation pages, edited for readers outside the project |
| `example/AGENTS.md` | 183 lines | "Working with AI agents" page |
| `packages/cli/src/main.ts` | 18 commands | CLI reference, one page per command |
| `packages/*/src` | 451 exports, 637 TSDoc blocks | Generated API reference |
| `assets/social-card.png`, `assets/mark-tile-512.png`, `assets/brand-kit/` | — | OG image, favicon, logo |

The repository `K13CONF/tulipes-js` is **public**, so GitHub Pages costs
nothing and needs no Enterprise plan. Its `homepageUrl` is empty.

## 2. Design

### 2.1 Generator: Astro Starlight

| Option | SEO-relevant facts | Verdict |
|---|---|---|
| **Astro Starlight** | Static HTML, no client JS by default (good Core Web Vitals); built-in sitemap, canonical, OG and `hreflang`; Pagefind search runs offline with no service; `head` can be overridden per page for JSON-LD; `starlight-typedoc` generates the API reference | **Chosen** |
| VitePress | Static and fast; sitemap built in; SPA navigation after the first load; JSON-LD has to be added by hand | Close second |
| Docusaurus | React hydrates on every page; heavier bundle | Rejected: worse LCP/INP for no gain |

### 2.2 Where it lives

- A new private workspace, `site/` (`"private": true`, name `@tulipes-site/docs`),
  added to `pnpm-workspace.yaml`. It is never packed.
- **Core gains nothing.** The site's dependencies stay in `site/package.json`.
  `scripts/artifacts.mjs verify` and the `./packages/*` typecheck filter are
  unaffected. Confirm both in D01.
- The lockfile changes once, in D01. CI's `--frozen-lockfile` enforces it after that.

### 2.3 One source of truth

Every detail must stay correct, so content is not copied from one place to another:

- **API reference** is generated from TSDoc at build time (`starlight-typedoc`,
  one entry point per `exports` subpath: `@tulipes/core`, `/modules`, `/boot`,
  `/acl`, `/agent`, `/db`, `/queues`, `/sockets`, `/http`, `/i18n`, `/time`,
  `/config`, `/errors`, and the other seven packages). Missing TSDoc on an
  export is a build warning, and D07 makes it fail the build.
- **CLI reference** is generated from the CLI's own help text by a script that
  runs `tulipes <cmd> --help` for each command in `main.ts`, so a new flag
  cannot go undocumented.
- **Code samples** are imported from real files in `example/` (`?raw` imports
  plus a line-range marker), not pasted. Anything that cannot come from
  `example/` goes in `site/snippets/*.ts` and is typechecked in CI.
- **Changelog and migration** pages are generated from `CHANGELOG.md` and
  `MIGRATING.md`, split at each `##` heading. Those files stay canonical.
- **READMEs** shrink to a short introduction plus a link to the site after D04.
  They are what npm shows, so they keep the install and quick-start sections.

### 2.4 URL and hosting

- URL: `https://k13conf.github.io/tulipes-js/`, with Astro `base: "/tulipes-js"`
  (free; §7). Keep `site`/`base` in one place, so moving to a custom domain later
  means changing one line and adding a `CNAME` file.
- Crawlers only read `robots.txt` at the host root (`k13conf.github.io/robots.txt`),
  and only the org's `K13CONF/k13conf.github.io` repo can publish that file. So
  the sitemap is submitted directly in Search Console and Bing, and the site
  also links it from the `<head>`. Optionally, create the org root repo with a
  `robots.txt` that names the sitemap (D08).
- A later domain move cannot use server-side 301 redirects on Pages. Search
  engines would have to follow canonical links and meta refreshes instead,
  which is slower. That is the price of the free URL.
- Pages serves no custom headers and no server-side redirects. Moved pages get
  static redirect stubs (`<meta http-equiv="refresh">` plus `rel="canonical"`
  pointing to the new URL), produced by Astro `redirects`.
- `trailingSlash: "always"` matches how Pages serves `dir/index.html` and
  avoids duplicate URLs.

### 2.5 Deployment

New workflow `.github/workflows/docs.yml`:

- Runs on push to `master` touching `site/**`, `packages/*/src/**`,
  `packages/*/README.md`, `packages/core/{CHANGELOG,MIGRATING}.md`, `docs/**`,
  `example/**`, plus `workflow_dispatch`.
- Job `build`: `pnpm install --frozen-lockfile` → `pnpm --filter @tulipes-site/docs build`
  → link check → Lighthouse CI → `actions/upload-pages-artifact`.
- Job `deploy`: `actions/deploy-pages`, `environment: github-pages`,
  permissions `pages: write`, `id-token: write`. Nothing else gets write access.
- Pull requests run `build` and the checks only, never `deploy`.
- One-time setting: Repository → Settings → Pages → Source = "GitHub Actions".
  This is a maintainer action, and the plan does not do it.

## 3. Site map (Diátaxis)

```
/                               Landing: what Tulipes is, 30-second example, install, why
/start/                         Getting started
  install/                      Requirements (Node 24, pnpm 10, MongoDB, Redis), tulipes init
  presets/                      minimal vs production, what each gives you
  first-module/                 Tutorial: a module end to end (route, action, ACL, test)
  project-structure/            Every file in a generated app, explained
/guides/                        How-to, one task per page
  modules/  routes/  actions/  validation/  responses/  errors/
  environment-values/  configuration/  settings/  translations/  time-zones/
  authentication/  api-tokens/  roles-and-grants/  credential-scopes/
  database-mongoose/  list-queries/  soft-delete-and-timestamps/
  queues-bullmq/  sockets/  cache/  logging/
  mcp-server/  agents/  ai-assisted-development/
  openapi-spec/  testing/  deployment/  nginx/  pm2/  production-checklist/
/concepts/                      Explanation
  architecture/  boot-pipeline/  providers/  rai-ids/  who-is-calling/
  response-envelope/  security-model/  reliability/  feature-composition/
/reference/
  cli/<command>/                18 pages, generated
  api/<package>/<export>/       generated from TSDoc
  config/                       every config file and key, its type and default
  environment/                  every environment variable
  error-codes/                  every error code, its HTTP status and meaning
  list-query-grammar/           operators, limits, field types
/upgrade/<version>/             from MIGRATING.md, one page per line
/changelog/                     from CHANGELOG.md
/packages/<name>/               overview of each of the 8 packages
/support/  /security/  /contributing/
```

The "every config key", "every environment variable" and "every error code"
pages are where completeness is checked. Each one is generated from, or
checked against, the source (`config/*.config.ts` types, the env schema, the
error constructors), so missing entries fail D07.

## 4. SEO requirements

These are site-wide. Each item is checked by tooling in D06/D07, not by memory.

**Per page**
- Unique `title` (≤ 60 characters, pattern `<Page> · Tulipes`) and `description`
  (120–160 characters) in the frontmatter. The build fails if either is
  missing, too long or duplicated.
- One `h1`, no skipped heading levels, descriptive `alt` on every image.
- An absolute `rel="canonical"` URL, plus `og:title`, `og:description`,
  `og:image`, `og:url`, `og:type=article` and `twitter:card=summary_large_image`.
- A per-page OG image generated at build time (title on the brand card from
  `assets/social-card.png`, via `astro-og-canvas`) so shared links stand out.
- JSON-LD: `TechArticle` with `dateModified` taken from git, plus `BreadcrumbList`.
  The landing page adds `SoftwareSourceCode` (repo, language, licence,
  version taken from core's `package.json`) and `WebSite` with a `SearchAction`.
- A visible "Last updated" date (from git) and an "Edit this page" link.

**Site-wide**
- `sitemap-index.xml` (only canonical pages, with `lastmod`), linked from
  every page's `<head>` and submitted by hand (see §2.4 for why `robots.txt` cannot do it).
- A `404.html` with search and the main links. Pages serves it automatically.
- `<html lang="en">`. If translations come later (backlog), add `hreflang` pairs.
- `llms.txt` and `llms-full.txt` (`starlight-llms-txt`), because AI assistants
  are now a discovery channel and the framework sells itself on AI-assisted work.
- Fast pages: no client JS beyond search, self-hosted fonts with `font-display: swap`,
  images as AVIF/WebP with width/height set. Targets: LCP < 1.5 s, CLS < 0.05,
  Lighthouse SEO = 100, Performance ≥ 95, Accessibility ≥ 95.
- Internal linking: every guide links to its concept and reference pages, and
  every API page links back to the guide that uses it ("Used in").
- Heavy pages (CLI, API) also get readable prose, not only signatures.

**Off-site** (maintainer actions, listed so they are not forgotten)
- Set `homepage` in all 8 `package.json` files to the docs URL. This changes
  the published archives, so it ships with the next release under the
  `docs/releasing.md` rules and is not a standalone publish.
- Set the GitHub repo homepage and topics (`nodejs`, `express`, `typescript`,
  `framework`, `mcp`, `rbac`, `mongoose`, `bullmq`).
- Verify the site in Google Search Console as a **URL-prefix** property
  `https://k13conf.github.io/tulipes-js/` (a domain property needs DNS, which
  github.io does not give us) using an HTML file in `site/public/`. Do the same
  in Bing Webmaster Tools, and submit the sitemap to both.
- Point the README badges and npm READMEs at the site.

**Keywords to target** (one primary keyword per page, used in its title, h1,
description and first paragraph): "TypeScript Express framework", "Node.js
backend framework with RBAC", "Express MCP server", "Mongoose soft delete
plugin", "BullMQ Express integration", "role-based access control Node.js",
"OpenAPI from Zod Express". Check the volumes in D06 before fixing titles.

## 5. Sprint breakdown

### D01 — Workspace and an empty site that deploys
- `site/` workspace with Starlight, the brand (logo, favicon, colours from
  `assets/brand-kit/`), `site`/`base`/`trailingSlash` set, and `docs.yml` as in §2.5.
- **Done when:** `pnpm install --frozen-lockfile` passes; `scripts/artifacts.mjs verify`
  passes unchanged; `pnpm typecheck` is unchanged; the workflow deploys
  a landing page and the 404 page to the Pages URL; `sitemap-index.xml` is
  served and linked from the `<head>`.

### D02 — Generated reference: API and CLI
- `starlight-typedoc` for all 20 entry points; a CLI help extraction script.
- **Done when:** every export in `exports` has a page; all 18 commands have a
  page whose flags match `--help` output; the build lists any export without
  TSDoc (a warning for now).

### D03 — Getting started and the core concepts
- `/start/*` and `/concepts/*` written from the core README, `framework-poc.md`
  and `docs/design/`. Samples imported from `example/`.
- **Done when:** a reader with no background can go from `tulipes init` to a
  tested module by following only `/start/`. Verified by doing it in a scratch
  directory with the published CLI and recording the transcript in §6.

### D04 — Guides
- Every `/guides/*` page in §3. READMEs shrink to an introduction and a link.
- **Done when:** every section of the core README and every package README is
  covered by a page (checklist in this file); no snippet is pasted (grep finds
  no fenced TypeScript block in `site/src/content` that has no source import).

### D05 — Upgrade, changelog, security, support
- The MIGRATING/CHANGELOG splitters; `security-model`, `testing`, `support`
  and `releasing` adapted for the public.
- **Done when:** every `##` in MIGRATING.md has an `/upgrade/` page; anchors
  from the old README links resolve (redirect stubs where needed).

### D06 — SEO layer
- Frontmatter schema with length limits, JSON-LD components, OG image
  generation, `llms.txt`, keyword pass on titles and descriptions.
- **Done when:** the build fails on a missing, duplicated or over-long
  title or description; the Rich Results Test is valid for the landing page and
  one guide; the OG card renders in a social preview check.

### D07 — Quality gates in CI
- Link checker (`lychee`, internal and external), Lighthouse CI with the
  §4 budgets, a heading/alt-text lint, TSDoc completeness as an error, and
  the config/env/error-code completeness checks from §3.
- **Done when:** each gate fails a deliberately broken commit (verified once
  on a throwaway branch) and passes on master.

### D08 — Launch
- `homepage` fields staged for the next release, repo homepage and topics,
  Search Console (URL-prefix) and Bing verification, sitemap submitted;
  optionally the org root repo with a `robots.txt`.
- **Done when:** `https://k13conf.github.io/tulipes-js/` serves HTTPS; Search
  Console shows the sitemap read with no errors; `site:` search returns the
  landing page (record the date).

## 6. Evidence this plan expects

| Item | Evidence |
|---|---|
| D01 | Workflow run URL, deployed URL, `artifacts.mjs verify` output |
| D03 | Transcript of the scratch-directory walkthrough, CLI version used |
| D06 | Rich Results Test screenshots or links, with the dates |
| D07 | Lighthouse CI report (URL, device profile, run date); the failing-branch runs |
| D08 | Search Console coverage after 14 days |

Keep the Lighthouse numbers with the conditions that produced them (mobile
profile, throttling, commit).

## 7. Decisions

Taken on 2026-10-31 by the maintainer:
- **Domain:** the free `k13conf.github.io/tulipes-js/`. A custom domain is backlog.
- **Versioned docs:** latest only until 1.0. Each `/upgrade/` page names the
  version it applies to.
- **README trimming in D04:** approved. The shorter READMEs reach npm with each
  package's next publish.

Taken in this plan:
- Starlight over VitePress and Docusaurus (§2.1).
- Generated over copied for the API, CLI, changelog and migration pages (§2.3).
- The site is a private workspace, and core gains no dependency (§2.2).

## 8. Backlog

- A custom domain (better for search ranking; needs DNS and a `CNAME` file; old URLs can only use meta-refresh redirects).
- Versioned docs per minor line once 1.0 ships.
- Translations (`hreflang`) once the i18n story for docs exists.
- Interactive playground (StackBlitz) for the minimal preset.
- A blog/news section for release posts (extra pages to index, plus RSS).
- Algolia DocSearch if Pagefind becomes too slow at the site's size.
