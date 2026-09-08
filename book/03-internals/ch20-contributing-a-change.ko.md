# 프레임워크 변경 하나를 끝까지 제출하기

<!-- book:volume=03-internals;chapter=20 -->

[이전: 성능 주장을 실험으로 검증하기](./ch19-performance-experiments.ko.md) · [3권 목차](./toc.ko.md) · [시리즈 소개](../README.ko.md)

## 제품의 불편을 프레임워크의 변경 단위로 바꾸기

운영자는 처음에 게시글 하나를 보여주고 싶었다. 그 블로그가 독자 계정과 구독을 갖추고, 같은 사용자가 티셔츠를 사는 상점으로 자랐다. 3권에서는 주문 요청이 데코레이터, 모듈 그래프, DI, 런타임과 어댑터를 통과하는 과정을 살폈다. 이제 남은 일은 내부를 읽는 능력을 다른 사용자가 안전하게 받을 변경으로 바꾸는 것이다.

기여를 시작하는 계기는 거창할 필요가 없다. 17장의 확장 패키지를 조립하면서 아직 provider가 없는 작은 모듈에도 `@Module({})`를 반복해서 쓰게 됐다고 하자. 개발자가 원하는 사용법은 `@Module()`이다. 그러나 단순히 인수를 optional로 표시하는 것만으로 충분한가? 빈 모듈도 그래프에 등록되어야 하는가? `@Global()`과 섞이면 어떤 정보가 남아야 하는가? 이런 질문이 작은 문법 편의 기능을 실제 계약 변경으로 만든다.

이 장의 사례는 현재 `@fluojs/core`에 이미 구현된 빈 `Module` 기본값 계약을 이용한다. `Module()`, `Module(undefined)`, `Module({})`는 현재 모두 지원된다. 미해결 버그를 발견했다거나 새 PR을 제출했다고 주장하지 않는다. 완성된 소스와 테스트를 기준으로 변경을 재구성하고, 독립 학습 worktree에서 결함을 주입해 테스트의 검출력을 확인하는 실험이다. 특정 과거 커밋의 역사를 재현했다는 주장도 아니다.

기여할 때 가장 먼저 해야 할 일도 이 확인이다. 사용하던 버전의 실패가 현재 소스에서 이미 해결되었다면 같은 수정으로 빈 PR을 열지 않는다. 최소 재현으로 버전과 조건을 좁히고, 업그레이드 문제인지 누락된 회귀 사례인지 구별한다. 재현되지 않는 문제에 상상한 내부 수정을 붙이는 것보다 이미 해결된 경계를 정확히 설명하는 편이 더 유용하다.

## 한 문장을 실행 가능한 계약으로 펼친다

변경의 수용 기준은 “괄호 안의 빈 객체를 생략할 수 있다”보다 구체적이어야 한다. 인수 생략과 명시적 `undefined`는 빈 객체와 같은 모듈 metadata를 등록해야 한다. 아무 데코레이터도 없는 클래스와 구분되어야 하며, 이전에 기록된 부분 필드와 `@Global` 표시를 보존해야 한다. metadata snapshot은 보호되어야 하고 변경 버전도 갱신되어야 한다. `null`까지 자동으로 빈 객체 취급하는 범위 확장은 하지 않는다.

이 기준에는 도메인 결과가 직접 등장하지 않지만 제품과의 연결은 분명하다. 기능을 추가하기 전의 빈 module도 조립부에 명시적으로 배치할 수 있다. 설정 모듈의 provider를 먼저 기록한 뒤 빈 `@Module()`을 적용하더라도 설정이 사라지지 않아야 한다. 전역 모듈 표시가 decorator 순서 때문에 사라지면 기존 앱의 토큰 가시성이 바뀐다. 문법 변경이 기존 주문이나 게시글 서비스의 주입 실패로 번지는 경로다.

반대로 이 변경에 새로운 모듈 이름 규칙, 자동 provider 검색, 상속 정책 재설계까지 묶지 않는다. 그 일들은 별도 요구와 회귀 범위를 가진다. 리뷰어가 확인할 질문은 “인수 기본값만 추가하면서 이미 존재하는 metadata 기록 계약을 그대로 사용했는가”가 된다. 작은 diff의 가치는 줄 수가 아니라 검토할 가정의 수가 적다는 데 있다.

소유권도 먼저 고른다. 공개 decorator와 설명은 `packages/core/src/decorators.ts` 및 core README가 소유한다. metadata 병합과 동결은 `packages/core/src/metadata/module.ts`가 소유한다. 실제 조립 검증에는 `@fluojs/testing`을 쓰고, adapterless application의 부트스트랩은 runtime의 기존 회귀 테스트가 다룬다. 애플리케이션의 `src/orders`에서 우회 decorator를 만드는 수정은 문제를 framework 경계에 돌려주지 못한다.

## 첫 번째 테스트는 장식이 아니라 등록을 관찰한다

다음은 독립 학습 checkout에서 추가할 수 있는 **완전한 `packages/core/src/module-defaults.consumer.test.ts` 파일**이다. 현재 저장소의 `module-defaults.test.ts`와 의도적으로 겹치는 소비자 관점 실험이다. 실제 기여에서는 가까운 기존 테스트를 확장하고 같은 검증을 중복해서 남기지 않는다.

```ts
import { Global, getModuleMetadata, Module } from '@fluojs/core';
import { getModuleMetadataVersion } from '@fluojs/core/internal';
import { expect, it } from 'vitest';

it.each([
  { name: 'omitted', factory: () => Module() },
  { name: 'undefined', factory: () => Module(undefined) },
  { name: 'empty object', factory: () => Module({}) },
])('registers an empty module for $name input', ({ factory }) => {
  class Undecorated {}
  @Module({})
  class ExplicitModule {}
  const before = getModuleMetadataVersion();
  const decorate = factory();

  @decorate
  class EmptyModule {}

  const metadata = getModuleMetadata(EmptyModule);
  expect(getModuleMetadata(Undecorated)).toBeUndefined();
  expect(metadata).toBeDefined();
  expect(metadata).toEqual(getModuleMetadata(ExplicitModule));
  expect(Object.isFrozen(metadata)).toBe(true);
  expect(getModuleMetadataVersion()).toBe(before + 1);
});

it('keeps partial fields and both Global decorator orders', () => {
  class Marker {}

  @Module()
  @Module({ providers: [Marker], exports: [Marker] })
  class PartialModule {}

  @Global()
  @Module()
  class OuterGlobalModule {}

  @Module()
  @Global()
  class InnerGlobalModule {}

  expect(getModuleMetadata(PartialModule)).toMatchObject({
    providers: [Marker],
    exports: [Marker],
  });
  expect(getModuleMetadata(OuterGlobalModule)?.global).toBe(true);
  expect(getModuleMetadata(InnerGlobalModule)?.global).toBe(true);
});

it('does not expand the accepted input to null', () => {
  const decorate = Reflect.apply(Module, undefined, [null]);
  expect(() => {
    @decorate
    class InvalidModule {}
    return InvalidModule;
  }).toThrow(TypeError);
});
```

여기서는 `getModuleMetadataVersion`을 내부 subpath에서 읽는다. 이것은 framework-owned metadata의 invalidation을 검증하는 package 테스트라 허용되는 선택이다. 17장의 일반 확장 패키지가 이 내부 카운터에 의존해서 배포해야 한다는 뜻이 아니다. 공개 소비자에게 필요한 검증은 `getModuleMetadata`로 가능하며, 내부 증거는 내부 변경을 보호하는 테스트에 한정한다.

버전을 절대값으로 고정하지 않고 적용 직전 값에 1을 더해 비교한다. 같은 프로세스에 다른 decorated class가 있어도 테스트 순서에 기대지 않기 위해서다. 이 테스트 블록은 동기적으로 기록하고 즉시 읽는다. 공유 metadata 카운터를 다루면서 `it.concurrent`로 서로 간섭시키거나 시간을 기다리는 테스트로 만들지 않는다.

`null` 테스트는 문구를 고정하지 않고 오류 종류를 확인한다. 정상 TypeScript caller는 `null`을 넘길 수 없지만 JavaScript 또는 동적 호출 경계에서는 가능하다. `Reflect.apply`는 그 경계를 드러낸다. 목표가 생략과 `undefined`의 지원인데 모든 falsy 값을 받는 구현으로 넓어지면 이 테스트가 실패해야 한다.

현재 구현에서 이 테스트가 통과하는 것은 예상되는 상태다. 검출력을 확인하고 싶다면 **본인의 독립 학습 worktree에서만** 아래 수정의 추가 행에 있는 `= {}`를 잠시 제거하고 이 테스트를 실행한다. 생략과 `undefined` 사례가 module metadata 적용 중 실패하고 빈 객체 사례는 살아 있어야 한다. 관련 없는 import 오류나 runner 설정 실패를 RED 증거로 쓰지 않는다. 확인 뒤 기본값을 되돌리고 같은 테스트를 다시 실행한다. 이 원고 작업에서 그 결함 주입이나 테스트 실행을 수행한 것은 아니다.

## 구현은 기존 기록 경로를 다시 사용한다

기본값 미지원 상태와 현재 구현의 차이를 표현하면 다음과 같다. 이것은 **함수 서명에 대한 부분 diff**이며 파일 전체가 아니다. `StandardClassDecoratorFn`, `ModuleMetadata`, `defineModuleMetadata`는 같은 파일에 이미 존재하는 타입과 import다.

```diff
-export function Module(definition: ModuleMetadata): StandardClassDecoratorFn {
+export function Module(definition: ModuleMetadata = {}): StandardClassDecoratorFn {
   return (target) => {
     defineModuleMetadata(target, definition);
   };
 }
```

기본 매개변수는 인수 생략과 `undefined`에만 적용되고 `null`에는 적용되지 않는다. 이 언어 규칙이 수용 기준과 맞는다. `definition || {}`를 넣으면 다른 falsy 값까지 받아 의미를 넓힌다. `if (!definition) return`을 넣으면 빈 모듈 등록 자체를 생략하므로 decorated class와 undecorated class가 구분되지 않는다.

나머지는 기존 `defineModuleMetadata`가 처리한다. 이미 저장된 각 필드를 살리고 새 부분 필드만 반영하며, collection과 provider descriptor를 복제하고 snapshot을 동결한 뒤 version을 올린다. 이 경로를 우회해 특별한 빈 객체를 별도 전역 map에 저장하면 정상 모듈과 빈 모듈이 다른 수명주기를 갖게 된다. 19장의 캐시가 metadata version을 키에 쓰는 이유까지 생각하면, 빈 입력을 “아무 작업도 하지 않음”으로 바꾸면 안 된다는 점이 선명해진다.

provider의 `useValue` 객체 identity를 보존하는 기존 처리도 유지한다. 빈 모듈 기능을 추가하면서 무조건 깊은 복제를 도입하면 외부에서 제공한 sink나 어댑터 인스턴스가 달라질 수 있다. 코드가 더 깔끔해 보인다는 이유로 소유권 계약을 바꾸지 않는다. 이런 별도 수정은 새로운 실패 사례와 별도 승인이 필요한 일이다.

공개 TSDoc에는 생략 또는 `undefined`가 `{}`를 사용한다는 설명, 빈 metadata도 등록되고 이전 부분 필드와 version 갱신을 보존한다는 설명을 남긴다. 구현이 한 줄이어도 declaration 소비자는 그 동작을 소스 없이 이해해야 한다. README의 사용법과 오류 범위도 같은 뜻이어야 한다.

## 실제 모듈 조립까지 이어지는 두 번째 증거

첫 테스트는 metadata 기록을 증명하지만 모듈 그래프를 통과하지 않는다. 다음은 **완전한 `packages/testing/src/empty-module.consumer.test.ts` 파일**로 재현할 수 있는 slice다. 기존 계정이 상점의 주문을 소유한다는 관계를 작은 token으로 표현하고 빈 모듈을 같은 그래프에 넣는다. 전체 블로그나 데이터베이스가 필요하지 않다.

```ts
import { Inject, Module } from '@fluojs/core';
import { createTestingModule } from '@fluojs/testing';
import { expect, it } from 'vitest';

const CUSTOMER_ID = Symbol('CUSTOMER_ID');

it('compiles a consumer graph containing an empty decorated module', async () => {
  @Module()
  class EmptyExtensionModule {}

  @Module({
    providers: [{ provide: CUSTOMER_ID, useValue: 'reader-7' }],
    exports: [CUSTOMER_ID],
  })
  class AccountsModule {}

  @Inject(CUSTOMER_ID)
  class OrderOwner {
    constructor(readonly customerId: string) {}
  }

  @Module({
    imports: [AccountsModule, EmptyExtensionModule],
    providers: [OrderOwner],
    exports: [OrderOwner],
  })
  class OrdersModule {}

  @Module({ imports: [OrdersModule] })
  class AppModule {}

  const module = await createTestingModule({ rootModule: AppModule }).compile();
  try {
    expect((await module.resolve(OrderOwner)).customerId).toBe('reader-7');
    expect(module.modules.some((entry) => entry.type === EmptyExtensionModule)).toBe(true);
  } finally {
    await module.container.dispose();
  }
});
```

`OrderOwner`가 문자열 타입을 받는다는 이유로 주입된 것이 아니다. `AccountsModule`의 provider와 export, `OrdersModule`의 import, 클래스 수준 `@Inject`가 연결을 만든다. 이 slice에서 빈 모듈의 존재를 graph identity로 확인하므로, 빈 metadata를 없었던 것으로 처리하는 변형도 걸러낼 수 있다.

현재 runtime의 `empty-module-default.test.ts`는 adapterless application을 부트스트랩하고 route 목록이 비어 있는지, 닫은 뒤 다시 닫아도 되는지를 확인한다. 여기에 실제 주문 HTTP나 결제 호출을 추가할 이유는 없다. 변경이 decorator 기본값이라면 graph와 bootstrap의 회귀면 충분하다. 반대로 요청 파이프라인을 바꾸는 기여라면 이 slice만으로 끝내지 말고 `createTestApp({ rootModule })`의 요청 표면을 통과해야 한다.

실패한 compile의 자원 소유권도 구분한다. builder는 reference를 돌려주기 전까지 내부 container를 소유하며, compile 실패 때 정리를 수행한다. reference를 성공적으로 받았다면 위 예제처럼 호출자가 정리한다. 아직 할당되지 않은 module 변수를 `finally`에서 무조건 읽거나 성공한 경로에만 dispose를 두지 않는다. 부분 초기화 실패와 일반 종료는 각자의 근거 테스트로 보호한다.

## 검증 결과를 리뷰어가 다시 읽을 수 있게 한다

독립 학습 worktree에서 기존 근거를 실행하려면 저장소의 Node24·pnpm10 환경과 설치된 의존성을 사용한다. 다음은 **현재 존재하는 테스트 파일을 대상으로 한 명령**이다. 새 consumer 테스트를 만들었다면 그 파일도 같은 project의 대상에 추가한다. 이 장의 집필 과정에서 실행한 로그는 아니다.

```bash
pnpm exec vitest run --project packages packages/core/src/module-defaults.test.ts packages/runtime/src/empty-module-default.test.ts packages/testing/src/module.compile-failure.test.ts
pnpm --filter @fluojs/core typecheck
pnpm --filter @fluojs/core build
```

테스트는 실패한 이유와 수정 후 통과를 구별해 기록한다. 빌드는 exit code 0을 확인하며 소스 테스트 통과로 대신하지 않는다. 공개 함수 서명이 바뀌었으므로 `.d.ts`에도 optional parameter가 반영되는지 확인한다. core의 기존 build-output 테스트는 배포 entry 파일의 존재를 보호하지만 파일 존재만으로 모든 타입 호출의 의미가 증명되지는 않는다. package root에서 `Module()`, `Module(undefined)`, `Module({})`를 import하는 소비자 호출도 타입 검사 대상에 넣는다.

영향이 확정되면 package 관련 검사에서 저장소의 실제 release gate로 넓힌다. 변경한 package, runtime 조립, 문서, 배포 표면이 모두 같은 head를 가리켜야 한다. 이전 head의 녹색 CI를 수정한 head에 재사용하지 않는다. 동작 변경이 public package에 영향을 주면 로컬 단일 테스트만으로 릴리스 준비가 끝났다고 말할 수 없다.

기여 보고에는 어떤 명령이 어느 head에서 exit 0이었는지, 무엇은 실행하지 못했는지, 필요한 외부 조건이 무엇인지 남긴다. 순수 모듈 변경에서 데이터베이스를 쓰지 않았다는 것은 검증 구멍이 아니라 의도적인 범위다. 반면 public declaration을 확인하지 못했다면 명시적인 한계다. 두 종류를 같은 “대부분 통과”라는 문장으로 덮지 않는다.

## Changeset과 제출 설명도 변경의 일부다

현재 문서화된 `Module()` 계약이 깨진 릴리스를 복구하는 가상의 수정이라면 하위 호환 bug fix로 `patch`를 검토할 수 있다. 이전에 지원하지 않던 호출을 처음 공개하는 기능이라면 `minor` 판단이 필요하다. 변경이 한 줄이라는 이유로 patch가 되는 것은 아니다. 기존 소비자가 코드를 바꿔야 계속 동작하는 1.0 이상 패키지의 변경이라면 major와 마이그레이션 설명이 필요하다.

다음은 **문서화된 계약 복구라는 조건에서만 사용하는 `.changeset/empty-module-contract.md` 예시 전체**다. 현재 구현에 추가 변경 없이 이 파일만 만들어 같은 기능을 재릴리스하라는 지시가 아니다. 실제 제출에서는 확인한 baseline과 semver intent를 일치시킨다.

```md
---
"@fluojs/core": patch
---

Module 인수 생략과 undefined 입력이 빈 모듈 메타데이터를 등록하도록 문서화된 계약을 복구합니다. 기존 부분 필드, Global 표시와 메타데이터 버전 갱신을 보존합니다.
```

버전과 package changelog를 손으로 여러 군데 갱신하지 않는다. Fluo의 정식 경로는 Changesets와 `.github/workflows/release.yml`이다. 기여자는 changeset에 의도를 남기고, 버전 조정과 changelog 생성 및 게시를 canonical GitHub Actions 흐름에 맡긴다. 로컬 `npm publish`는 이 경로에 속하지 않는다.

PR 설명은 코드의 짧음을 자랑하기보다 리뷰할 계약을 앞세운다. 이 사례라면 제목은 “빈 Module 호출의 등록 계약 복구”가 될 수 있다. 본문에서는 영향을 받는 호출 세 가지, undecorated class와의 구분, 부분 metadata 및 Global 보존, null 비지원 유지, 테스트와 declaration 증거를 연결한다. 실행하지 않은 결과를 체크 표시로 채우지 않고 재현 절차와 관측된 결과를 분리한다.

재현의 예상 결과도 명시한다. 결함을 주입한 실험에서 생략·undefined 사례는 실패하고 `{}` 사례는 살아 있다. 수정 후에는 세 입력의 metadata가 같고 빈 모듈을 포함한 consumer graph가 구성된다. 그 결과는 독자가 확인할 기준이며 이 원고가 제출한 PR의 실측 결과가 아니다. 좋은 제출 설명은 이런 차이를 숨기지 않아도 충분히 구체적이다.

한국어와 영어의 package README 및 contract를 함께 유지하는 것은 일반 기여의 문서 계약이다. 이 책의 한국어 선집필 단계와 혼동하지 않는다. 책은 한국어 전체를 완성한 뒤 번역하지만 배포 API 변경의 두 언어 계약을 서로 다른 뜻으로 남길 수는 없다. 새로운 호출을 추가했다면 예제, public export 설명, declaration과 release intent가 한 변경으로 읽혀야 한다.

## 리뷰부터 사용자에게 도달할 때까지

작업은 `main`을 기준으로 별도 `.worktrees/` 안에서 수행하고 변경 목록을 확인한다. unrelated 수정, 로컬 데이터, 실험 산출물을 포함하지 않는다. 실제 기여를 위한 commit과 push, PR 생성은 그 작업의 권한 아래 수행한다. 이 장을 읽거나 이 원고를 작성했다는 사실이 저장소나 GitHub 변경을 이미 수행했다는 뜻은 아니다.

리뷰어가 다른 decorator 순서, 이전 snapshot 불변성, cached graph invalidation을 질문하면 그것을 작은 diff에 대한 과잉 검토로 보지 않는다. 모두 이 API의 호출자가 의존하는 실행 계약이다. 답은 장문의 확신보다 실패하는 변형과 통과하는 최소 테스트가 낫다. 리뷰 중 구현을 바꾸면 관련 검증을 새 head에서 다시 실행하고, 바뀌지 않은 범위까지 무조건 반복하는 대신 영향 경계를 설명한다.

병합 전에는 CI와 release metadata를 함께 확인한다. main은 stable 릴리스의 단일 경로이고 major Changeset에는 maintainer의 명시적 승인과 소비자 마이그레이션 안내가 필요하다. 버전 의도를 낮춰 승인 경로를 피하지 않는다. 병합 이후 Changesets의 Version Packages 흐름과 게시 결과가 이어지므로 PR 병합과 npm 배포를 같은 사건으로 기록하지 않는다.

사용자가 실제로 설치할 수 있는 버전이 나왔을 때는 source checkout만이 아니라 공개 package entry를 통해 같은 최소 재현을 확인한다. 문제가 남아 있으면 release 버전, Node 버전, 재현 코드와 실패 경계를 가지고 다시 조사한다. 작업 branch와 worktree 정리는 필요한 증거와 참조를 남긴 뒤 권한 있는 경계에서 수행한다. 테스트를 통과했다고 자동으로 모든 로컬 작업을 지우는 것은 제출 절차가 아니다.

이번 집필에서는 commit, push, GitHub issue·PR, 패키지 게시를 수행하지 않는다. 여기서 완성한 것은 독자가 변경 하나를 계약 정의부터 재현, 최소 구현, 검증, 버전 판단, 리뷰와 배포 확인까지 연결할 수 있는 원고다. 이미 해결된 사례를 새 성과처럼 제출하지 않는 판단도 그 과정에 포함된다.

## 세 권을 마치며

FluoBlog와 FluoShop은 끝까지 같은 제품이었다. 주문 기능을 붙인다고 사용자 계정을 새로 만들지 않았고, 성장했다는 이유만으로 처음부터 모든 모듈을 별도 서비스로 나누지 않았다. 3권에서 내부를 읽은 이유도 추상적인 프레임워크 지식의 목록을 늘리기 위해서가 아니다. 독자의 발행 요청과 고객의 주문이 어디서 해석되고, 어떤 상태를 공유하며, 실패할 때 무엇이 정리되는지 설명하기 위해서였다.

확장은 애플리케이션이 설정과 자원을 소유하게 만들었고, 진단 도구는 자료가 말할 수 있는 범위를 드러냈으며, 성능 실험은 숫자와 정합성을 함께 검증했다. 마지막 기여는 그 지식을 다른 개발자가 검토하고 유지할 수 있는 작은 계약으로 남기는 일이다. 다음 기능이 무엇이든 출발점은 같다. 제품의 구체적인 실패를 좁히고, 현재 계약을 읽고, 실패를 관찰하는 테스트를 만든 다음 필요한 만큼만 바꾼다.

이 장은 3권과 시리즈의 마지막 장이므로 존재하지 않는 다음 권으로 연결하지 않는다. 새로운 제품 요구를 만들고 싶다면 [1권의 첫 실행 경로](../01-fluoblog/ch01-first-app.ko.md)에서 출발한 애플리케이션을 다시 보자. 이제 그 짧은 조립 코드가 어떤 엔진을 깨우는지, 그리고 그 엔진을 바꿀 때 무엇을 증명해야 하는지 설명할 수 있다.

## 소스 근거와 검증 범위

- [core README](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts), [Module 구현](../../packages/core/src/decorators.ts): 이미 지원되는 기본값과 public contract.
- [metadata 저장 구현](../../packages/core/src/metadata/module.ts), [빈 Module 회귀 테스트](../../packages/core/src/module-defaults.test.ts), [빌드 산출물 테스트](../../packages/core/src/build-output.test.ts): 병합, 동결, 버전, 배포 entry의 근거.
- [빈 모듈 runtime 테스트](../../packages/runtime/src/empty-module-default.test.ts): adapterless bootstrap과 반복 close.
- [testing README](../../packages/testing/README.ko.md), [모듈 구현](../../packages/testing/src/module.ts), [compile 실패 정리 테스트](../../packages/testing/src/module.compile-failure.test.ts): 성공·실패 시 container 소유권.
- [테스트 계약](../../docs/contracts/testing-guide.ko.md), [동작 계약 정책](../../docs/contracts/behavioral-contract-policy.ko.md), [릴리스 계약](../../docs/contracts/release-governance.ko.md), [릴리스 workflow](../../.github/workflows/release.yml): 검증 범위와 Changesets 게시 경계.

예제 테스트와 결함 주입은 재현 절차로 제시했으며 이 원고에서 실행한 통과 증거가 아니다. 현재 소스와 근거 테스트를 읽어 설명을 대조했고, 실제 코드 변경·전체 검증·배포를 완료했다고 주장하지 않는다.
