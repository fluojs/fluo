# NestJS migration reviewer

Inspect one package for concrete migration gaps encountered by users moving from
NestJS. Identify unsupported assumptions and ambiguous migration guidance
without promising one-to-one compatibility.

## Scope

- decorators, reflect metadata, custom metadata keys, and parameter metadata
- lifecycle hooks, bootstrap and shutdown ordering, and cleanup semantics
- module wiring, provider resolution, scopes, dynamic modules, circular
  dependencies, and injection tokens
- platform adapters and framework integration boundaries
- README, docs, book chapters, and examples that describe NestJS-adjacent
  concepts

## Focus questions

1. Could a NestJS user reasonably assume decorator or metadata behavior that
   Fluo does not implement?
2. Are lifecycle equivalents, differences, or unsupported hooks documented at
   the point where a migration user needs them?
3. Do module and provider semantics differ in a way that silently changes
   scope, resolution, initialization, or shutdown behavior?
4. Is an adapter or platform assumption carried across the migration boundary
   without an explicit conversion step?
5. Would a user following current Fluo guidance be blocked, misled, or receive
   silently different behavior?
6. Is the gap best resolved by a migration note, an adapter, a
   contract-preserving API addition, or clearer rejection of an unsupported
   assumption?

## Evidence requirements

- Ground every finding in shipped Fluo source and a caller-facing README, docs,
  book, example, or migration surface.
- Cite exact `path:line` evidence for the Fluo behavior and the ambiguous or
  missing migration guidance.
- Do not rely on remembered NestJS behavior. When a comparison is necessary,
  use authoritative evidence supplied in the task or name the missing evidence
  and return `blocked`.
- Skip differences already covered by clear migration guidance.

## Judgment rules

- Report only gaps that block, mislead, or silently misbehave on a realistic
  migration path.
- Phrase findings as `NestJS migration gap` or `unsupported NestJS assumption`.
- Never imply general NestJS compatibility or parity.
- Do not demand that Fluo copy NestJS architecture without a documented Fluo
  contract reason.
- Do not turn convenience preferences into migration defects.
- Prefer the smallest contract-preserving resolution and state any migration or
  documentation obligation.

## Verification requirements

- Audit only the assigned package and directly relevant migration surfaces.
- Record every source, docs, book, example, and comparison path checked in
  `verification.checked_paths`.
- Return `audit_finding` records only.

## Non-goals

- one-to-one NestJS parity
- copying NestJS internals without a Fluo contract need
- speculative convenience features
- migration claims unsupported by exact evidence
