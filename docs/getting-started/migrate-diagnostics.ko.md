# Shared diagnostics migration

<p><a href="./migrate-diagnostics.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

## Scope

공유 데이터 선언과 wire reader의 소유자는 [`@fluojs/diagnostics`](../../packages/diagnostics/README.ko.md)입니다. Runtime lifecycle, Studio presentation, CLI transport, 기능별 status 정책은 이전하지 않습니다. 기존 public import를 제거하지 않으므로 필수 source 또는 artifact migration은 없습니다.

## Imports

새 consumer는 runtime 구현이나 Studio UI 없이 `pnpm add @fluojs/diagnostics`로 reader를 설치하고 공유 타입을 import하세요. 타입만 사용하면 개발 dependency도 가능합니다.

```ts
import { parseStudioPayload, type PlatformStatusSnapshot, type StudioRouteDescriptor } from '@fluojs/diagnostics';
import type { PlatformHealthReport } from '@fluojs/diagnostics/platform-contract';
import type { StudioLiveEvent } from '@fluojs/diagnostics/studio-contracts';
```

| 기존 경로 | 이번 릴리스 |
| --- | --- |
| `@fluojs/runtime`의 Platform*, BootstrapTiming*, RuntimeDiagnostics* | 유지; 공유 선언 재노출 |
| `@fluojs/runtime/devtools`의 producer type | 유지; required producer route field 유지 |
| `@fluojs/core/internal`의 Studio type | 유지; diagnostics 선언 재노출 |
| `@fluojs/studio`의 reader/type | 유지; reader는 diagnostics facade, filter/Mermaid는 Studio 소유 |
| 각 기능 package의 status type | 유지; 공유 report/ownership과 feature-owned details/lifecycle |
| `@fluojs/studio/contracts` | 이전에 제거된 경로이며 복원하지 않음; Studio root 또는 diagnostics 사용 |

## Artifacts and support

Version 1 report/live/timing, raw snapshot, standalone timing, snapshot-plus-timing envelope는 재작성하지 않습니다. Optional wire route의 graphNodeId/kind/params는 parsed 결과의 required default와 다릅니다. 공통 validator는 기존 거부·수용 의미를 유지하며 malformed timing을 생략으로 간주하지 않습니다. Sidecar의 부분 ingress/unknown payload와 recursive privacy 검증은 완전한 wire validator로 대체하지 않습니다.

Diagnostics는 host builtin과 runtime/Studio 구현에 의존하지 않는 portable package입니다. Studio Node `>=24.0.0 <27`, CLI Node `>=24.11.0 <27`, runtime의 package-wide engines 생략은 그대로입니다. Runtime shutdown, resource ownership와 transaction 실행에는 변경이 없습니다.

## Verification

소유권·기본값·실패·privacy의 전체 계약은 diagnostics README를 따릅니다. Runtime 생산자 round-trip은 `packages/runtime/src/diagnostics-conformance.test.ts`, CLI report round-trip은 `packages/cli/src/cli.test.ts`, isolated declaration/import는 `packages/diagnostics/src/portable-boundary.test.ts`, 기존 consumer fixture는 `packages/studio/src/contracts.test.ts`로 확인합니다.

Book의 기존 `ch18-cli-and-studio`는 같은 artifact 학습 경로를 유지하며 `book/series.json`에 diagnostics를 연결합니다. Wire나 실행 의미가 바뀌지 않아 chapter 본문 변경은 필요하지 않습니다.
