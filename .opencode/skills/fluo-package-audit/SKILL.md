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
- **cli**: `cli`, `studio`, `testing`, `vite`

For `/search-to-issue all`, the command harness must expand `packages/*/package.json` public packages once, currently 41 packages, and must not treat `core` or any other package as a representative sample. The full package set must be split into batches of 4 packages, and every package must receive exactly these three read-only auditor invocations: `fluo-package-contract-api-reviewer`, `fluo-package-architecture-reviewer`, and `fluo-package-tests-edge-reviewer`.

## Label Allowlist (Strict)

Only the following labels should be used when drafting or creating issues:
- **priority**: `priority:p0`, `priority:p1`, `priority:p2`
- **area**: `area:foundation`, `area:request-pipeline`, `area:auth`, `area:http-runtime`, `area:infra-messaging`, `area:protocol-adapters`, `area:cli`, `area:persistence`
- **type**: `bug`, `enhancement`, `documentation`, `performance`, `tech-debt`, `type:maintainability`
- **scope**: `scope:security`, `scope:nestjs-parity`
- **wave**: `wave:1`, `wave:2`, `wave:3`
- **source**: `source:package-audit` (Required for all audit findings)

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

## Issue Draft Constraints

- **Unit of Issue**: Default to one issue per package.
- **Cross-Package Issues**: Only allowed if the root cause and fix theme are identical across multiple packages.
- **User Approval**: Audit findings must be presented as drafts and require explicit user approval before registration as GitHub issues.
