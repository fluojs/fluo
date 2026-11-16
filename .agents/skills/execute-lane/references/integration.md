# integration

Run commands from the repository root; resolve reference paths relative to this file.

### Generated consumer integration coordination

New create-lane plans opt into preflight overlap coordination with
`preflight_overlap: 1`. Direct `init --issue` also serves lane recovery and
omits the marker by default. Activate a new manual lane explicitly with
`init --lane-id <id> --issue <n> --preflight-overlap`; this boolean flag records 1
and grants no merge authority. Combining it with `--from-lane-v2` is rejected:
import preserves the plan's own marker presence or absence. Conflicting init
preserves the existing file byte for byte. Legacy lanes without the marker
retain the exact old decisions and observation path, including on recovery
and save. Never backfill existing lane files.

For opted-in lanes, `plan`, `plan-all` and `watch` expose `overlaps` with
the sibling issue, observed head, PR, state and sorted intersecting files.
Only two currently valid accepted preflights' explicit `predicted_files`
intersect; scope prefixes and file kinds do not alter that rule. Ready
preflights and implementations remain parallel.

For the executing lane only, `preflight_overlap: 1` also enables supplementary
`externalOverlaps` observations. `plan` exposes them in `obs`; `plan-all`,
including `--with-retro`, preserves them on every issue row. The version 1
object has `status: complete | unobservable`, `laneMatches` containing
`{ lane_id, issue, files }`, `prMatches` containing `{ pr, head, files }`, and
`unknowns` containing `{ source, subject, code }`. Files are sorted, deduplicated
exact intersections with a currently valid accepted prediction, never expanded
scope prefixes. Partial observations preserve confirmed positive matches and
use `unobservable`. An unavailable current prediction is unknown, not a complete
empty intersection.

Each fresh snapshot reads sorted immediate `.json` children of
`--root/.omo/lanes-v4/`, excluding its own file and lane identity. Normal external
v4 lanes participate with or without the marker. Discovery never locks, saves,
migrates, grants readiness or invalidates external facts. A missing directory
means no local candidates; enumeration/read failures, malformed JSON, legacy
versions, invalid marker/readiness/issue structure and symlinks escaping the
directory remain explicit unknowns. Accepted external preflights must pass the
existing canonical digest, issue number/content, pinned-base existence and
ancestry, and current merge-base-to-head scope checks. Fresh issue and linked
branch PR observations exclude only `done` issues; a merged issue with local
branch/worktree cleanup remaining is active.

Supplemental GitHub work is shared once per snapshot: at most one repository identity
call, one batch of up to 100 OPEN PRs with up to 100 files each, and one batch
for the first 50 sorted external issue candidates and their branch PR states.
Successful repository identity is reused within the process; failed identity
queries are retried on the next snapshot. PR files and external issue states are
always observed afresh, never cached across snapshots. With no valid current
prediction, supplemental GitHub calls cannot produce a comparison and are
omitted; the observation remains `unobservable`. No external lane candidates
means no issue batch. Supplementary reads and event recording run after the
readiness transaction releases its write lock, without changing its decisions
or grants.
No per-issue or per-PR supplemental calls or unbounded pagination occur.
Completeness uses `totalCount` and `pageInfo`; limits, missing or malformed
responses, GraphQL errors and command failures produce unknowns while preserving
bounded positive results. All calls use `GH_PAGER=cat`.

These observations never enter decision objects, own `observationFailures`,
readiness, priority, waits, merge, cleanup, publication, CI or review admission.
Existing decisions, sibling coordination and ancestry gates remain identical.
`watch` prints a separate `OBSERVATION issue <n>: externalOverlaps=<JSON>` row
on its first snapshot and observation changes only; external changes are not
action transitions and do not change stall or settled detection. Every next
snapshot re-observes. Marker lanes retain observations in `.omo/retros/` events
even without generated hints, never in execution ledgers. Marker-free executing
lanes retain their original output, observation and persistence paths.

`wait-preflight-overlap` replaces only a new `review` action. Before dispatching
background reviewers, wait until `plan` actually returns `review`. On marker
lanes that return, `plan-all` and each `watch` tick save a head-bound
`facts["review-readiness"] = { head, value: { policy_sha256, sequence, active } }`
before exposing a first review grant. `plan` grants only its requested issue;
`plan-all` and `watch` grant only review rows they output, never internal or
waiting rows. Replanning a current grant does not rewrite it.

The shared snapshot takes the existing SQLite write transaction around fresh
lane reading, observation, invalidation, coordination and saving. `watch`
releases it every tick, before reviewer work, CI or waiting for another tick.
This transaction protects the fact write; the fact stores neither a lock nor
a selected sibling, owner, session or lease. Legacy snapshots stay read-only.

GRANTABLE means the final coordinated decision is `review`, with a valid
accepted preflight, implementation head and successful own observation. Every
returned GRANTABLE row receives its head/policy-bound fact before output,
including rows with no overlap and a CLOSED PR or CLOSED issue.

OCCUPANT is the separate sibling selection predicate: a valid accepted
preflight, implementation head, successful own observation and an action of `review`,
`create-pr`, `push`, `wait-ci`, `wait-mergeability`, `request-merge-approval` or
`merge`, excluding CLOSED issues and CLOSED/MERGED PRs. Select occupants
greedily by valid active readiness sequence, then issue number; ungranted
occupants follow by issue number. OPEN PRs and current PASS give no priority.
A GRANTABLE row that is not an OCCUPANT reserves no place against siblings.
Existing publication and CI keep their grant. A waiting review names
only directly overlapping selected candidates, which never wait on each other.

Head or effective-policy changes and observing fix-back, conflict resolution,
blockers, failed observation, dependencies, preflight, implementation or
non-review termination deactivate the grant. A GRANTABLE non-occupant still at
`review` keeps its valid fact: unchanged re-plans neither rewrite nor renumber it,
and same-head re-observation does not deactivate it.
`record`, `set-fact` and `clear-blocker`
invalidate directly established changes in their own write transaction.
Keep inactive facts: a new grant uses the lane-wide maximum preserved sequence
plus one. Independent reviews first returned in one snapshot share a sequence.
Neither timestamps nor clock movement affect ordering. New heads and recovered
issues receive new grants rather than inheriting their former place.

Failed observations remove only that issue from occupancy and preserve its
`observation-failed`; they do not block another sibling's review. The merged
sibling ancestry gate below remains mandatory. Recompute targets on each
snapshot; `overlaps[].state` shows each sibling's pre-coordination action.
`watch` prints selected siblings and reports same-action changes to siblings,
files or overlaps, including a blocker that changes which sibling is selected.

Resolve each overlapping row's eligibility before selecting occupants. An
integration `observation-failed` or `resolve-conflict` row cannot reserve a
place or become another review's wait target. A terminated overlapping row
cannot expose an ungranted `review`: an unmerged CLOSED PR uses the existing
`pr-closed-externally` blocker, while a CLOSED issue with an OPEN PR is blocked
as `issue-closed-externally` rather than authorizing review, merge or cleanup.
Rows with no overlap retain their base decisions exactly. If an overlapping
accepted sibling preflight appears later, the terminated row takes the blocked
outcome above and its fact becomes inactive while preserving its sequence.
It holds no place against the sibling. The coordinator uses OCCUPANT for
overlap admission and shares GRANTABLE with the grant writer for returned reviews.

On marker lanes, loading validates the exact readiness fact fields before
observation or mutation: `head` and `policy_sha256` have their SHA formats,
`sequence` is a positive safe integer, and `active` is boolean. Missing,
unknown or malformed fields produce `invalid-review-readiness` with the
issue and field, leaving the ledger unchanged. A well-formed stale binding
still deactivates normally. Legacy lanes skip this validation entirely,
including when they happen to contain a malformed readiness key.

When an overlapping sibling merges, verify its actual PR `mergeCommit` is in
observed origin/base and the review head. Missing or unreadable base ancestry
fails closed. If the head lacks that commit, resolve its integration eligibility
before selecting occupants: handle `resolve-conflict` with reason
`preflight-overlap-base-integration` through the existing lead integration path,
including when the issue has no PR (the decision then omits `pr`). Merge the
specified `base` in the assigned issue worktree, run focused checks and record
`resolve-conflict` with the new `head_sha`. Existing generated-integration
receipts still apply when required. Reuse workflow-preparation's focused
receipt and exact-head review gates: raw old-head review, local evidence and
remote CI never validate the new head. Only the Git-authenticated explanatory
retention exception in `review-head` can preserve code/verification PASS;
contract is fresh, policy remains full, and every nested proof is rechecked.
Reviewers remain read-only.
Unrelated base movement alone does not request integration.

`plan`, `plan-all` and `watch` share fresh lane-wide observations. For an actual
`CONFLICTING` PR at the local head, a generated-consumer hint can defer integration
with `wait-generated-integration` while a related sibling is independently ready
to merge. The decision lists exact sibling heads and PRs. Finish those merges,
then observe again before resolving the conflict once. A missing/stale review,
pending/failing CI, unknown mergeability or missing merge authority does not make
a sibling ready. Readiness loss, a completed merge or restart releases/recomputes
the wait; no persisted dependency or waiting lock is created. Implementation
remains parallel. Hints and unrelated main advancement never force integration.
An already reviewed mergeable head with CI running remains `wait-ci`.

The accepted base stays pinned and must remain an ancestor of both current issue
head and observed base; scope remains current merge-base-to-head. Incorporating
changed generated inputs for tracked consumers or hints retained in existing ledgers
requires new-head integration evidence, not base-SHA freshness. Record `resolve-conflict` with current `head_sha` and
`generated_integration: { head, outputs, checks }`. Each output binds its surface,
canonical read-only generation command, exit code, expected-path and artifact
digests, and explicit `normalizeSourceFingerprint` choice. Expected files and
focused/browser raw-log receipts live in the issue worktree's disposable
`.omo/generated-integration/` harness. Admission executes authoritative
generation checking and verifies whole-file byte equality, normalizing only
sourceFingerprint values when required. Every focused/browser receipt binds the
new head and raw log digest. Missing, stale or tampered evidence fails closed.
All fresh required reviews and full exact-head GitHub CI must then run again.
CLI-authenticated explanatory-document retention may preserve original
code/verification PASS only when both authored path sets and their delta prove
unchanged non-prose raw blobs and modes. Changed generated output, missing or
uncertain observation requires full review. Full policy/floor/digest remain
unchanged; new focused checks, readiness invalidation, sibling ancestry,
whole generated-output validation and browser receipts remain required.
Old local-check/waiver, CI or patch-equivalence claims do not carry forward.
