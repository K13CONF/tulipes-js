# Sprint workflow

- Before starting or resuming a change set, read the active plan in `docs/sprints/`
  and identify the sprint item and acceptance criteria it serves.
- Keep changes within that scope. Record newly discovered work in the sprint
  backlog instead of silently expanding the current change set.
- Update the sprint tracker with completed work, validation evidence and remaining
  tasks. Distinguish local verification from CI or release verification.
- Commit each coherent change set after its required checks pass, before starting
  the next set. Include the sprint item in the commit message and report the hash.
- Preserve unrelated user changes. Committing does not authorize pushing,
  publishing, merging or changing repository visibility.
