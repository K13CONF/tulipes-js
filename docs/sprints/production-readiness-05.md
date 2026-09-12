# Sprint 05 — Packaging decisions and feature composition

Status: S12 merged as PR #12 (`eaaef83`); S13 merged as PR #13 (`f9b89ed`);
S14 (feature composition) follows as its own increment.

Program: [Sprint 05 task definitions](production-readiness-task-report.md#6-sprint-05--packaging-decisions-and-feature-composition).
Prerequisites: [Sprint 03](production-readiness-03.md) and [Sprint 04](production-readiness-04.md)
measurements — every driver is extracted and the inventory harness attributes
every remaining dependency.

## 1. Tracker

| Item | Status | Evidence |
|---|---|---|
| S12.1 | Complete | [CLI design §1](../design/cli-package-design.md#1-what-remains-in-a-core-only-install-s121): 69.5% of a core-only install is the TypeScript loader chain, 53% of the archive is CLI code |
| S12.2 | Complete | [CLI design §2](../design/cli-package-design.md#2-decision-s122): split into `@tulipes/cli`, remove `tsx` from core; command contract recorded |
| S12.3 | Complete | 2026-09-12: `@tulipes/cli` holds commands, templates and tests; core ships runtime only — [CLI design §5](../design/cli-package-design.md#5-evidence-s123-s124-2026-09-12) |
| S12.4 | Complete | packed journeys for both presets, module generation, upgrade and parity through the split; core-only install 26.95 MB → 7.58 MB (−71.9%) |
| S13.1–S13.4 | Complete | 2026-09-12: retain i18next as the always-available guarantee (1.2 MB, 16% of the runtime install; every preset translates; no provider-free journey exists); no extraction (S13.3 not justified); retained-behavior suite `packages/core/tests/i18n.test.ts` — [translation contract](../design/translation-contract.md) |
| S14.1–S14.5 | Complete | 2026-09-12: presets kept, `--no-queues`/`--no-sockets` for production validated before writing, generation composes only selected features, auth/settings stay generated code (deferral recorded), combination rows executable in packed smokes and a `composition` CI job — [feature composition](../design/feature-composition.md) |
