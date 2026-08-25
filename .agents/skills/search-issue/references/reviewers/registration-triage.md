# Registration triage reviewer

Run once after every package reviewer is terminal, result envelopes are valid,
findings are deduplicated, and issue drafts have stable IDs. This is a
read-only central gate. The lead alone owns GitHub mutations.

## Inputs

Use only the immutable run evidence supplied by the lead:

- intake, scope decision, and completed invocation ledger
- every stable draft with its source `audit_finding` or eligible `rd_brief`
- open-issue duplicate candidates and their evidence
- the canonical label allowlist from `domain.json`
- repository label availability
- `SECURITY.md`, `SUPPORT.md`, and applicable routing policy
- release or migration context needed to judge actionability

Do not reopen package discovery or invent evidence that is absent from the
draft and ledger.

## Decision rules

Return `register` only when all conditions hold:

1. The draft has exact `path:line` evidence, or an eligible feature brief with a
   documented problem and current-surface limitation.
2. Root cause, ownership, and the requested outcome are clear enough for one
   actionable issue.
3. The draft is not a duplicate of an open issue.
4. It is safe for public disclosure and is not a support or usage question.
5. Every proposed label is canonical and currently available.
6. Confidence is `high` or `medium`.
7. The issue preserves the documented contract or makes any required contract,
   migration, docs, tests, and release impact explicit.

Return `defer` when the draft may be useful but one of these remains unresolved:

- human context or reproduction evidence
- duplicate certainty
- ownership or issue boundary
- required labels
- release, migration, security, or support routing
- low confidence with a plausible evidence-backed problem

Return `reject` when the draft is:

- a confirmed duplicate
- security-sensitive material proposed for public disclosure
- a support or usage question
- an evidence-free or speculative feature idea
- style-only cleanup without observable impact
- outside the immutable package and purpose scope
- based on a finding whose evidence or result envelope is malformed

## Record requirements

Return one `registration_triage` record per stable draft. Each record must
contain:

- the exact draft ID
- one decision: `register`, `defer`, or `reject`
- a concrete reason tied to evidence or a named missing gate
- canonical labels, or an empty label set when not registering
- the duplicate issue number when applicable
- one safety route: public issue, security disclosure, or support
- confidence

Never pair `register` with a security or support route.

## Verification

- Verify every stable draft receives exactly one decision.
- Verify no unknown or unavailable label appears on a `register` decision.
- Verify duplicate evidence against the supplied open issue rather than title
  similarity alone.
- Verify security-sensitive, support-only, evidence-free, speculative,
  style-only, and low-confidence P2 drafts are not registered.
- Verify every decision reason cites concrete evidence or names the exact gate
  that is incomplete.
- Report all ledger, draft, issue, label, security, support, and policy paths
  checked in `verification.checked_paths`.

## Mutation boundary

Do not edit files, mutate Git or GitHub state, create issues, or call
`gh issue create`. The lead may register only `register` decisions when the
ledger records explicit harness authority and `investigation_only: false`.
Missing authority, invalid labels, a non-public safety route, incomplete draft
coverage, or a malformed result fails closed before registration.

Return `result_type: registration_triage`. If required evidence is unavailable,
return `status: blocked`, name it in `stop_reason`, and do not fabricate a
decision for the affected draft.
