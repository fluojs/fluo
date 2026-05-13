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
- **foundation**: `core`, `config`, `di`, `runtime`
- **http-runtime**: `http`, `platform-fastify`, `platform-nodejs`, `platform-express`, etc.
- **request-pipeline**: `validation`, `serialization`, `openapi`, `graphql`, etc.
- **auth**: `jwt`, `passport`
- **infra-messaging**: `redis`, `queue`, `cron`, `cqrs`, `event-bus`, etc.
- **protocol-adapters**: `websockets`, `socket.io`
- **persistence**: `prisma`, `drizzle`, `mongoose`
- **cli**: `cli`, `studio`, `testing`

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
- `evidence`: File path and line number(s)
- `problem`: Concise description of the issue
- `contract_impact`: `none`, `doc-only`, `behavior-change`, or `breaking`
- `affected_surfaces`: Classification of required updates across `package`, `docs`, `book`, and `examples`.

## Issue Draft Constraints

- **Unit of Issue**: Default to one issue per package.
- **Cross-Package Issues**: Only allowed if the root cause and fix theme are identical across multiple packages.
- **User Approval**: Audit findings must be presented as drafts and require explicit user approval before registration as GitHub issues.
