# Native workflow trust boundaries

## Trusted lead, untrusted claims

The authenticated lead and repository owner's filesystem are trusted. Child
reports, persisted facts, issue bodies, and GitHub observations are inputs to
validate, not permission to perform arbitrary operations. This workflow does
not defend against an owner rewriting code, credentials, and history together.
Digests detect substitution and stale evidence; they are not signatures.

## Stage boundaries

- Preflight reads issue and contract evidence; the lead accepts its scope and
  review policy. An implementer cannot reduce review axes or redefine acceptance.
- Implementers edit only the assigned worktree and run focused tests. They
  cannot push, mutate PRs, merge, or operate another stage.
- Reviewers read one exact checkout and supplied evidence. They do not write
  source, run local CI, or mutate GitHub.
- After review passes, the lead runs local CI and binds its receipt to the same
  head and accepted contract. Failed or stale evidence cannot publish a PR.
- PR synchronization, merge, and cleanup remain separate lead-owned actions
  subject to lane identity and user-granted authority.

The lead independently observes changed paths and reconciles preflight scope
before review. Unknown, mixed, or enforcement changes require all axes.
Missing, duplicate, malformed, unexpected, or stale reviewer envelopes cannot
produce PASS. Selected-axis PASS is not a merge grant.

The sole cross-head review exception is CLI-authenticated explanatory-document
retention. Full policy/floor/digest stay fixed; contract is fresh. Both authored
path sets and merge-bases, the authored head delta, all non-prose raw blob
SHA-256/modes and original canonical PASS must match. Instructions, governance,
generated and machine-read Markdown are excluded. Caller claims, incomplete
coverage or uncertain Git cannot reduce review. Optional stored retention
preserves original identities, heads and acceptance time; each nested hop is
validated and Git-reauthenticated. Preparation independently verifies fresh
dispatch and complete current-head evidence. Local-check/waiver and remote CI
never carry forward; generated integration and merge authority gates remain.

## Resume and observations

The v4 engine derives decisions from a small lane file plus fresh git/GitHub
observations. It does not use DAG records, task/session ownership, or a native
run identity as execution authority. A changed head invalidates checks and
requires fresh review except for authenticated retention above; a changed
contract invalidates evidence tied to its former digest.
The lead re-observes identity before remote writes and reconciles partial remote
success before retrying. No child report alone proves a completed side effect.

## Fixtures and historical evidence

Synthetic observations and test receipts exercise contracts only. They never
constitute production approval, live checks, or permission to mutate GitHub.
Historical event/DAG schemas may remain for reading prior artifacts; they are
not required by the active execution engine. Runtime state remains under
`.omo/` and must not be loaded from the read-only OpenCode archive.
