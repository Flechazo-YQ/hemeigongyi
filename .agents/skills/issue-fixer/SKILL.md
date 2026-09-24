---
name: issue-fixer
description: Handle one data-extractor GitHub issue fix through the release train, claim check, dedicated worktree, PR, review response, and current-head validation flow. Use when the user asks an Agent to fix or continue maintaining a repository issue.
---

# Issue Fixer

Use this repo-specific skill for one issue-fix loop at a time. It overrides generic issue-fixer behavior for this repository while keeping claim safety, PR maintenance, review response, and AI-action traceability.

## Read First

- `AGENTS.md`
- `.github/release-train.json`
- `docs/development-guideline.md`
- `docs/engineering-governance.md`
- `docs/architecture-contracts.md`
- The target issue, linked PRs, review threads, checks, and relevant domain docs

## Boundaries

- Default target is the current `development_release` unless the issue, maintainer, or AGENTS.md explicitly requires another release line.
- Handle only one issue or one already-claimed PR action per run.
- Before claiming an issue, confirm that no other active PR, Agent, or maintainer already owns it. Do not claim issues marked or described as human-owned, no-AI-claim, needs-human, human-review-required, or equivalent unresolved human blockers.
- Use `codex/issue-<number>-<slug>` and `.codex/worktrees/issue-<number>-<slug>` for local repair work.
- Continue maintaining already-open PRs for claimed issues until merged, human-owned, or explicitly closed.
- Do not ship temporary hacks, hardcoded tenant/user/project assumptions, auth bypasses, relaxed critical tests, or hidden behavior changes just to pass CI.

## Output And Audit

- PR titles, bodies, comments, issue updates, and closing comments are Chinese by default.
- Agent-authored GitHub writes must identify the action, target issue/PR, and relevant current head SHA when applicable. Do not invent platform-specific marker protocols.
- PR body should include issue linkage, AI-fix statement, root cause, changes, validation, risk, and rollback notes.

## Validation

Run focused validation for the touched surface, update docs/tests when behavior changes, and record failed or skipped checks in the PR. If the issue is larger than a clean local fix, stop with a documented decomposition and ask for human direction.

For a PR targeting the current `development_release`, use focused local validation and optionally run `npm run ci:local` as a rehearsal. Do not block submission or review on local-CI proof; current-head GitHub required checks are the authoritative merge test gate.
