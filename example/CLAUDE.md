# Working in this project

The project instructions live in **[AGENTS.md](./AGENTS.md)** — the
vendor-neutral file every coding agent reads. Read it before writing code
here; it holds the non-negotiable rules, where each kind of code belongs, the
boot order and the commands.

This file exists so Claude Code picks that up automatically. The other
Claude-specific piece is `.claude/skills/`: task-scoped guides — module,
environment variable, endpoint, response, list queries, model, queue, socket, permissions,
settings (the config module and the log stream), i18n, spec, agent tools and
reading boot errors — loaded on demand when a task matches one. AGENTS.md
points at them by name.
