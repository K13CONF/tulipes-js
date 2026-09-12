# Sprint 05 — Packaging decisions and feature composition

Status: S12 in execution on branch `feat/sprint-05-s12-cli`, started 2026-09-12
from `0cef22e` (core 0.10.0-rc.2 and all three providers published). S13
(translation contract) and S14 (feature composition) follow as their own
increments, each with its own go/no-go.

Program: [Sprint 05 task definitions](production-readiness-task-report.md#6-sprint-05--packaging-decisions-and-feature-composition).
Prerequisites: [Sprint 03](production-readiness-03.md) and [Sprint 04](production-readiness-04.md)
measurements — every driver is extracted and the inventory harness attributes
every remaining dependency.

## 1. Tracker

| Item | Status | Evidence |
|---|---|---|
| S12.1 | Complete | [CLI design §1](../design/cli-package-design.md#1-what-remains-in-a-core-only-install-s121): 69.5% of a core-only install is the TypeScript loader chain, 53% of the archive is CLI code |
| S12.2 | Complete | [CLI design §2](../design/cli-package-design.md#2-decision-s122): split into `@tulipes/cli`, remove `tsx` from core; command contract recorded |
| S12.3 | Not started | |
| S12.4 | Not started | |
| S13 | Not started | Own increment |
| S14 | Not started | Own increment |
