# Shared diagnostics migration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-diagnostics.ko.md"><kbd>한국어</kbd></a></p>

## Scope

[`@fluojs/diagnostics`](../../packages/diagnostics/README.md) owns shared data declarations and wire readers. Runtime lifecycle, Studio presentation, CLI transport and feature status policies are not transferred. Existing public imports are retained, so no source or artifact migration is mandatory.

## Imports

New consumers should install readers with `pnpm add @fluojs/diagnostics` and import shared types without runtime implementation or Studio UI. Type-only usage may use a development dependency.

```ts
import { parseStudioPayload, type PlatformStatusSnapshot, type StudioRouteDescriptor } from '@fluojs/diagnostics';
import type { PlatformHealthReport } from '@fluojs/diagnostics/platform-contract';
import type { StudioLiveEvent } from '@fluojs/diagnostics/studio-contracts';
```

| Existing path | This release |
| --- | --- |
| Platform*, BootstrapTiming*, RuntimeDiagnostics* from `@fluojs/runtime` | Retained; re-export shared declarations |
| Producer types from `@fluojs/runtime/devtools` | Retained; required producer route fields remain required |
| Studio types from `@fluojs/core/internal` | Retained; re-export diagnostics declarations |
| Readers/types from `@fluojs/studio` | Retained; readers are diagnostics facades, filters/Mermaid remain Studio-owned |
| Feature package status types | Retained; shared reports/ownership and feature-owned details/lifecycle |
| `@fluojs/studio/contracts` | Previously removed and not restored; use Studio root or diagnostics |

## Artifacts and support

Do not rewrite version-1 report/live/timing, raw snapshots, standalone timing or snapshot-plus-timing envelopes. Optional wire route graphNodeId/kind/params differ from required parsed defaults. Shared validators retain acceptance/rejection semantics and never treat malformed timing as omitted. Partial sidecar ingress/unknown payload and recursive privacy validation are not replaced with the complete wire validator.

Diagnostics is portable and depends on neither host builtins nor runtime/Studio implementation. Studio Node `>=24.0.0 <27`, CLI Node `>=24.11.0 <27` and runtime's omitted package-wide engines remain unchanged. Runtime shutdown, resource ownership and transaction execution are unchanged.

## Verification

The diagnostics README owns full ownership/default/failure/privacy contracts. Runtime producer round-trips are in `packages/runtime/src/diagnostics-conformance.test.ts`, CLI report round-trips in `packages/cli/src/cli.test.ts`, isolated declarations/imports in `packages/diagnostics/src/portable-boundary.test.ts`, and existing consumer fixtures in `packages/studio/src/contracts.test.ts`.

The existing Book `ch18-cli-and-studio` retains the same artifact learning path and is connected to diagnostics in `book/series.json`. No chapter prose changes are needed because wire and execution semantics remain unchanged.
