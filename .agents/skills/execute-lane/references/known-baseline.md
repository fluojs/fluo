# known-baseline

Run commands from the repository root; resolve reference paths relative to this file.

### Authenticated known baseline before publication

The lead may register a confirmed common baseline only for explicitly related
lane issues with `set-fact --kind known-baseline --issue <related-issue> --value
'<record-json>'`. `../scripts/known-baseline.mjs` authenticates version 1 records:
`{version,id,issues,failure,companion,adjudication}`. Both checks bind
`{head,command,sources,conditions,test_source,log,receipt}`; file references are
`{path,sha256}`. Sources, immutable conditions and test source name committed
bytes at each exact head. Logs and receipts name nonempty artifacts under the
observation root. Receipts bind
`{version,head,command,completed,signal,status,exit_code,log_sha256,source_sha256}`.
`source_sha256` hashes `JSON.stringify({sources,conditions,test_source})`.
The completed failure has a positive exit code; the companion has exit code 0.
Both use the same command, conditions and unchanged test source. A companion
changes related source, not assertions, scope, retries or timeouts.

Adjudication is `{authority:"lead",cause:"confirmed-common-baseline",
failure_head,companion_head,reason}` bound to both checks. Reviewer claims,
UNKNOWN causes, watcher timeouts and historical retrospective event labels
are not admission evidence. Invalid admission leaves the lane file unchanged.
The README companion example requires actually running
`pnpm vitest run tooling/governance/runtime-matrix-docs-contract.test.ts`
at the companion checkout and retaining all 17 PASS results with command,
head, test-source and raw-log digest binding.

Fresh publication observation reauthenticates admitted artifacts and compares
current committed source, conditions and test bytes. It returns `still-failing`,
`fixed`, `different-source-or-conditions` or `insufficient-evidence` with exact
comparison evidence. Missing or altered admitted proof blocks preparation;
it is never silently treated as no record. An applicable identical failure
returns canonical `fix-back` in the existing branch/worktree/PR. Different or
insufficient evidence blocks publication for lead adjudication. No record,
unconfirmed siblings and unrelated main advances add no integration requirement.
This observation neither executes tests nor automatically integrates a companion.

Companion application stays inside the accepted preflight and ownership boundary;
scope expansion returns to preflight. The approved base stays pinned. A changed
head requires affected focused checks and new selected exact-head reviews before
creating or pushing the same PR; earlier review, local evidence and remote CI PASS
do not transfer. Merge still requires full exact-head canonical GitHub CI,
mergeability and authority. Independent implementation, review and CI stay
parallel; this gate does not serialize branches or impose automatic full local CI.
