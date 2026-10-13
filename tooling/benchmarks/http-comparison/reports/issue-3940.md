# #3940 Bun duplicate URL parsing: finite path finalization

Status: **INCONCLUSIVE**. The accepted finite candidate-selection path stops here.
Local implementation completion is not a performance PASS, issue closure or laneDone verdict.

## Verdict and measurement scope

The parent completed **240/240** same-source A/A records with the Windows desktop
WSL2 Bun 1.4.2 SERVER and an independent Mac Node v24.20.0 HTTP generator.
**19 of 24 conditions** missed frozen stability or A/A equivalence limits.
There were **62,263,421** completed requests, **0** traffic failures and **0** invalid attempts.
The measured span was **12,587.852 seconds**, from `2026-10-13T05:33:44.463Z`
to `2026-10-13T09:03:32.315Z`. This is elapsed measurement span, not evidence
for a local/GitHub CI time budget. The source-bound evaluator returned exit **1**, **INCONCLUSIVE**.

Do not proceed to headroom, CPU/allocation profiles, candidate selection or BEFORE/AFTER.
There is no unchanged-design retry, outlier deletion or threshold relaxation.
Per-request duplicate URL parsing CPU/allocation cost and optimization gains remain
**NOT_ESTABLISHED**. No production runtime optimization is adopted; existing handoff/Web contracts remain.

## Identity and original evidence preservation

- Branch/worktree: `issue-3940` / `.worktrees/issue-3940`.
- Starting HEAD: `ce70426f3bf29430c4eb941f8e94baaf8f78d364`.
- Accepted preflight: `b06012382c0f87357321ef621761e4884995d799b0121c71f1fd2341ef9a5bdb`.
- Server: `DESKTOP-VLEUB8O`, Bun `1.4.2`, `192.168.0.10:33919`.
- Generator: `mac-mini.local`, Node `v24.20.0`.

Relative to the benchmark root, preserve `results/issue-3940/frozen-windows-01.json`,
`aa-windows-01.json`, sibling `aa-windows-01.json.shards/`, logs and Windows
build/prior-policy/identity inputs unchanged locally. The parent authoritative
verdict and archive are under repository-relative
`.omo/verification/http-performance-3939-3943-20261013-1a832301/` as
`aa-3940-windows-01-verdict.json` and `aa-3940-windows-01.tar.gz`.
Archive SHA256: `9f2f3dcee4be81014fa241df5872a565f0a8fead01111f8281952746b6325a23`.
Raw matrices/shards/logs/bundles/dist/caches are not committed.

Manifest file SHA256: `8ef9f910aa9681a44c1e848d4aa96d538b42181081bffc0b44a7c3873e6d731f`.
Index file SHA256: `5e15223eebf3d09b2a89d9acfda63a9d99d05bc5508b6b82853a183b5f272c21`.
Original source/build/runtime/host/network/transport/generator/lockfile identities
remain in the frozen manifest and originals. Do not relabel them as measurements
of the final commit. Offline readEvidence/evaluate revalidation read all 240 shards
and matched the parent verdict exactly, with **0** new timing runs.

## Frozen policy and storage contract

`design-windows-server.json` retains 6 workloads × default/equivalent × connections 1/64,
five samples per arm, 10-second warmup, 40-second measurement and fixed paired order.
Throughput CV 3%, A/A throughput and CPU/request 3%, p95/p99/RSS 5%,
minimum 10,000 requests and CPU resolution multiple 100 remain unchanged.
Minimum candidate hit throughput/CPU gain of 5% and all regression limits also
remain unchanged. Those criteria are not current optimization adoption evidence.

Historical `design.json` SHA256 `940409518cdde1c589eefb8dc2c0f0b99c6a6bc5d5b2128177e6cd7d05d99285`
and current policy SHA256 `891d93388ed849630340ab23791600217af22da4d51fd072c1994217b0bbb145`
are preserved. Only the preflight binding differs between policies.
Earlier Mac-server/WSL-generator preparation and the interrupted 12/132-record
Node headroom diagnostic with 57%–128% gains are not Windows performance evidence.
#3939 headroom **NOT_ESTABLISHED** (132 records, 4/22 mean gains >3%) remains
storage-size reference data, never Bun calibration.

`storage.mts` retains immutable compact JSON originals and a bounded index binding
ordinal, byte count and SHA256. It avoids a whole-cohort JSON string, but the
evaluator restores individual originals in memory; the individual string limit remains.
Commit `plan.mts`, `gates.mts`, `generator.mts`, storage and both design policies
as clean-checkout import companions.

## Focused verification and regression improvement

The earlier shorter '{}\n' tampering hit the byte-count guard first.
The new test leaves the original reference/index intact, changes only a nonce in
equal-byte-length valid JSON and specifically asserts `shard original hash` failure.
Removing only the hash-comparison line produced **RED**, exit 1,
`Missing expected exception`. Storage was restored exactly to SHA256
`1b9b5a2d704286587a6027338aafbf59dec905447aa3146b092661621a0049f4`.

After restoration, inherited UTF8 plus issue tests were **38/38 GREEN**, exit 0.
Benchmark typecheck and relevant Biome lint exited 0; MTS TS-stdin lint produced
byte-identical output. Source/storage/test LSP diagnostics were empty and git diff --check passed.

Preserve the historical 38-pass/typecheck/lint/bundle receipt. Harness,
plan/gates/generator/storage and the shared collector retain their recorded source
hashes; the changed issue test is revalidated by the new GREEN run.
Inherited `traffic.ts`/`traffic-utf8.test.mts` hashes and both package test hashes remain.
Earlier focused Vitest 266-pass, adapter 75-pass and six canonical Bun workload
correctness-only probe records are not a new performance PASS.

The historical full benchmark suite had **458 passed, 2 failed, 1 skipped**, exit 1.
Retain finite child JSON ENOENT failures in unchanged `tests/paired-ab.test.mts:193`
and `tests/paired-node.test.mts:381`; no base-only reproduction was performed.
The parent's preserved follow-up `results/issue-3940/benchmark-tests-adjudication.log`
records **465 passed, 0 failed, 1 skipped**, exit 0, for `pnpm --ignore-workspace test`.
Repository-relative `.omo/verification/http-performance-3939-3943-20261013-1a832301/adjudication-3940.json`
binds that recheck and a two-family reproduction with **24 completed children, 0 failed**,
exit 0, to preparation HEAD `ce70426f3bf29430c4eb941f8e94baaf8f78d364`.
The original failures did not recur. Concurrency pressure remains a hypothesis;
the precise original child exit reason is unavailable because those tests removed
their per-child evidence. Retain both the original failures and completed follow-up.
This historical recheck is not an exact-head receipt for the final companion commit
or a performance PASS. No new broad suite or full local CI ran during local finalization.

## Local handoff

Bounded receipt: `results/issue-3940/finalization-receipt.json`.
The new local commit contains private harness tooling, directly relevant regression
tests, machine companions and this EN/KO report pair. No public package
runtime/API/contract/shipped-content change requires a Changeset under
CONTRIBUTING.md internal/test-only exception. No Book/package README edit is needed.

Issue-owned `results/issue-3940/.gitignore` ignores logs, generated collector bundles
and `paired-repro/` without deleting originals or hiding authored MTS/design/receipt companions.
The parent owns canonical exact-head focused receipts after the companion commit,
independent contract/code/verification reviews and publication.
No remote writes, issue closure, laneDone, merge or cleanup occurred.
