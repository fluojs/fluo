# Startup attestation: cumulative backing storage correction

This local increment fixes startup hashing allocation, not a framework
optimization or performance-acceptance result. Accepted preflight:
`39f027ef2d9a77990f496b1e3fc7ed3c9d08682cab7fc3d4ce79e178ae7ba81e`.
Starting head: `c2fca69685b26ad8352118e163bdb5055a3cd065`.

## Root cause and change

The previous 64 KiB stream bound limited individual hash inputs but allocated
new backing storage for successive file chunks. The existing exact-digest
regression remained green despite this cumulative allocation.

The bootstrap now reuses one 64 KiB buffer across all artifact and executable
reads. Hash updates remain synchronous; only bytes actually read enter the
digest, and each descriptor closes in `finally`. Startup finishes before the
application starts. No HTTP hook, timer, inspector or runtime dependency is added.

The existing regression now observes backing ArrayBuffers using a WeakSet and
checks both positive observation and the cumulative 64 KiB bound, alongside
the unchanged exact-digest and individual-input assertions.

## Captured checks

All root-relative logs below are under `.omo/verification/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Deterministic RED before implementation | exit 1; cumulative 121,912,120 bytes exceeds 65,536 | `3914-hash-backing-red-20261010.log` |
| Node actual hashing observation | 1,862 backing stores / 121,912,120 bytes before; one store / 65,536 bytes after | `3914-hash-backing-store-probe-20261010.log`, `3914-hash-backing-store-green-20261010.log` |
| Bun 1.4.2 actual hashing observation | 946 backing stores / 61,884,840 bytes before; one store / 65,536 bytes after | `3914-hash-backing-store-bun-corrected-20261010.log`, `3914-hash-backing-store-green-20261010.log` |
| macOS Node 24.20.0 harness | 168 passed, 0 failed; typecheck and changed-file Biome passed; exit 0 | `3914-hash-backing-green-20261010.log` |
| Canonical Linux Node timing/identity regression | 11 passed, 0 failed; exit 0 | `3914-hash-reuse-linux-20261010.log` |
| Real host finite HTTP and ordinary identity | 10/10 authenticated, no invalid attempts, no measured/warmup errors; exit 0 | `3914-hash-reuse-identity-20261010.log` |

Real host coverage comprises native/Fluo Node, Bun, Deno, Next App and Next Pages.
The raw identity receipt is `hash-reuse-identity-20261010.json` beside this report.
Actual Deno 2.9.7 validates the executable/artifact digests and serving HTTP path;
the allocation observer itself was exercised on Node and Bun, not Deno.
Linux uses its existing Linux-dependency checkout with the edited source/tests
read-only mounted. These checks precede the commit and retain source identities.
Source/test LSP checks and `git diff --check` reported no errors.

The first Bun diagnostic intercepted no calls because replacing the default
crypto object did not replace Bun's named export. Its zero counters were invalid,
not zero allocation. The corrected diagnostic explicitly intercepts the named
export and rejects zero binary observations; both original and corrected logs
remain preserved.

## Acceptance limits

Cumulative backing bytes are not live heap or RSS. This fix does not establish
the cause of the earlier native Bun RSS offset or prove an RSS improvement.
All historical INCONCLUSIVE records, frozen stability limits and regression
budgets remain unchanged. No full performance matrix was repeated here.

Workers' direct-native identity path does not import this bootstrap; its prior
exact-code local correctness evidence stands. Actual deployed Workers and the
complete performance matrix remain open. Full remote CI and final exact-head
reviews are not claimed by this report.

Only private benchmark source, its existing tests and this report change.
No public package content, API, dependency, README or release metadata changes;
there is no Changeset release payload.
