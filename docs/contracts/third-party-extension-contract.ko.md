# Third-Party Extension Contract

<p>
  <strong>한국어</strong> | <a href="./third-party-extension-contract.md">English</a>
</p>

이 문서는 fluo와 맞닿는 runtime surface를 노출하는 제3자 adapter, integration package, extension module의 계약을 정의합니다.

## Required Interface

| Extension surface | Current source contract | Required rule |
| --- | --- | --- |
| Official platform packages | `docs/reference/package-surface.md`, `docs/architecture/platform-consistency-design.md` | `@fluojs/platform-*`로 게시되는 패키지는 저장소 정책이 `PlatformAdapter`라고 부르는 seam을 반드시 구현해야 합니다. 현재 HTTP transport stack에서는 `@fluojs/http`의 `HttpApplicationAdapter`로 이 요구사항을 충족합니다. |
| HTTP listener adapters | `packages/http/src/adapter.ts` | 어댑터는 `listen(dispatcher)`와 `close(signal?)`를 반드시 구현해야 합니다. `getServer?()`와 `getRealtimeCapability?()`는 선택 사항이지만, 노출할 경우 문서화된 capability shape를 보존해야 합니다. |
| Request and response mapping | `packages/http/src/adapter.ts`, `packages/http/src/types.ts`, `docs/architecture/platform-consistency-design.md` | 어댑터는 host-native input을 `FrameworkRequest`와 `FrameworkResponse`로 변환한 뒤 제공된 `Dispatcher`에 실행을 넘겨야 합니다. 이 과정에서 request-phase ordering, response commit semantics, streaming contract를 바꾸면 안 됩니다. |
| Runtime-managed platform components | `packages/runtime/src/platform-contract.ts`, `packages/runtime/src/types.ts` | `platform.components` 아래에 등록되는 확장은 `validate()`, `start()`, `ready()`, `health()`, `snapshot()`, `stop()`을 포함하는 `PlatformComponent`를 구현해야 합니다. validation, readiness, health, snapshot payload는 문서화된 report shape를 따라야 합니다. |
| Module-style integrations | `packages/core/src/metadata.ts`, `packages/email/src/module.ts` | 재사용 가능한 registration API를 노출하는 패키지는 `forRoot(options)`와 `forRootAsync({ inject, useFactory })` 같은 명시적 module entrypoint를 제공해야 합니다. export되는 token과 option object는 typed 상태를 유지하고 명시적으로 드러나야 합니다. |
| Decorator and metadata extensions | `packages/core/src/metadata/shared.ts`, `packages/http/src/decorators.ts` | metadata를 쓰는 확장은 TC39 decorator context metadata와 namespace가 있는 `Symbol.for(...)` key를 사용해야 합니다. 임의 전역 대신 `@fluojs/core`의 shared metadata symbol boundary를 사용해야 합니다. |

## Prohibited Patterns

- 확장은 `experimentalDecorators` 또는 `emitDecoratorMetadata`를 요구하면 안 됩니다.
- 패키지 내부 구현은 `process.env`를 직접 읽으면 안 됩니다. 설정은 explicit option, DI, 또는 application boundary의 `@fluojs/config`를 통해 들어와야 합니다.
- 어댑터는 framework 동작을 host-native request 또는 response type에 직접 결합하면서 `FrameworkRequest`, `FrameworkResponse`, `Dispatcher`를 우회하면 안 됩니다.
- 확장은 `@fluojs/http`, `@fluojs/di`, `@fluojs/config`, `@fluojs/runtime`가 소유한 route syntax, DI resolution rule, configuration loading rule, lifecycle ordering을 재정의하면 안 됩니다.
- metadata writer는 third-party state에 `fluo.standard.*` 또는 `fluo.metadata.*` 같은 fluo 소유 key를 재사용하면 안 됩니다. `Symbol.for('fluo.<package>.<purpose>')` 형태의 package-scoped key를 사용해야 합니다.
- governed public surface에 속한 패키지는 TSDoc 없는 public export를 배포하면 안 됩니다.
- registration은 import-time side effect로 수행하면 안 됩니다. 호출자는 explicit bootstrap 또는 module registration API를 통해 opt in 해야 합니다.

## Versioning Obligations

- 문서화된 fluo contract에 의존하는 public third-party package는 자신의 published surface에 semantic versioning을 적용해야 합니다.
- module option shape, exported token 이름, adapter capability field, lifecycle ordering, shutdown semantics, readiness behavior, 문서화된 error behavior 변경은 contract change로 취급됩니다.
- `0.x`에서는 breaking contract change를 minor release에서만 배포할 수 있고, `CHANGELOG.md`에 소비자 대상 업그레이드 요구사항을 포함해야 합니다.
- `1.0+`에서는 breaking contract change를 major release로 배포해야 합니다.
- 확장이 문서화된 behavior를 바꾸면 implementation, tests, README 내용, contract-facing evidence를 함께 갱신해야 합니다.
- 확장이 official publish surface를 대상으로 하거나 official platform compatibility를 주장한다면 `docs/contracts/release-governance.md`와 `docs/contracts/behavioral-contract-policy.md`에 문서화된 release 및 governance check를 계속 만족해야 합니다.

## Registration Protocol

| Registration concern | Required protocol |
| --- | --- |
| Static module configuration | 확장에 하나의 명시적 root-level configuration shape가 있을 때 `forRoot(options)`를 노출해야 합니다. provider를 export하기 전에 필수 입력을 검증해야 합니다. |
| Async module configuration | 설정이 DI 또는 runtime lookup에 의존할 때 `forRootAsync({ inject, useFactory })`를 노출해야 합니다. 해석된 option은 downstream provider가 소비하기 전에 memoize하거나 normalize해야 합니다. |
| Scoped or feature registration | 패키지에 별도의 scoped contract가 있을 때만 `forFeature(...)` 또는 `register(...)`를 사용해야 합니다. `forRoot(...)` 의미를 여러 이름으로 중복 노출하면 안 됩니다. |
| Token export | 확장 소유 service와 option에 대해 이름 있는 symbol 또는 typed token을 export해야 합니다. `fluo.email.options`, `fluo.queue.options` 같은 package-scoped `Symbol.for(...)` key 패턴을 따라야 합니다. |
| Runtime adapter registration | HTTP adapter는 `FluoFactory.create(rootModule, { adapter })`를 통해 등록해야 합니다. validation, readiness, health, diagnostics, shutdown orchestration에 참여하는 platform-owned infrastructure는 `platform.components`로 등록해야 합니다. |
| Provider exposure | 호출자가 소비해야 하는 service, channel, token만 export해야 합니다. container registration은 top-level import evaluation이 아니라 module factory 또는 bootstrap option 내부에 두어야 합니다. |
