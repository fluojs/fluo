# #3913 local diagnosis: adapter-only optimization not justified

## Binding and result

- Worktree: `/Users/ayden/Documents/fluo/.worktrees/issue-3913`.
- Branch: `issue-3913`; starting and final HEAD: `1a17fc4fb6d2e0e3cde2a02c0b7049c1f8bd3f18`.
- Input: `/Users/ayden/Documents/fluo/.omo/verification/3913-implement-input.json`.
- Accepted preflight: `f92d84680db084a1902339c3ec4da75afdeb63a08fa766f30bc839e82856fd86`.
- `assertIssueImplementInput` and `assertIssueImplementIdentity` passed against the observed clean initial checkout.
- Outcome: causal/scope blocker evidence, not a completed implementation Result.
- No package source changes, Changeset, commit, remote writes, load or profile captures.
- Only this report, a bounded diagnostic script and its raw log were created under the accepted results directory.

The stage schema has no failed/blocked Result variant. No `result: "completed"` object is returned because the head is unchanged and no optimization has passed focused package checks.

## Native observations

Command (exit 0):

```sh
cd /Users/ayden/Documents/fluo/.worktrees/issue-3913
set -o pipefail
deno run --allow-net tooling/benchmarks/http-comparison/results/issue3913/deno-close-diagnosis-20261008T2315.mjs 2>&1 | tee tooling/benchmarks/http-comparison/results/issue3913/deno-close-diagnosis-20261008T2315-run1.log
```

Actual runtime: Deno 2.9.7, V8 `15.0.245.2-rusty`, TypeScript 6.0.3. Five finite network requests and one constructed pre-aborted Request were checked. Readiness, native delivery completion, peer abort and stream cancellation were subscribed before their triggers and bounded by failure deadlines; there are no sleeps.

| Controlled case | Before response | After native completion |
| --- | --- | --- |
| Untouched native Request | signal cache unmaterialized | closed-unmaterialized |
| Read method, URL, headers and body presence only | signal cache unmaterialized | closed-unmaterialized |
| Read `request.signal` | materialized | aborted, native `AbortError`, same signal identity |
| Clone and read POST body, then read original | materialized; original remained readable until its own read | aborted, native `AbortError`, same signal identity |
| Disconnect TCP peer after first streaming bytes | abort listener subscribed before disconnect | native `AbortError`, same identity; response stream cancel observed |

The constructed pre-aborted Request preserved its original reason object. That case is not a request delivered through Deno.serve or a Fluo dispatch test.

The diagnostic-only `Deno[Deno.internal].getCachedAbortSignal` observer does not materialize `request.signal`. It is version-dependent and fails closed if unavailable; it is not a proposed production dependency. Native runtime code was not patched or instrumented. The script is a mechanism/correctness probe, not a CPU/allocation profiler.

Deno itself emitted the retained warning that successful responses abort `request.signal` in legacy mode. No runtime flags or configuration were changed.

## Causal source evidence

Official version-pinned sources read:

- https://raw.githubusercontent.com/denoland/deno/v2.9.7/ext/fetch/23_request.js
  - SHA-256 of fetched source: `6c12910b0c2aa1e746a000ab718769b42a411b91f28ce93686c0a31499562ba3`.
  - Lines 327-351: the lazy signal getter creates and caches a signal and registers the native cancel callback; both closed-request access and cancellation construct `DOMException`.
  - Lines 665-668: public `Request.signal` invokes that getter.
  - Lines 680-686: `Request.clone()` materializes the source signal to create its dependent clone signal.
  - Lines 868-876: `abortRequest` constructs `DOMException("The request has been cancelled.", "AbortError")` when the signal cache is materialized; otherwise it marks the cache false without constructing it.
- https://raw.githubusercontent.com/denoland/deno/v2.9.7/ext/http/00_serve.ts
  - SHA-256 of fetched source: `d98ee7db1c9195c92b8515fe519c48e94877c10f74da5ddb9b79909596f5105e`.
  - Lines 207-230: `InnerRequest.close` resolves/rejects completion and invokes `abortRequest` on successful responses in legacy mode.
  - Lines 505-510: immediate/native request-close helpers invoke `innerRequest.close()`.
  - `finishOrReturnNative` starts at line 924 and uses the response-close path.

Together with the finite native probe, these sources establish that signal materialization enables Deno's normal-completion DOMException path. They do not establish absolute cost, exception count per Fluo request, independent server capacity or a performance improvement.

The existing `bottleneck-map.json` and `REPORT.md` both exist in this checkout and were read. The preserved Fluo Deno DOMException self shares remain 18.7691% and 19.7884%; the native recapture had zero sampled DOMException leaves. These are CPU sample shares, not allocated-object counts or exclusive framework time. No retained BEFORE/AFTER record was removed, replaced or relabeled.

## Exact implementation boundary

Both Deno adapter paths delegate to the shared Web runtime:

- `packages/platform-deno/src/adapter.ts`: managed `handle` calls `startWebRequestDispatch` and retains drain release until `dispatch.completion`.
- `packages/platform-deno/src/fetch-handler.ts`: host-owned handler calls `dispatchWebRequest`.
- `packages/runtime/src/web.ts:392`: shared dispatch eagerly passes `rawResponse: request.signal`.
- `packages/runtime/src/web.ts:335`: factory retains the supplied signal.
- `packages/runtime/src/adapters/request-response-factory.ts:54`: shared dispatch eagerly obtains the signal, passes it to `createRequest`, and checks `signal.aborted` in its error path.
- `packages/runtime/src/web.ts:527-545`: framework request shell stores the eagerly supplied signal.
- `packages/runtime/src/web.ts:509`: default body reading clones the original unless the contractual opt-in says otherwise. Native clone itself materializes the signal.

The adapter has no option that prevents the shared dispatch from reading the native signal while preserving native signal identity/reason. Replacing it with a fresh signal, suppressing abort, modifying the native Request getter, bypassing shared dispatch or returning a response before the established readiness/completion boundary would not be an evidence-backed safe optimization.

The Bun header hotspot belongs to `packages/runtime/src/web.ts` and exclusively to #3911. Bun already opts into `consumeOriginalBody: true` for both managed and host-owned factories (`packages/platform-bun/src/adapter.ts:231,439`). No duplicated Bun/shared fix or blanket Deno clone removal is proposed.

## Owner handoff, not an implementation patch

The concrete candidate boundary for #3911/lead evaluation is `packages/runtime/src/web.ts` plus `packages/runtime/src/adapters/request-response-factory.ts`: determine whether internal eager signal plumbing can be made lazy without replacing the native signal or losing cancellation, pre-abort/error handling, multipart cleanup and request-scope disposal. The body clone path remains a separate contractual materialization source.

This is a design candidate requiring owner edits and renewed boundary validation, not a validated patch. A safe adapter-only patch was not found; supplying executable speculative code would contradict the task. Shared Workers/Next callers must be included if this seam is changed, as the accepted contract requires.

Minimal lead-owned causal capture protocol:

1. Keep default Deno 2.9.7 flags and the same host/runtime/source provenance. Do not opt out of legacy abort to make samples disappear.
2. Compare two otherwise identical native callbacks with the same callback arity, async shape and status/body/headers: untouched Request versus one `request.signal` access. Keep body-bearing clone/read as a separately labeled condition. Avoid conflating Deno's zero-argument handler fast path with signal access.
3. Collect serving-process CPU profiles and uninstrumented controls using the existing approved protocol in the exclusive measurement slot. Inspect DOMException ancestry and preserve all failed captures. This implementer ran none of these captures.
4. Only after an owner-produced, contract-preserving candidate exists, compare exact clean Fluo BEFORE/AFTER with native controls. A lower sample share alone is not issue acceptance.

## Verification limits and retained state

`git diff --check` passed; HEAD is unchanged. Only results evidence is untracked.

The initial runtime availability command printed Deno 2.9.7 and Bun 1.4.2, then exited 1 at `test -d node_modules`: this worktree was not provisioned. That is not a failing package test. No installs/builds were needed for the dependency-free native diagnosis.

Package builds/typechecks, Vitest, actual Bun adapter suites, actual Deno Fluo adapter suites, release/governance gates and BEFORE/AFTER acceptance were not run. No package change exists to validate; the requested causal/scope stop condition was reached first. The successful Deno mechanism probe is not represented as either Bun or Fluo native conformance.

The attempted LSP document-symbol query returned `null is not an object (evaluating 'symbols.length')`; exact shared locations above were established by bounded source reads and literal lookup, not by a successful LSP result.
