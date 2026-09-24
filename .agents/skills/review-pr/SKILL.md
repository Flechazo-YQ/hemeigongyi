---
name: review-pr
description: Review data-extractor open PRs against the active release train. Use when the user asks to inspect pending/open PRs, run static review, comment on blockers, approve safe changes, or escalate larger design conflicts. This reviewer is read-only and must not modify code.
---

# Review PR

Use this repo-specific skill for read-only review of one PR and its current head SHA.

## Read First

- `AGENTS.md`
- `.github/release-train.json`
- `docs/development-guideline.md`
- `docs/features/README.md`
- PR description, diff, checks, review threads, and linked issues

Use the PR and Feature index to identify the affected long-lived Feature and linked architecture sections. Read only those documents and directly relevant evidence. If the PR explicitly continues an already-confirmed Active legacy plan without a Feature document, also verify that named plan, the affected current root contracts it references or the touched domains require, and that the diff stays within its original scope; do not load every Feature, every architecture document, or all historical plans.

## Boundaries

- Reviewer is read-only: do not edit code, push commits, update branches, close issues, merge, or perform admin/bypass actions.
- Review against the current release train and current PR head SHA. If head changes, redo the review.
- Do semantic review. Do not approve only from path allowlists, and do not escalate to human only because a diff is large or touches a risky area.
- If risk can be resolved with missing evidence, request information before escalating to human.
- Existing valid approval on the same head SHA should be treated as review evidence; merge readiness remains merge-gate's responsibility.
- Local CI evidence is optional and must not block review or approval. Evaluate focused validation and current-head GitHub checks without treating `local-ci:passed:v2` as required merge evidence.

## Documentation Sync Review

For product changes, review three surfaces separately:

1. Product behavior: verify the canonical Feature's user behavior, input/output, states, errors, tests, and Change status against the PR head.
2. Architecture invariants: verify affected linked architecture sections for ownership, dependency, security, tenant/data scope, transaction, concurrency, audit, negative tests, and rollback against the PR head.
3. Fact ownership: apply the “would the rule still exist if this Feature were deleted?” test. A fact has one canonical owner; Features link architecture definitions instead of copying them.

If one request changes both product behavior and an architecture invariant, require both documents to move together. Block review when only one owner is updated, an architecture invariant is defined only in a Feature, user behavior is misplaced in a general architecture document, or code contains an undocumented behavior change.

## Domain Risk Focus

- Backend: authentication, authorization, tenant/project scope, transactions, migration safety, external failures, and worker idempotency.
- Frontend: permission-dependent views, loading/error/empty states, route access, destructive actions, API contracts, and compact layouts.
- Extraction, OCR, review, export, benchmark, and object storage: stable paths, reproducible outputs, large-asset boundaries, and accidental local-cache or production-service dependencies.
- CI/CD, Supervisor, stg, and prod: target environment, deploy path, smoke, and rollback; server-side edits never replace the release flow.
- `release/**`, `main`, and agent configuration: release-train roles and canonical Agent/symlink structure.

## Cross-Layer Contract Review

- Do not review a frozen contract in only one file or layer. Trace representative facts through
  `database state -> Java query/transaction -> HTTP DTO -> React consumer`, and verify executable tests cover the same path.
- Every ordered collection must name its authoritative ordering source. A DAG must be presented by dependency topology,
  never by `created_at`, task ID, insertion order, or frontend hard-coding.
- Tests for ordering and selection must use adversarial fixtures: equal timestamps, deliberately reversed identifiers,
  parallel branches, missing or cross-run dependencies, and cycles where applicable.
- When one anti-pattern is found, search its equivalent uses in state aggregation, node presentation, current-task selection,
  output selection, and retry/cancel targeting before classifying the finding.
- Treat reviewers as a backstop after the migration contract has executable coverage; do not accept separate mocked layers as
  proof of an end-to-end compatibility contract.

## Review Outcomes

Use one clear outcome: approve current head, comment, request info, request changes, needs human, or skip waiting for CI/head freshness. Report `needs human` directly to the requester or maintainer with the unresolved decision and evidence. Findings should focus on correctness, security, tenant isolation, data integrity, migration safety, deployment risk, performance regressions, and missing validation.

## Validation

Run or inspect focused checks only when needed for the review conclusion. Report exactly what was verified and what remains unverified, including the current head SHA and relevant GitHub checks. Do not turn review into a repair task.
