# Native `$search-issue` workflow

This workflow owns discovery through issue registration and handoff. The common
run ledger is authoritative; native goal and todo state are user-facing
projections of it.

## Intake

Intake is a mode-first state machine. Values explicitly supplied with the
leading invocation count as answered; begin at the first missing state. Each
state is one structured question asked through the runtime's structured
question tool (`ask_user_question` in the current OMO runtime); the lead waits
for the returned answer and branches on it before the next state. Only the
lead calls the tool; intake is never delegated to a subagent. The tool accepts
at most four questions per call and four options per question, so a catalog is
split across questions of one call — or, only when one call cannot hold it,
across consecutive calls — offering every entry exactly once. When the runtime
does not expose the tool, use the numbered plain-text fallback of each state
instead of claiming or calling an unavailable tool.

1. `target_mode`
   - Ask only whether the target is all packages, one or more package groups, or
     one or more direct packages.
   - Structured: one single-select question whose options come from
     `node scripts/intake.mjs modes`, the Korean label as the option label and
     the catalog description as the option description.
   - Fallback: show numbered plain-text choices.
2. `package_scope`
   - `all` resolves every package and needs no follow-up.
   - `group`: present every package group as multi-select chips in one call,
     split across questions of at most four options each; the Korean group
     name is the label and the group description plus member packages form the
     description.
   - `package`: present every package as multi-select chips paginated over
     consecutive calls of at most sixteen options each until every package has
     been offered exactly once; the public `@fluojs/*` name is the label and
     the owning group name is the description.
   - On the structured path the populated option descriptions are the
     user-facing presentation; echoing the stdout table is not required. On the
     fallback, first render the complete package-group/package table from
     `node scripts/intake.mjs packages`. Bash output may be collapsed in OMO:
     copy every table row into the user-facing response immediately before
     asking; an ID-only list is not a valid substitute. Ask for one or more
     visible names, selection numbers, or canonical slugs as comma-separated
     text, and never expose an unexplained internal ID. A bare token that
     names both a group and package is ambiguous and must be clarified, not
     guessed.
   - Resolve the immutable package list through
     `node scripts/intake.mjs resolve <mode> [selection...]`, passing the
     selected labels or slugs — the union across that state's questions — as
     the selections.
3. `purposes`
   - Structured: present every purpose as multi-select chips in one call split
     across questions of at most four options each; the Korean purpose name is
     the label and the purpose description plus its reviewer slugs form the
     description.
   - Fallback: render the complete purpose/description/reviewer table from
     `node scripts/intake.mjs purposes`, copy every rendered row into the
     user-facing response immediately before asking, and never rely on
     collapsed tool output or omit the descriptions. Ask for one or more
     visible purpose names, selection numbers, or canonical slugs as
     comma-separated text.
   - Resolve the response through
     `node scripts/intake.mjs resolve-purposes [selection...]`.

Never open with a free-form request for package names or purpose memory. Empty,
cancelled, or unsupported answers stop before repository discovery, goal
creation, todo creation, ledger creation, reviewer tasks, or GitHub access.
Every structured ask waits for the returned answer before the next state; on a
timeout result, re-ask that state once, and on a second timeout stop
fail-closed before any state creation.

An explicit leading `$search-issue` invocation records
`explicit_harness_invocation: true`. If the user explicitly requests
investigation only, also record `investigation_only: true`; otherwise it is
false and triage-approved drafts are automatically registered.

## Scope and ledger

After valid intake:

1. Read `domain.json`.
2. Resolve public package names and group membership once.
3. Never expand the immutable package list later.
4. Create a run goal containing scope, purposes, read-only reviewer boundary,
   registration authority, and create-lane non-goals.
5. Create the full ledger under
   `.omo/search-issue/runs/<run-id>/ledger.json`.
6. Mirror each expected invocation into native todo using the stable key
   `package:<package>/reviewer:<reviewer>`.

Use `read`, repository listing tools, or `git ls-files` for preflight evidence
discovery. Do not use `find`, `xargs`, broad shell pipelines, redirection, or
`-exec`.

The ledger states are `intake`, `running`, `triage`, `registering`,
`published`, `completed`, and `blocked`. Each invocation transitions from
`expected` to `started` to `completed`, `failed`, or `blocked`.

### Executable ledger commands

Every real transition uses `node .agents/skills/search-issue/scripts/run.mjs`.
Pass `--root <repository-root> --out <run-directory>` to every command.
The run directory must be inside that root; it contains `ledger.json`.
Commands acquire an exclusive run lock and save validated transitions atomically.
Concurrent writers fail rather than racing registration.

Initialize with `init --input <intake.json>`:

```json
{
  "run_id": "search-example",
  "repository": "fluojs/fluo",
  "authority": {
    "explicit_harness_invocation": true,
    "investigation_only": false
  },
  "intake": {
    "scope_mode": "package",
    "packages": ["runtime"],
    "purposes": ["tests-edge"]
  }
}
```

This accepts resolved intake without scenario, reviewer results, or fake issue
numbers. The synthetic runner remains gated by `--fixture-only`.
Both paths use `createLedger`, native invocation transitions, `createDrafts`,
`assertLedger`, and `registerLedger`; both persist the same ledger schema.
The ledger binds its immutable intake, authority, repository and run identity.
Invalid stored state blocks every command before the next stage or GitHub access.

## Native reviewer waves

Build the reviewer set by taking the ordered union of selected purpose routes
from `domain.json`. Create one task per package/reviewer pair.

- Read `reviewers/common.md` and the selected specialist reference.
- Route with the native task category from `domain.json`.
- Use a self-contained prompt with `TASK`, `DELIVERABLE`, `SCOPE`, `VERIFY`,
  and `STOP WHEN`.
- Dispatch each wave through exactly one native `task` batch call containing
  every independent invocation in that wave, with `run_in_background: true`.
  Do not call reviewers in the foreground or serially.
- Wait for every task in one wave to become terminal before starting another.
- Reviewers return typed JSON and never write the ledger.

The lead validates every result against `reviewer-contract.schema.json` and
reconciles expected versus completed invocation IDs. Missing or malformed
results block finding intake.

If the native `task` tool or background batch mode is unavailable, mark the run
`blocked` and stop. Never delete, skip, complete, or synthesize an invocation
without its returned native task ID and terminal typed envelope.

After each native background dispatch, record
`start --invocation <package:.../reviewer:...> --task-id <native-task-id>`.
Collect its terminal envelope with `collect --input <result.json>`.
Envelopes must match `reviewer-contract.schema.json` and the exact started
invocation. Duplicate, malformed, wrong-package, wrong-reviewer and wrong-type
results fail closed. `drafts` advances only after every invocation completed.
These commands record native task evidence and preserve the background wave rules.

## Finding intake and drafts

Keep `audit_finding` and `rd_brief` records separate. Deduplicate findings by
package, evidence, problem theme, contract impact, and affected surfaces.
Compare viable drafts with open GitHub issues before triage.

Default to one issue draft per package. Bundle packages only when root cause,
fix theme, contract impact, and ownership are identical. Assign stable draft
IDs `D1`, `D2`, and so on in immutable scope order.

Draft bodies contain:

- context and selected audit purposes
- evidence-backed findings or eligible feature briefs
- contract impact and affected surfaces
- preserve-contract resolution direction
- affected packages
- why the issue should be acted on now

Attach `pkg:<package-slug>` and the package's `package_area` label from
`domain.json` for every affected package. For a bundle, deduplicate the union
of those labels. Do not label every package merely because it was audited.
The group keys, `package_area`, and allowed `area:*` labels must agree;
every catalog package must have an allowed `pkg:*` label.

Draft construction deduplicates by package, evidence, problem theme, contract
impact, and affected surfaces. It keeps R&D records separate and includes only
briefs with `issue_eligibility: register` in drafts. IDs follow immutable package
order and are reproducible on resume. Priority is the highest severity among
all included findings, regardless of reviewer record order. The executable
path keeps drafts package-local; it does not infer cross-package bundles.

## Registration triage

After all drafts are stable, run exactly one native task using
`reviewers/registration-triage.md`. It returns one `register`, `defer`, or
`reject` decision for every draft.

The triage task is read-only. The lead alone owns registration:

- require explicit harness authority
- skip all registration in investigation-only mode
- register only `register` decisions
- reject labels outside `domain.json`
- require the affected package and group labels on every registering decision;
  triage may adjust issue classification but must not drop package ownership
- confirm those labels exist in the repository before `gh issue create`;
  missing labels block registration, never create an unlabeled substitute
- never publicly register security-sensitive or support-only drafts
- execute `register` after `triage --input <decisions.json>` stores exactly
  one decision per stable draft
- use the shared registration path to record each exact issue number and URL
- stop on the first failed or malformed creation receipt

`decisions.json` is the triage reviewer's array of records, each containing
`draft_id`, `decision`, `reason`, `labels`, `duplicate_of`, `safety_route`,
and `confidence`. Registering decisions retain highest priority, ownership,
issue classification, and `source:package-audit` labels. A security label or
security/support route blocks public registration.

Registration reuses valid local receipts without creating anything. For drafts
without receipts it checks repository labels and looks up the exact durable
body marker bound to repository, run and stable draft. A single matching remote
issue recovers its number and URL; no match permits creation. Failed, truncated
or ambiguous lookup and malformed receipts block creation with a saved reason.
Each receipt is saved before the next draft. A crash after GitHub succeeds but
before the save is reconciled on resume. All confirmed run receipts, including
recovered and previously saved ones, drive publication and registered counts.

## Publication and handoff

After registration, use `run.mjs publish` with the same root and run directory.
When at least one confirmed receipt exists, this calls the existing publisher:

```text
node .agents/skills/search-issue/scripts/publish-search-artifact.mjs \
  --root <primary-repository-root> \
  --run-id <search-run-id> \
  --issues <comma-separated-created-issue-numbers>
```

The helper validates a safe run ID, unique positive issue numbers, repository
containment, symlink safety, and exclusive same-filesystem publication. It
creates the v2 identity at `.omo/search-issue/artifacts/<run-id>.json`. The
`sha256` is the digest of the canonical JSON identity fields (`version`,
`artifact_id`, `search_run_id`, and `selected_issues`) before the digest field
is inserted:

```json
{
  "version": 2,
  "artifact_id": "search:search-run-id",
  "sha256": "<64 lowercase hexadecimal characters>",
  "search_run_id": "search-run-id",
  "selected_issues": [4101]
}
```

Emit `$create-lane .omo/search-issue/artifacts/<run-id>.json`. Do not emit
or retain an active `.opencode` handoff.

When zero issues are created, create no search artifact and report
`search_run_id: none`.

Resume reuses an existing identical v2 artifact and never overwrites it.
A different artifact or a symlink blocks completion. The independently exported
`publishSearchArtifact` helper retains its exclusive-publication behavior.

### Interruption and recovery

Use `block --reason <nonempty-reason>` to persist an explicit interruption.
`resume` selects the last available stage from preserved results, drafts,
triage and receipts. It never changes an invocation from `expected` or `started`
to `completed`. Correct missing or malformed native results through collection
after resume; terminal blocked results remain terminal evidence. Resolve named
blockers before resuming. An invalid ledger is left untouched.

## Final report

Report scope, purposes, invocation counts, P0/P1/P2 findings, feature briefs,
dedupe results, draft mappings, triage counts, registered/deferred/rejected
issues, artifact path or `none`, and the native `$create-lane` handoff.
