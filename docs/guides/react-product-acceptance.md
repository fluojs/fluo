# React product acceptance

The [product contract](../contracts/react-fullstack-product.md) governs the
HTTP-first React application framework. The official example and generated
`react-vite-ssr` starter compose its shipped HTTP, typegen, `Link`, `useForm`,
provider, development and deployment paths. The integration fixture is not
a new router, transport, cache or authentication framework.

## Integrated fixture

Open `/catalog/session`, choose **Login A** or **Login B**, then
**Authenticated products**. `/catalog/session/products` provides authenticated
list/search/detail and create/update/delete. Validation retains editable
input; native submission uses POST/303/GET, while negotiated enhanced
submission keeps saved and follow-up approval results distinct. Logout
revokes protected content and old continuations; relogin reads actual
process-local persisted changes. A permission refusal is 403 with the demo
identity retained, not a logout.

The existing public `/catalog`, editor-cookie `/catalog/login`,
`/catalog/background`, `/products` and admin demonstrations retain their
contracts. The new companion reuses the same catalog/session composition.
`catalogSession`, demo permissions and the fixed CSRF token illustrate HTTP
ownership, not production authentication. The map is process-local demo
persistence, not durable or per-user database storage.

The jukebox shell still owns its operational MessageChannel/resource.
HTTP-approved navigation, transient failures and obsolete work are tested
with actual operation/acknowledgement and mount/cleanup observations.
Authentication teardown, document reload, tab close and OS discard remain
explicit lifetime boundaries.

## Matrix and execution are separate

[`product-acceptance-matrix.json`](../../examples/react-vite-ssr/tests/product-acceptance-matrix.json)
contains 20 mandatory journey rows. Each records success/failure/cancellation,
framework/application owner, source/test paths, prerequisites, implementation
classification and actual surfaces. Shipped source classification is not an
execution PASS. The receipt consumer requires actual command exits, complete
browser reports, authenticated raw artifacts and current source/head identity.
Missing, skipped, failed or source-only execution cannot pass a mandatory row.

Third-page authoring runs in the sealed packed consumer. It changes only a
page component and HTTP handler/DTO, plus optional links in that page. The
existing typegen writes the projection. Its inventory records authored and
generated files, lines/hashes, the two product compositions and no manual
renderer/entry/manifest/store wiring. Positive compilation and real
native/enhanced HTTP round trips accompany rejected input/props/saved data,
invalid/duplicate routes and missing modules.

## Focused evidence commands

Provision the required source closure freshly before packaging. Final runtime
evidence must use a clean committed implementation checkout, not source dist
borrowed from another checkout. Each output directory below must be a new
absolute directory; retain failed/partial attempts.

```sh
node --test tooling/ci/react-product-acceptance.test.mjs
node --test examples/react-vite-ssr/tests/reliability-handoff.test.mjs
node tooling/ci/react-product-acceptance.mjs capture tooling "$TOOLING_OUTPUT"
node tooling/ci/react-product-acceptance.mjs capture starters "$STARTER_OUTPUT"
node tooling/ci/react-product-acceptance.mjs capture soak "$SOAK_OUTPUT"
```

`tooling` uses the canonical focused source/compiler checks, separately built
ordinary and fault production entries, and the existing three-engine
reliability harness. Ordinary and fault builds overwrite the same server
output, so run them sequentially. `starters` reuses the existing full locked
cold-dev sandbox matrix and packing driver; it also executes the packed
consumer's real React/CSS/syntax/server/shared/config edits, native/enhanced
product journeys and independent production A/B deployment. The explicit
driver entry is:

```sh
FLUO_PRODUCT_ACCEPTANCE=1 FLUO_BACKGROUND_EVIDENCE="$PACKED_OUTPUT" \
  node examples/react-vite-ssr/tests/verify-background-starter.mjs
```

It does not replace full canonical CI or authorize remote operations. The
existing CI `starters` and `tooling-1` tasks produce domain receipts and raw
artifacts through the same commands. Domain completion is not whole-product
completion; normal CI does not collect historical benchmarks or enable Frida.

The executable consumer interface is:

```sh
node tooling/ci/react-product-acceptance.mjs \
  examples/react-vite-ssr/tests/product-acceptance-matrix.json \
  "$PRODUCT_RECEIPT" "$ARTIFACT_ROOT"
```

The [receipt schema](../../tooling/ci/react-product-acceptance.schema.json)
describes artifact path/digest references, executions, per-row results,
three-engine correctness, soak and historical measurement inventory. Paths
resolve inside the evidence root. Transported CI domain directories retain
their raw relative artifact paths. Browser, config, build graph, method,
source, lock and head identities belong to their authentic producer.

A `local` receipt returns `local-evidence-complete` and keeps `ci-release`
as `lead-owned-pending`; this is not a product PASS. A `final` receipt also
requires canonical three-axis exact-head review/policy evidence, the
head/contract/policy/review-bound `explicit-operator-instruction`
`local-ci-waiver`, full exact-head canonical GitHub CI and its actual product
domain artifacts. The implementer never manufactures these lead-owned facts.
For this lane, full local CI is explicitly prohibited, including after CI
configuration changes. The waiver does not waive focused failures, scope,
Changesets or remote CI.

## Numerical, stability and device limits

The operator's 2026-10-06 `whole_product_numeric_acceptance=apply` decision
makes original numerical FAIL/INCONCLUSIVE disclosed nonblocking diagnostics
for final #3879. Original budgets, peers, profiles, workloads, repetitions,
raw BEFORE/AFTER and original evaluator verdicts remain unchanged.
Authentication/validity, missing inventory, quality failure/INCONCLUSIVE,
correctness, stability, ownership/cleanup and any Fluo measured or warmup
error still block. A nonzero runtime exit is not a numerical diagnostic.

Historical client/server measurements retain their original collector and
evaluator identities and actual file hashes. Record unchanged seam
equivalence and limitations; changed integrated code does not become a fresh
historical measurement. Do not recollect solely to make numbers green.

Current functionality requires at least 1000 measured actions on each of
Chromium, Firefox and WebKit, excluding fault preparation/warmup. This lane's
approved soak profile is `lane-3886-one-hour`, at least 3600000 ms with a
complete terminal raw trace, counts, seven faults and lifecycle checkpoints.
The scheduled default remains 7200000 ms. Historical `ca5e37bb` evidence is
original-head evidence, not proof of a changed integrated app; use a fresh
one-hour run when seam equivalence is not proven.

Physical mobile/tablet is explicitly `deferred-to-3906`, never PASS.
Desktop/mobile emulation and light/dark screenshots verify the actual new
routes and error states, not physical device behavior or a new theme design.
Publication/version/changelog remain owned by Changesets and canonical
GitHub Actions.
