# Writing the Tulipes documentation

The site teaches a Node.js/TypeScript developer who has never seen Tulipes how
to build, run and ship an app with it. It is a learning journey, not a list
of signatures: every page explains *why* before *how*, shows real code, and
ends by pointing to the next step. The generated TypeScript API reference
exists for lookups only; never send a reader there instead of explaining.

## Where pages go

`site/src/content/docs/`:

| Directory | Purpose | Voice |
|---|---|---|
| `start/` | What Tulipes is, install, quick start, project tour | Welcoming, brisk |
| `tutorial/` | One continuous project (a bookstore API), chapter by chapter | "We", hands-on, every step runnable |
| `concepts/` | How the framework runs: modules, boot, ctx, modes, ACL, envelope, inspection, providers | Explanatory, diagrams in text |
| `guides/` | One task or feature per page, complete with every option | Practical, "you" |
| `packages/` | One page per npm package: what it adds, install, wiring, configuration | Reference-ish, but in prose |
| `production/` | Deploy, PM2, nginx, checklist, security model, upgrading | Precise, operational |
| `reference/topics/` | Tables a reader looks things up in: config keys, env vars, error codes, list-query grammar | Terse tables plus one line of context each |

## Every page

1. **Frontmatter**, always:
   ```yaml
   ---
   title: Queues and background jobs     # ≤ 50 characters, unique across the site
   description: How to define a queue, enqueue jobs and process them in the worker with @tulipes/bullmq, including retries, cron and shutdown.  # 120–160 characters, unique
   sidebar:
     order: 3                              # position inside its directory
   ---
   ```
   Check with `node site/scripts/lint-frontmatter.mjs <your files>` before you finish.
   Do **not** run `pnpm build` in `site/`: other writers are working at the same
   time, and the build rewrites shared generated folders.
2. **Opening paragraph**: what this is and why a reader would want it, in 2–4 sentences. No "In this page we will…".
3. **The idea**, then **the code**, then **what happens under the hood**
   (which boot phase, which process, what fails and when).
4. **Examples are real.** Take them from `example/` (the reference app) whenever
   possible and give the file name: ` ```ts title="modules/hello/routes/web.hello.routes.ts" `.
   When you write new code, it must match the current source exactly:
   names, options, import paths (`@tulipes/core/http`, `zod/v4`…). Read the
   source in `packages/*/src` to confirm. Never invent an option or a flag.
5. **Errors and gotchas**: show the actual boot error or response a mistake
   produces (copy the message format from the source or tests).
6. **End with next steps**: 2–4 `<LinkCard>`s to the pages a reader needs next.

## Components

Files that use components must be `.mdx`. Import what you use:

```mdx
import { Aside, Steps, Tabs, TabItem, FileTree, Card, CardGrid, LinkCard, Badge } from "@astrojs/starlight/components";
```

- `<Steps>` around an ordered list for procedures.
- `<Tabs syncKey="pkg">` with `<TabItem label="pnpm">`/`npm` for install commands.
- `<FileTree>` for folder layouts (a markdown list inside).
- `<Aside type="tip|note|caution|danger">` for one important point, not decoration.
- Code blocks: `title="path/to/file.ts"`, `{3-5}` to highlight lines, `ins={4} del={3}` for diffs, `sh` for shell.
- Diagrams: fenced `txt` blocks with box-and-arrow text, kept under 70 columns.

## Links and MDX rules

- Internal links are absolute **with the base path and a trailing slash**:
  `[queues](/tulipes-js/guides/queues/)`. The base is `/tulipes-js`.
- In `.mdx` prose, `{` and `<` start JSX. Put code in backticks, or escape as `\{` and `\<`.
- One `h1` per page comes from `title`; start the body at `##`.
- American English, sentence-case headings, no emoji, no marketing superlatives.
- Name things the way the code does: `ctx.rai()`, `res.respond()`, `HttpError`, `tulipes sync`.

## Accuracy

The reader will copy what you write. Everything must be checkable against
`packages/*/src`, `example/` or the existing docs (`packages/*/README.md`,
`packages/core/MIGRATING.md`, `docs/*.md`, `example/AGENTS.md`). If two sources
disagree, the source code wins; note the disagreement in your final report.
If you cannot confirm something, leave it out and report it.
