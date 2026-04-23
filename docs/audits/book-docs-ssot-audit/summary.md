# book-docs-ssot-audit-summary

## Summary Metadata
- Summary path: `docs/audits/book-docs-ssot-audit/summary.md`
- Source report order: `beginner` -> `intermediate` -> `advanced`
- Source reports:
  - `docs/audits/book-docs-ssot-audit/beginner.md`
  - `docs/audits/book-docs-ssot-audit/intermediate.md`
  - `docs/audits/book-docs-ssot-audit/advanced.md`
- Derivative-only note: `This summary indexes existing part-report metadata and accepted canonical titles only. It does not add new findings, verdicts, or rewritten adjudication.`

## Cross-Part Rollup
- Part count: `3`
- Part order confirmation: `beginner` -> `intermediate` -> `advanced`
- Snapshot SHA set: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Total assigned chapters: `66`
- Total accepted finding count: `34`
- Total chapter-status counts: `mixed=16`, `real_issue=2`, `insufficient_ssot=48`, `false_positive=0`, `no_issues=0`

## Part Index

### Part 1, `beginner`
- Report path: `docs/audits/book-docs-ssot-audit/beginner.md`
- Execution order slot: `1`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Assigned chapter count: `22`
- Accepted finding count: `34`
- Aggregate chapter status counts: `mixed=16`, `real_issue=2`, `insufficient_ssot=4`, `false_positive=0`, `no_issues=0`
- Accepted canonical title index:
  - Title: DI example uses the wrong injection surface for the current contract
  - Title: Default CLI scaffold tree does not match the current starter artifacts
  - Title: First-run verification checks the wrong default route and payload
  - Title: Provider chapter still teaches @Injectable() as the provider-registration contract
  - Title: DI flow claims fluo auto-wires constructor types
  - Title: Decorator overview treats @Injectable() as a canonical fluo class decorator
  - Title: Routing chapter still relies on removed @Injectable() and implicit constructor DI
  - Title: Routing chapter teaches parameter-decorator input binding outside the documented handler contract
  - Title: Validation chapter keeps the removed @Injectable() provider marker in the service example
  - Title: Validation chapter mixes @RequestDto() with an undocumented multi-parameter handler signature
  - Title: Exception chapter still documents legacy ExceptionFilter and ExceptionHost APIs
  - Title: Exception chapter teaches per-handler catch() filter control that the current docs do not expose
  - Title: Interceptors chapter still uses @Injectable() and implicit constructor DI in the logging example
  - Title: Interceptor chapter teaches Nest-style `ExecutionContext` and `next.handle()` contracts instead of the documented fluo chain
  - Title: OpenAPI chapter anchors the setup on the wrong bootstrap and output route contract
  - Title: OpenAPI chapter documents unsupported Swagger UI customization hooks as first-party contract
  - Title: Config chapter still teaches @Injectable() and constructor type inference for ConfigService consumers
  - Title: Config chapter teaches process.env access patterns that violate the documented snapshot contract
  - Title: Prisma chapter states the wrong transaction-context entrypoint and lifecycle contract
  - Title: Transaction chapter teaches interceptor and current() import surfaces that do not match the current transaction contract
  - Title: JWT chapter teaches outdated JwtPrincipal claim names and verifier error surfaces
  - Title: JWT chapter shows a guard that returns the wrong unauthorized error contract
  - Title: Passport chapter documents the wrong guard and interceptor phase ordering
  - Title: Throttler chapter teaches a response-header contract that does not match the current docs
  - Title: Cache chapter documents cache backends and APIs beyond the published contract
  - Title: Cache chapter teaches invalidation methods that are not part of the documented cache surface
  - Title: Health chapter documents a Terminus route contract that does not match the current readiness surface
  - Title: Health chapter overstates Terminus ownership of shutdown and indicator orchestration
  - Title: Metrics chapter documents built-in metric series beyond the published observability contract
  - Title: Metrics chapter teaches Prometheus registration and customization APIs that the docs do not publish
  - Title: Testing chapter teaches `createTestingModule()` as a unit-test helper instead of the documented integration surface
  - Title: Testing chapter treats HTTP app testing as a helper-level contract broader than the documented test surface
  - Title: Production chapter teaches runtime-specific bootstrap and adapter swapping with the wrong API surface
  - Title: Production chapter overstates built-in production hardening and deployment guarantees beyond the docs

### Part 2, `intermediate`
- Report path: `docs/audits/book-docs-ssot-audit/intermediate.md`
- Execution order slot: `2`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Assigned chapter count: `26`
- Accepted finding count: `0`
- Aggregate chapter status counts: `mixed=0`, `real_issue=0`, `insufficient_ssot=26`, `false_positive=0`, `no_issues=0`
- Accepted canonical title index:
  - None. See `docs/audits/book-docs-ssot-audit/intermediate.md` metadata: `0 accepted findings currently remain in this intermediate report`.

### Part 3, `advanced`
- Report path: `docs/audits/book-docs-ssot-audit/advanced.md`
- Execution order slot: `3`
- Snapshot SHA: `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`
- Assigned chapter count: `18`
- Accepted finding count: `0`
- Aggregate chapter status counts: `mixed=0`, `real_issue=0`, `insufficient_ssot=18`, `false_positive=0`, `no_issues=0`
- Accepted canonical title index:
  - None. See `docs/audits/book-docs-ssot-audit/advanced.md` metadata: `0 accepted findings currently remain in this advanced report`.

## Recurring Across Parts
- Normalization rule: only accepted findings with a traceable recurring root cause across multiple part reports qualify here; shared wording alone is insufficient, and original part/chapter findings remain authoritative.
- Current recurring groups: `0`
- Current snapshot result: No recurring accepted finding is traceably supported across `beginner`, `intermediate`, and `advanced`.
  - Evidence: `docs/audits/book-docs-ssot-audit/beginner.md` contains the current accepted finding set; `docs/audits/book-docs-ssot-audit/intermediate.md` metadata records `Accepted finding count: 0`; `docs/audits/book-docs-ssot-audit/advanced.md` metadata records `Accepted finding count: 0`.
- Merge guard note: beginner-only theme repetition stays in the original part report and is not promoted into a cross-part recurring group unless a matching accepted finding with compatible canonical-title theme and traceable evidence appears in another part report.

## Verification Hooks
- Part indexing check: grep for `### Part 1, \`beginner\``, `### Part 2, \`intermediate\``, and `### Part 3, \`advanced\`` in this file.
- Snapshot check: grep for `Snapshot SHA:` and confirm all three part sections point to the frozen part reports.
- No-invention check: compare the `Accepted canonical title index` entries here against `- Canonical Title:` lines in `docs/audits/book-docs-ssot-audit/beginner.md`; intermediate and advanced intentionally remain `None`.
- Recurring traceability check: read `## Recurring Across Parts` and confirm it references the original part reports instead of rewriting accepted findings.

## Global Validation
- Validation scope: `docs/audits/book-docs-ssot-audit/runbook.md`, `docs/audits/book-docs-ssot-audit/beginner.md`, `docs/audits/book-docs-ssot-audit/intermediate.md`, `docs/audits/book-docs-ssot-audit/advanced.md`, and this summary file.
- Citation completeness: `PASS` — `34` accepted findings were scanned and every accepted finding retains both `Book:` and `Docs:` citations; `intermediate` and `advanced` explicitly remain at `0` accepted findings in this frozen snapshot.
- Hub-file leakage: `PASS` — no accepted finding or global-validation line promotes navigation hubs or part-table-of-contents files as audited surfaces.
- Korean-docs authority leakage: `PASS` — no accepted finding or global-validation line cites non-English docs as authority.
- Non-contract review leakage: `PASS` — no out-of-scope review concern was promoted into a global finding; the accepted findings remain contract/evidence based.
- Overall verdict: `PASS` — the final markdown artifacts preserve citation completeness and exact audit scope at snapshot SHA `1a0cbd5606a3b5f4e08e0a3cd9d3f748ec77c9e2`.
