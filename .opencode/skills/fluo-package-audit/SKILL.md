---
name: fluo-package-audit
description: fluo package audit knowledge pack. Captures package groups, label allowlist, finding schema, and issue draft constraints.
compatibility: opencode
metadata:
  language: en
  domain: audit
  mode: knowledge
---

# Fluo Package Audit

This skill provides the knowledge required for performing structured package audits within the fluo repository.

## Package Groups

Audits should categorize packages into the following functional groups:
- **foundation**: `core`, `config`, `di`, `i18n`, `runtime`
- **http-runtime**: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, `platform-bun`, `platform-deno`, `platform-cloudflare-workers`
- **request-pipeline**: `validation`, `serialization`, `openapi`, `graphql`, `cache-manager`
- **auth**: `jwt`, `passport`
- **infra-messaging**: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, `microservices`, `notifications`, `email`, `slack`, `discord`
- **protocol-adapters**: `websockets`, `socket.io`
- **persistence**: `prisma`, `drizzle`, `mongoose`
- **operations**: `metrics`, `terminus`, `throttler`
- **ui**: `react`
- **cli**: `cli`, `studio`, `testing`, `vite`

For `/search-issue`, all-package expansion, batching, and package-level `route_plan` creation belong to the command harness. Do not treat any package as a representative sample.

## Purpose Routing

`/search-issue` treats selected purposes as routing keys, not as prompt hints. Supported route targets:

- `bug-finding`: `fluo-package-architecture-reviewer`, `fluo-package-tests-edge-reviewer`
- `refactoring`: `fluo-package-architecture-reviewer`
- `feature-addition`: `fluo-package-feature-rd-reviewer`
- `contract-api`: `fluo-package-contract-api-reviewer`
- `architecture-boundary`: `fluo-package-architecture-reviewer`
- `tests-edge`: `fluo-package-tests-edge-reviewer`
- `docs-book-sync`: `fluo-package-docs-book-reviewer`
- `release-impact`: `fluo-package-release-impact-reviewer`
- `nestjs-migration-gap`: `fluo-package-nestjs-migration-reviewer`
- `comprehensive`: `fluo-package-contract-api-reviewer`, `fluo-package-architecture-reviewer`, `fluo-package-tests-edge-reviewer`, with specialist agents only on explicit trigger

Reviewers and R&D agents audit only their assigned single package.

## Label Allowlist (Strict)

Only the following labels should be used when drafting or creating issues:
- **priority**: `priority:p0`, `priority:p1`, `priority:p2`
- **area**: `area:foundation`, `area:request-pipeline`, `area:auth`, `area:http-runtime`, `area:infra-messaging`, `area:protocol-adapters`, `area:cli`, `area:persistence`
- **type**: `bug`, `enhancement`, `documentation`, `performance`, `tech-debt`, `type:maintainability`
- **scope**: `scope:security`, `scope:nestjs-parity`
- **wave**: `wave:1`, `wave:2`, `wave:3`
- **source**: `source:package-audit` (Required for all audit findings)

`scope:nestjs-parity` is a legacy GitHub label name only. Audit reports must not imply NestJS compatibility or one-to-one parity; phrase the finding as a NestJS migration gap or an unsupported NestJS assumption, especially around standard decorators versus legacy decorator metadata.

Package groups and GitHub `area:*` labels are not one-to-one. Map the `ui` package `react` to the existing `area:http-runtime` label because it owns HTTP-dispatched server rendering boundaries; do not create or assume an `area:ui` label.

## Finding Schema

Audit findings must include:
- `severity`: P0 (Critical), P1 (High), P2 (Medium)
- `package`: Package directory name
- `evidence`: File path and line number(s)
- `problem`: Concise description of the issue
- `contract_impact`: `none`, `doc-only`, `behavior-change`, or `breaking`
- `affected_surfaces`: Classification of required updates across `package`, `docs`, `book`, and `examples`.
- `docs_book_impact`: `none`, `needs-check`, `docs-required`, `book-required`, or `docs-and-book-required`
- `purpose_alignment`: `primary`, `secondary`, or `unrelated-critical`
- `preserve_contract_fix`: Contract-preserving fix direction
- `contract_change_needed`: Whether a contract change is needed and why

Feature R&D routes must return `rd_brief` records instead of audit findings:

- `package`: Package directory name
- `purpose`: `feature-addition`
- `user_problem`: User or developer problem the feature would solve
- `evidence_basis`: README/docs/current limitation/open issue evidence
- `current_surface`: Current API/docs behavior
- `recommended_option`: Minimal viable direction
- `contract_impact`: `none`, `doc-only`, `behavior-change`, or `breaking`
- `tests_docs_release_plan`: Required tests, docs, examples, and changeset assessment
- `issue_eligibility`: `candidate`, `defer`, or `reject`
- `anti_speculation_reason`: Required when eligibility is `defer` or `reject`

## Issue Draft Constraints

- **Unit of Issue**: Default to one issue per package.
- **Cross-Package Issues**: Only allowed if the root cause and fix theme are identical across multiple packages.
- **R&D Escalation**: `rd_brief` outputs become issue drafts only after documented gap evidence and must still pass registration triage. Speculative enhancements stay deferred.
- **Registration Triage**: `/search-issue` must send draft issues through `fluo-package-issue-registration-reviewer` before any GitHub issue creation.
- **No Unsafe Registration**: Duplicates, security-sensitive reports, support/usage questions, low-confidence P2 findings, speculative feature ideas, and label mismatches must be `defer` or `reject` instead of registered.
