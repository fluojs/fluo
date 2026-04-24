<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis depth expansion (350+ lines) -->

# Chapter 4. Provider Normalization and Resolution Algorithms

이 장은 Fluo DI 컨테이너가 공개 provider 선언을 내부 레코드로 정규화하고, 그 레코드를 따라 실제 인스턴스를 해결하는 과정을 분석합니다. Chapter 3까지가 데코레이터와 메타데이터 기록에 집중했다면, 이제 그 정보가 런타임 알고리즘으로 소비되는 지점을 살펴봅니다.

## Learning Objectives
- 공개 provider 문법이 내부 정규화 레코드로 바뀌는 과정을 이해합니다.
- 등록 단계에서 중복 검사와 스코프 가드레일이 왜 필요한지 설명합니다.
- token 조회, alias 처리, 인스턴스화로 이어지는 resolve 파이프라인을 분석합니다.
- optional, `forwardRef`, multi provider가 동일한 리졸버 위에서 어떻게 처리되는지 정리합니다.
- 캐시 전략과 에러 계약이 resolution 알고리즘의 일부인 이유를 확인합니다.
- 다음 장의 scope 분석을 읽기 위한 DI 컨테이너 기본 흐름을 정리합니다.

## Prerequisites
- Chapter 1부터 Chapter 3까지 완료.
- Fluo 메타데이터가 클래스 DI 계약으로 기록되는 방식에 대한 이해.
- 클래스 provider, factory provider, alias provider 같은 DI 기본 용어 이해.

## 4.1 From public provider syntax to normalized records
Fluo의 컨테이너는 공개 provider 형태를 그대로 해석하지 않습니다. 첫 단계는 항상 정규화입니다. 이 결정 덕분에 실제 resolve 경로는 작고 예측 가능하게 유지됩니다. 런타임은 다섯 가지 공개 API를 반복 분기하는 대신 하나의 내부 레코드 형태만 다루면 되기 때문입니다.

공개 surface는 `path:packages/di/src/types.ts:36-121`에 선언되어 있습니다. 이 경계에서 Fluo는 class constructor, `{ useClass }`, `{ useFactory }`, `{ useValue }`, `{ useExisting }`를 모두 받습니다. 이 형태들은 작성 편의성용 문법입니다. 실행 모델 자체는 아닙니다.

공개 타입은 provider가 받아들일 수 있는 모양과 정규화 뒤의 내부 모양을 분리해서 보여 줍니다.

`path:packages/di/src/types.ts:36-54`
```typescript
export interface ClassProvider<T = unknown> {
  provide: Token<T>;
  useClass: ClassType<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
}

export interface FactoryProvider<T = unknown> {
  provide: Token<T>;
  useFactory: (...deps: unknown[]) => MaybePromise<T>;
  inject?: Array<Token | ForwardRefFn | OptionalToken>;
  scope?: Scope;
  multi?: boolean;
  resolverClass?: ClassType;
}
```

이 발췌는 class provider와 factory provider가 같은 필드 언어를 공유한다는 점을 보여 줍니다. `provide`는 public token이고, `inject`, `scope`, `multi`는 뒤의 정규화와 등록 단계가 읽는 정책 입력입니다.

`useValue`와 `useExisting`까지 포함한 전체 public union은 아래처럼 내부 `NormalizedProvider`와 만납니다.

`path:packages/di/src/types.ts:56-121`
```typescript
export interface ValueProvider<T = unknown> {
  provide: Token<T>;
  useValue: T;
  multi?: boolean;
}

export interface ExistingProvider<T = unknown> {
  provide: Token<T>;
  useExisting: Token;
}

export interface NormalizedProvider<T = unknown> {
  inject: Array<Token | ForwardRefFn | OptionalToken>;
  provide: Token<T>;
  scope: Scope;
  type: 'class' | 'factory' | 'value' | 'existing';
  useClass?: ClassType<T>;
  useFactory?: (...deps: unknown[]) => MaybePromise<T>;
  useValue?: T;
  useExisting?: Token;
  multi?: boolean;
}
```

여기서 중요한 차이는 public provider가 여러 문법으로 열려 있어도, 내부 레코드는 `type`과 구현 필드의 조합으로 닫힌다는 점입니다. 뒤의 resolver는 이 내부 모양만 보면 됩니다.

실제 정규화 진입점은 `path:packages/di/src/container.ts:54-115`의 `normalizeProvider()`입니다. 이 함수가 이 장의 첫 번째 핵심 알고리즘입니다. 모든 입력 provider를 `type`, `provide`, `inject`, `scope`, 구현 필드를 갖는 `NormalizedProvider`로 변환합니다.

class constructor와 value provider는 정규화의 가장 단순한 두 분기입니다.

`path:packages/di/src/container.ts:54-76`
```typescript
function normalizeProvider(provider: Provider): NormalizedProvider {
  if (isClassConstructor(provider)) {
    const metadata = getClassDiMetadata(provider);

    return {
      inject: (metadata?.inject ?? []).map(normalizeInjectToken),
      provide: provider,
      scope: metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider,
    };
  }

  if (isValueProvider(provider)) {
    return {
      inject: [],
      multi: provider.multi,
      provide: provider.provide,
      scope: Scope.DEFAULT,
      type: 'value',
      useValue: provider.useValue,
    };
  }
```

class provider는 `getClassDiMetadata()`를 통해 명시적으로 기록된 inject와 scope를 읽습니다. value provider는 이미 값이 있으므로 inject 배열을 비우고 singleton 기본 scope를 붙입니다.

정규화 로직은 `inject` 배열도 정리합니다. `path:packages/di/src/container.ts:68-76`에서 알고리즘은 유효하지 않은 토큰을 걸러 내고, 각 엔트리가 유효한 토큰이거나 `optional()` 같은 명시적 래퍼인지 확인합니다. 이 조기 검증 덕분에 잘못된 주입 배열이 나중에 흐릿한 런타임 에러로 바뀌지 않습니다. 입력이 이 지점에서 표준화되므로, 하위 리졸버는 의존성 목록이 이미 실행 가능한 형태라고 가정할 수 있습니다.

조기 검증 자체는 작은 helper 하나로 고정되어 있습니다.

`path:packages/di/src/container.ts:46-52`
```typescript
function normalizeInjectToken(token: Token | ForwardRefFn | OptionalToken): Token | ForwardRefFn | OptionalToken {
  if (token == null) {
    throw new InvalidProviderError('Inject token must not be null or undefined. Check that all tokens in @Inject(...) are defined at the point of decoration (forward-reference cycles require forwardRef()).');
  }

  return token;
}
```

`null`과 `undefined`만 이 단계에서 즉시 차단하고, 일반 token, `forwardRef`, `optional` wrapper는 그대로 다음 단계로 넘깁니다. 따라서 정규화는 dependency entry를 평가하지 않고, 실행 가능한 모양인지 먼저 보장합니다.

또한 정규화는 Fluo의 "지연된 기본값(lazy defaults)"이 적용되는 지점입니다. 프로바이더가 스코프를 지정하지 않으면 `normalizeProvider`는 필드를 비워 두지 않습니다. `path:packages/di/src/container.ts:102-114`처럼 클래스 메타데이터를 읽고 `Scope.DEFAULT`라는 프레임워크 기본값을 채웁니다. 따라서 provider가 등록될 때는 동작 계약이 이미 명시된 상태입니다. 이 명시성 때문에 내부 레코드가 provider 구성의 최종 기준이 됩니다.

factory와 `{ provide, useClass }` 분기는 scope 우선순위와 inject 우선순위를 더 분명히 드러냅니다.

`path:packages/di/src/container.ts:78-101`
```typescript
  if (isFactoryProvider(provider)) {
    const metadata = provider.resolverClass ? getClassDiMetadata(provider.resolverClass) : undefined;

    return {
      inject: (provider.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'factory',
      useFactory: provider.useFactory,
    };
  }

  if (isClassProvider(provider)) {
    const metadata = getClassDiMetadata(provider.useClass);

    return {
      inject: (provider.inject ?? metadata?.inject ?? []).map(normalizeInjectToken),
      multi: provider.multi,
      provide: provider.provide,
      scope: provider.scope ?? metadata?.scope ?? Scope.DEFAULT,
      type: 'class',
      useClass: provider.useClass,
    };
  }
```

factory provider는 명시적 `provider.scope`를 먼저 보고, 없으면 `resolverClass` 메타데이터를 본 뒤 기본 singleton으로 떨어집니다. class provider object도 명시적 `inject`와 `scope`를 우선하고, 없을 때만 구현 클래스의 메타데이터를 사용합니다.

이 함수는 의존성의 재귀적 정규화도 맡습니다. 팩토리 프로바이더의 `inject` 리스트에 복합 정의가 섞여 있으면, `normalizeProvider`는 `normalizeInjectToken`을 통해 이를 안정적인 내부 토큰으로 바꿉니다. 표현이 한 가지로 모이면 DI 컨테이너는 모듈 컴파일 단계에서 의존성 그래프를 더 일관되게 만들 수 있습니다.

현재 컨테이너 구현은 의존성마다 별도 source tag를 저장하지 않습니다. 대신 `path:packages/di/src/container.ts:120-130`의 local registration map, multi registration map, request cache, singleton cache가 계층 조회와 수명 주기 분리를 위한 상태를 나눕니다. 뒤의 해결 단계는 이 저장소와 parent lookup을 조합해 어느 컨테이너 계층을 조회할지 판단합니다.

`normalizeProvider`의 또 다른 세부 사항은 `forwardRef`와 `optional` wrapper를 평가하지 않고 `inject` 배열에 보존한다는 점입니다. 의존성 토큰이 `forwardRef` 팩토리로 감싸져 있으면, 정규화 단계는 wrapper 자체를 남기고 실제 token 평가는 `resolveDepToken()`까지 늦춥니다. 표준 의존성 조회의 단순성을 유지하면서 정의 순서 문제를 다루기 위한 장치입니다. `path:packages/di/src/container.ts:46-52`와 `path:packages/di/src/container.ts:558-579`가 이 handoff를 보여 줍니다.

마지막으로 정규화는 최종 검증을 수행합니다. `provide` 같은 필수 필드가 있는지, 값 프로바이더와 팩토리를 동시에 지정하는 식의 명백한 모순이 없는지 확인합니다. 이 방어선 덕분에 DI 컨테이너의 내부 상태는 유효한 레코드만 다루게 됩니다. `normalizeProvider`를 통과한 provider는 Fluo 엔진이 실행 가능한 구성 조각으로 취급할 수 있습니다.

평범한 class 등록의 경우 컨테이너는 `getClassDiMetadata()`로 constructor 메타데이터를 읽고, 명시적 scope가 없으면 `Scope.DEFAULT`를 사용합니다. 이 흐름은 `path:packages/di/src/container.ts:55-65`에 보입니다. 즉 class 문법은 결국 token이 자기 자신인 normalized class provider의 sugar일 뿐입니다.

factory provider는 조금 더 미묘합니다. 컨테이너는 우선 `provider.scope`를 존중하지만, `resolverClass`가 있으면 그 클래스의 scope 메타데이터를 읽고, 마지막 fallback으로 singleton default를 사용합니다. 이 우선순위는 `path:packages/di/src/container.ts:78-89`에 드러납니다. 즉 비동기 또는 계산형 provider도 class provider와 같은 scope 언어에 참여합니다.

`{ provide, useClass }`도 같은 상속 패턴을 따릅니다. `path:packages/di/src/container.ts:91-102`는 컨테이너가 `provider.useClass`의 메타데이터를 읽되, provider object가 이미 `inject`나 `scope`를 명시한 경우에는 그것을 우선하는 모습을 보여줍니다. 즉 provider object는 최종 권위를 가지면서도, class decorator는 기본 계약을 제공할 수 있습니다.

두 개의 helper wrapper도 이 정규화 단계와 연결됩니다. 겉으로는 dependency 문법처럼 보이지만 실제로는 나중 resolution을 위한 표시자입니다. `forwardRef()`와 `optional()`은 `path:packages/di/src/types.ts:137-168`에 선언되어 있습니다. 이 함수들은 직접 resolve를 수행하지 않습니다. 후속 단계가 특별 취급할 수 있도록 token을 감쌀 뿐입니다.

`inject` 배열에 `null`이나 `undefined`가 들어오면 초기에 바로 거절됩니다. `path:packages/di/src/container.ts:46-52`의 `normalizeInjectToken()`은 forward-reference 힌트와 함께 `InvalidProviderError`를 던집니다. 이것은 중요한 선택입니다. Fluo는 작성 오류를 등록/정규화 단계에서 드러내고 싶어 합니다. 그래프가 절반쯤 활성화된 뒤 생성 시점에 뒤늦게 터뜨리려 하지 않습니다.

정규화 알고리즘은 다음처럼 요약할 수 있습니다.

```text
for each incoming provider:
  if provider is a class constructor:
    read @Inject/@Scope metadata from the class
    return normalized class provider
  else if provider has useValue:
    return normalized value provider with empty inject list
  else if provider has useFactory:
    normalize inject tokens
    compute scope from explicit scope -> resolverClass metadata -> singleton default
    return normalized factory provider
  else if provider has useClass:
    compute inject from explicit inject -> class metadata
    compute scope from explicit scope -> class metadata -> singleton default
    return normalized class provider
  else if provider has useExisting:
    return normalized alias provider
  else:
    throw InvalidProviderError
```

여기서 `@fluojs/core`와의 관계가 중요합니다. `@Inject(...)`와 `@Scope(...)`는 `path:packages/core/src/decorators.ts:37-89`와 `path:packages/core/src/metadata/class-di.ts:33-83`의 `defineClassDiMetadata()`를 통해 class-level DI 메타데이터를 기록합니다. 컨테이너는 emitted metadata로 constructor 타입을 추론하지 않습니다. 항상 명시적으로 기록된 메타데이터 레코드를 소비합니다. 그래서 정규화가 결정적입니다.

또 하나 숨어 있는 규칙은 상속입니다. `path:packages/core/src/metadata/class-di.ts:50-83`의 `getClassDiMetadata()`는 constructor lineage를 base-to-leaf로 걷고, 하위 클래스가 실제로 재정의한 필드만 덮어쓰게 합니다. 즉 provider normalization은 그 클래스 자신의 로컬 메타데이터가 아니라, 상속을 반영한 최종 계약을 보게 됩니다.

운영 관점에서 보면 4.1의 의미는 분명합니다. Fluo의 DI 컨테이너가 런타임에 단순하게 보이는 이유는, 복잡성 대부분을 초반 정규화 단계에서 미리 소화하기 때문입니다. `resolve()`가 시작될 때쯤이면 provider는 이미 하나의 내부 형태로 정리되어 있습니다.

## 4.2 Registration semantics, duplicate checks, and scope guardrails
정규화가 끝나면 `register()`가 정책을 적용합니다. 구현은 `path:packages/di/src/container.ts:152-191`에 있습니다. 이 메서드는 단순히 map에 append하는 함수가 아닙니다. 이후 resolution이 예측 가능하도록 그래프 규칙을 강제합니다.

첫 번째 규칙은 disposal 안전성입니다. 컨테이너가 이미 닫혀 있으면 등록은 `ContainerResolutionError`로 중단됩니다. 이는 `path:packages/di/src/container.ts:153-158`에서 확인할 수 있습니다. 이 가드는 이미 폐기된 그래프 위에 stale cache를 가진 새 provider를 얹는 상황을 막습니다.

두 번째 규칙은 request-scope 위생입니다. `requestScopeEnabled`가 true인 child container에서 default-scope non-multi provider를 직접 등록하면 `ScopeMismatchError`가 발생합니다. 코드는 `path:packages/di/src/container.ts:163-172`에 있습니다. 이것은 실수로 request-local singleton을 만드는 것을 막기 위한 보호장치입니다.

등록 초반부는 폐기 상태, 정규화, request scope 가드를 한 흐름으로 묶습니다.

`path:packages/di/src/container.ts:152-174`
```typescript
  register(...providers: Provider[]): this {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer register providers.',
        { hint: 'Ensure providers are registered before calling container.dispose().' },
      );
    }

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);

      if (this.requestScopeEnabled && normalized.scope === Scope.DEFAULT && normalized.multi !== true) {
        throw new ScopeMismatchError(
          `Singleton provider ${String(normalized.provide)} cannot be registered on a request-scope container.`,
          {
            token: normalized.provide,
            scope: 'singleton',
            hint: 'Register it on the root container before creating the request scope, or use container.override() within the request scope instead.',
          },
        );
      }
```

이 코드는 provider가 map에 들어가기 전에 그래프 상태와 scope 위치를 먼저 확인합니다. 그래서 잘못된 등록은 cache나 인스턴스 생성 단계까지 내려가지 않습니다.

왜 이것이 중요한가? 컨테이너는 `cacheFor()` 쪽에 이미 문서화된 footgun을 가지고 있기 때문입니다. `path:packages/di/src/container.ts:613-645`는 request scope에 locally registered singleton이 들어오면, 실제로는 root singleton cache가 아니라 request cache에 저장되어 request-scoped처럼 동작하게 됨을 설명합니다. Fluo는 이 동작을 조용히 허용하기보다, 가장 흔한 실수 경로를 등록 단계에서 차단합니다.

중복 검사는 single-provider와 multi-provider 경로로 나뉩니다. `path:packages/di/src/container.ts:331-351`의 `assertNoRegistrationConflict()`는 token이 로컬 또는 ancestor에 이미 호환되지 않는 형태로 존재하는지 검사합니다. 단순한 `Map.has()`보다 훨씬 강한 정책입니다. 부모-자식 계층 간 충돌도 실제 충돌로 취급합니다.

ancestor helper인 `path:packages/di/src/container.ts:353-371`을 보면 정확한 정책이 드러납니다. single provider는 같은 token이 visible 범위 어딘가에서 multi로 존재하면 추가할 수 없습니다. multi provider도 visible 범위 어딘가에서 single로 존재하면 추가할 수 없습니다. 이 규칙 덕분에 `container.resolve(token)`의 의미가 어느 계층에서 호출하느냐에 따라 바뀌지 않습니다.

테스트도 이 동작을 고정합니다. `path:packages/di/src/container.test.ts:414-431`은 두 방향의 금지된 교차 등록을 모두 검증합니다. token이 single로 시작했다면 intentional override 없이는 계속 single입니다. multi로 시작했다면 이후 등록도 multi를 유지하거나 override 의미를 사용해야 합니다.

multi-provider 등록 자체는 additive입니다. `path:packages/di/src/container.ts:176-185`는 normalized provider를 token별 배열에 push합니다. 나중에 `collectMultiProviders()`가 바로 이 자료구조를 사용합니다. 반면 single provider는 `registrations.set()`으로 `path:packages/di/src/container.ts:185-187`에서 한 번만 local slot을 차지합니다.

충돌 검사를 통과한 뒤에는 multi와 single이 서로 다른 저장소로 갈라집니다.

`path:packages/di/src/container.ts:174-187`
```typescript
      this.assertNoRegistrationConflict(normalized.provide, normalized.multi === true);

      if (normalized.multi) {
        const existing = this.multiRegistrations.get(normalized.provide);

        if (existing) {
          existing.push(normalized);
          continue;
        }

        this.multiRegistrations.set(normalized.provide, [normalized]);
      } else {
        this.registrations.set(normalized.provide, normalized);
      }
```

이 분리 덕분에 resolver는 token을 single 값으로 볼지, 배열로 집계할지 명확히 판단할 수 있습니다. 같은 token에 두 의미가 섞이지 않도록 바로 앞에서 conflict 검사를 수행하는 이유도 여기에 있습니다.

override semantics는 의도적으로 destructive합니다. `path:packages/di/src/container.ts:193-206`의 주석은 multi override가 해당 token의 기존 전체 집합을 갈아치운다고 명시합니다. 실제 코드도 `path:packages/di/src/container.ts:215-231`에서 single과 multi 등록을 모두 지운 뒤 새 값을 넣습니다. multi-provider 묶음 안의 특정 엔트리만 부분적으로 바꾸는 API는 없습니다.

override는 기존 single slot과 multi array를 모두 지우고 새 레코드 하나를 기준으로 삼습니다.

`path:packages/di/src/container.ts:215-231`
```typescript
    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const existing = this.lookupProvider(normalized.provide);

      this.registrations.delete(normalized.provide);
      this.multiRegistrations.delete(normalized.provide);
      this.invalidateCachedEntry(normalized.provide, existing?.scope ?? normalized.scope);

      if (normalized.multi) {
        this.multiRegistrations.set(normalized.provide, [normalized]);
        this.multiOverriddenTokens.add(normalized.provide);
        continue;
      }

      this.multiOverriddenTokens.add(normalized.provide);
      this.registrations.set(normalized.provide, normalized);
    }
```

`multiOverriddenTokens`가 함께 기록되므로 child scope에서 parent multi collection을 끊는 의미도 보존됩니다. cache invalidation까지 같은 지점에서 일어나기 때문에 이전 인스턴스가 새 정의 뒤에 남지 않습니다.

single과 multi의 충돌 금지는 local map뿐 아니라 ancestor까지 확인합니다.

`path:packages/di/src/container.ts:331-371`
```typescript
  private assertNoRegistrationConflict(token: Token, multi: boolean): void {
    if (multi) {
      if (this.registrations.has(token)) {
        throw new DuplicateProviderError(token);
      }

      if (this.hasAncestorSingleRegistration(token)) {
        throw new DuplicateProviderError(token);
      }

      return;
    }

    if (this.registrations.has(token) || this.multiRegistrations.has(token)) {
      throw new DuplicateProviderError(token);
    }

    if (this.hasAncestorMultiRegistration(token)) {
      throw new DuplicateProviderError(token);
    }
  }
```

이 발췌는 같은 token이 계층 어디선가 single로 보이면 multi 추가가 막히고, multi로 보이면 single 추가가 막히는 정책을 보여 줍니다. ancestor helper의 세부 재귀는 같은 정책의 반복이므로 여기서는 이 핵심 분기로 통합합니다.

이 설계는 테스트와 교체 전략에 유리합니다. override는 하나의 token에 대해 새 진실을 만드는 연산입니다. 컨테이너는 multi cluster 내부 개별 entry의 안정적인 identity를 만들 필요가 없습니다. `path:packages/di/src/container.test.ts:375-412`는 single 교체와 multi 교체를 모두 확인합니다.

등록 알고리즘은 다음과 같이 정리할 수 있습니다.

```text
on register(provider):
  fail if container is disposed
  normalized = normalizeProvider(provider)
  if current container is request-scoped and normalized is default singleton:
    throw ScopeMismatchError
  assert no single/multi conflict locally or across ancestors
  if normalized.multi:
    append to multiRegistrations[token]
  else:
    registrations[token] = normalized
```

핵심 구현 포인트는 이렇습니다. Fluo는 인스턴스가 생기기 전에 provider shape invariant를 강제합니다. 그래서 에러가 런타임 미스터리가 아니라 설정 단계의 명확한 위반으로 드러납니다. 이것이 뒤이어 나오는 resolution 알고리즘을 간결하게 유지하는 중요한 이유입니다.

## 4.3 The resolve pipeline: token lookup, chain tracking, and instantiation
공개 API는 매우 작습니다. `path:packages/di/src/container.ts:275-284`의 `resolve()`는 disposal만 검사한 뒤 `resolveWithChain(token, [], new Set())`로 위임합니다. 재미있는 내용은 모두 그 아래에 있습니다.

`path:packages/di/src/container.ts:389-402`의 `resolveWithChain()`은 트래픽 디렉터입니다. 먼저 `resolveForwardRefCircularDependency()`로 현재 token이 이미 active chain 안에 있는지 검사합니다. 그 다음에야 `resolveFromRegisteredProviders()`로 내려갑니다. 즉 순환 의존성 검사는 나중에 덧붙인 부가기능이 아니라, 재귀 resolution의 첫 분기입니다.

공개 API와 내부 진입점은 작게 유지됩니다.

`path:packages/di/src/container.ts:275-284`
```typescript
  async resolve<T>(token: Token<T>): Promise<T> {
    if (this.disposed) {
      throw new ContainerResolutionError(
        'Container has been disposed and can no longer resolve providers.',
        { token, hint: 'Ensure all resolves complete before calling container.dispose().' },
      );
    }

    return this.resolveWithChain(token, [], new Set<Token>());
  }
```

사용자에게 보이는 `resolve()`는 폐기 상태만 확인하고, 의존성 경로와 active set을 새로 만든 뒤 내부 파이프라인으로 넘깁니다. 그래서 한 번의 resolve 시도에서 쓰는 임시 상태가 컨테이너 장기 상태와 섞이지 않습니다.

그 다음 단계는 cycle 확인 후 등록 기반 해결로 내려갑니다.

`path:packages/di/src/container.ts:389-402`
```typescript
  private async resolveWithChain<T>(
    token: Token<T>,
    chain: Token[],
    activeTokens: Set<Token>,
    allowForwardRef = false,
  ): Promise<T> {
    const cachedForwardRef = this.resolveForwardRefCircularDependency(token, chain, activeTokens, allowForwardRef);

    if (cachedForwardRef !== undefined) {
      return (await cachedForwardRef) as T;
    }

    return await this.resolveFromRegisteredProviders(token, chain, activeTokens);
  }
```

이 구조 때문에 cycle detector는 재귀 호출의 외부 감시자가 아니라 resolver의 첫 분기입니다. `allowForwardRef`도 같은 인자 흐름 안에 있으므로 특정 dependency entry에서만 의미를 갖습니다.

`resolveWithChain` 내부에서 Fluo는 `allowForwardRef` 플래그도 함께 전달합니다. `path:packages/di/src/container.ts:392-396`에서 이 플래그는 cycle 검사 helper로 들어갑니다. 실제 `forwardRef` wrapper 해석은 뒤의 `resolveDepToken()`에서 일어나고, cycle이 남아 있으면 같은 active set 검사로 실패합니다.

파이프라인의 또 다른 핵심은 alias redirect입니다. `path:packages/di/src/container.ts:451-525`에서 `resolveAliasTarget()`과 `resolveExistingProviderTarget()`은 `{ useExisting }` provider에 대한 재귀 조회를 처리합니다. 단순한 맵 조회가 아니라 target token으로 다시 resolver를 호출합니다. 이때 의존성 체인을 보존하므로, 에러에는 원래 alias부터 최종 실패 지점까지의 경로가 남습니다.

`resolveFromRegisteredProviders`(`path:packages/di/src/container.ts:404-432`)는 스코핑 계층도 구현합니다. 토큰이 로컬 컨테이너에 없다고 바로 실패하지 않고, 부모 체인이 있으면 위로 올라가며 같은 규칙을 적용합니다. 그래서 request container 같은 child는 root singleton을 상속받으면서 특정 서비스만 로컬에서 재정의할 수 있습니다. 이 계층적 해결이 모듈 구성과 요청 격리의 기반이 됩니다.

실제 provider 선택 순서는 local single, collected multi, required visible single 순서입니다.

`path:packages/di/src/container.ts:404-432`
```typescript
  private async resolveFromRegisteredProviders<T>(token: Token<T>, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    const localSingleProvider = this.registrations.get(token);

    if (!localSingleProvider) {
      const multiProviders = this.collectMultiProviders(token);

      if (multiProviders.length > 0) {
        const instances = await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
          this.resolveMultiProviderInstances(multiProviders, c, at),
        );

        return instances as T;
      }
    }

    const provider = this.requireProvider(token);
    const existingTarget = this.resolveExistingProviderTarget(provider);

    if (existingTarget !== undefined) {
      return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain, activeTokens);
    }
```

이 발췌는 resolver가 token 의미를 재해석하지 않는다는 점을 보여 줍니다. registration 단계에서 single과 multi 충돌을 막았기 때문에, 여기서는 순서대로 조회하고 해당 경로로 실행하면 됩니다.

마지막으로 `cacheFor` 헬퍼(`path:packages/di/src/container.ts:613-645`)는 해결된 인스턴스가 스코프에 맞는 캐시에 들어가도록 합니다. 이 함수가 singleton과 request 수명 주기를 실제 cache 선택으로 바꾸는 지점입니다. 인스턴스를 서로 다른 cache 객체로 나누기 때문에 요청 간 오염을 막고, singleton identity도 해당 계층의 규칙에 맞게 유지할 수 있습니다.

scope cache 선택은 provider scope와 현재 컨테이너가 request scope인지에 따라 갈라집니다.

`path:packages/di/src/container.ts:624-645`
```typescript
  private cacheFor(provider: NormalizedProvider): Map<Token, Promise<unknown>> {
    if (provider.scope === Scope.DEFAULT) {
      if (this.requestScopeEnabled && this.registrations.has(provider.provide)) {
        return this.requestCache;
      }

      return this.root().singletonCache;
    }

    if (!this.requestScopeEnabled) {
      throw new RequestScopeResolutionError(
        `Request-scoped provider ${formatTokenName(provider.provide)} cannot be resolved outside request scope.`,
        {
          token: provider.provide,
          scope: 'request',
          hint: 'Wrap the resolve call inside a request-scoped child container created via container.createRequestScope().',
        },
      );
    }

    return this.requestCache;
  }
```

singleton 기본 provider는 보통 root cache를 사용하지만, request container에 로컬로 등록된 기본 scope provider는 request cache로 들어갑니다. request-scoped provider를 root에서 해결하려 하면 명확한 scope error가 납니다.

리졸버의 순환 의존성 감지는 단순한 스택 깊이 체크가 아닙니다. `path:packages/di/src/container.ts:582-597`의 `activeSet`을 사용해 cycle을 만든 정확한 token을 식별하고, 함께 유지되는 chain으로 의존성 경로를 보고합니다. 여러 provider가 얽힌 그래프를 디버깅할 때 이 차이가 큽니다. `withTokenInChain` helper는 예외가 발생해도 이 set이 현재 해결 상태와 동기화되도록 `finally`에서 정리합니다.

또한 해결 알고리즘은 missing provider를 구조화해서 보고합니다. `path:packages/di/src/container.ts:435-449`의 `requireProvider()`는 provider가 없을 때 token과 hint를 담은 `ContainerResolutionError`를 던집니다. 덕분에 그래프의 어느 token이 등록되지 않았는지 추적할 수 있습니다.

`path:packages/di/src/container.ts:412-425`에서 보이는 것은 별도 프레임워크 토큰 shortcut이 아니라 multi 결과 반환 뒤 alias target을 확인하는 provider 분기입니다. 이 장에서는 이 범위를 앞의 `resolveFromRegisteredProviders()` 발췌로 통합합니다. 현재 소스 기준으로 핵심 규칙은 등록 맵, multi collection, alias redirect, scope cache 순서입니다.

해결 알고리즘은 외부 사이드 이펙트를 만들지 않도록 구성됩니다. `resolveProviderDeps` 단계에서 컨테이너는 메타데이터 조회와 리플렉션 접근을 읽기 전용으로 다룹니다. DI 시스템이 관리 대상 클래스의 런타임 동작을 수정하지 않기 위한 원칙입니다. 서비스를 관찰하거나 해결하는 행위가 서비스 내부 상태를 바꾸지 않아야 resolver를 신뢰할 수 있습니다.

해결 파이프라인은 "멀티 프로바이더(multi-provider)" 집계도 지원합니다. 토큰이 multi provider로 표시되면, `resolveFromRegisteredProviders`(`path:packages/di/src/container.ts:418-430`)는 관련 등록을 모아 하나의 배열로 해결합니다. 등록 순서가 보존되므로 미들웨어 체인이나 플러그인 시스템도 예측 가능하게 동작합니다. 각 entry는 독립적으로 해결되므로 같은 token 아래에서도 서로 다른 scope나 구현 타입을 가질 수 있습니다.

해결의 마지막 단계에 별도 런타임 인스턴스 검증기가 있는 것은 아닙니다. `path:packages/di/src/container.ts:849-876`은 alias chain을 따라 effective provider를 찾는 scope 검사용 helper입니다. 즉 현재 소스에서 마지막 방어선은 반환값 타입 검사보다, singleton이 request-scoped dependency를 가리키지 못하게 하는 provider graph 검사에 가깝습니다.

`path:packages/di/src/container.ts:815-820`의 `instantiate` class 분기는 lifecycle hook 호출이 아니라 constructor 실행입니다. dependency를 먼저 resolve한 뒤 `new provider.useClass(...deps)`로 인스턴스를 만듭니다. 이 장에서는 생성 경로가 normalized provider와 dependency loop만 사용한다는 점에 집중합니다.

컨테이너가 계층을 나누는 대표 진입점은 request scope 생성입니다. `path:packages/di/src/container.ts:252-263`은 child container가 parent를 가리키고 root singleton cache를 공유하도록 만듭니다. 동적 module provider 등록 자체는 이 파일의 별도 bootstrap 로직이 아니라 `register()`와 `override()`의 정규화, 충돌 검사, cache invalidation 규칙으로 흡수됩니다.

또 다른 세부 사항은 cache가 값이 아니라 `Promise<unknown>`을 저장한다는 점입니다. `resolveScopedOrSingletonInstance`(`path:packages/di/src/container.ts:535-548`)는 생성 promise를 cache에 넣고, 실패하면 해당 entry를 지웁니다. 이 구조는 같은 singleton을 동시에 여러 번 만들지 않으면서도 실패한 생성 시도는 다음 resolve에서 다시 시도할 수 있게 합니다.

마지막으로 해결 알고리즘은 컨테이너의 "폐기(disposal)" 수명 주기와 맞물립니다. `container.dispose()`가 호출되면 `resolve()`와 `register()`는 앞의 폐기 상태 가드에서 새 작업을 거부합니다. 종료 중 새 인스턴스가 만들어지면 메모리 누수나 끊기지 않은 데이터베이스 연결로 이어질 수 있으므로, disposal 상태는 registration과 resolution 양쪽의 계약에 포함됩니다.

`path:packages/di/src/container.ts:404-432`의 `resolveFromRegisteredProviders()`가 실질적인 pipeline입니다. 순서가 중요합니다. 우선 local single registration을 확인합니다. 없으면 collected multi providers를 확인합니다. multi가 있으면 배열로 resolve합니다. 그 이후에야 single provider를 반드시 요구합니다.

이 순서는 token 의미를 설명해 줍니다. 직접 single provider가 있으면 token은 single로 해석됩니다. 그렇지 않고 multi set이 비어 있지 않으면 multi로 해석됩니다. 그래서 registration conflict 검사가 엄격해야 합니다. resolver는 token의 의미가 이미 애매하지 않다고 가정하고 있기 때문입니다.

alias는 scope cache보다 먼저 처리됩니다. `path:packages/di/src/container.ts:451-525`의 `resolveExistingProviderTarget()`과 `resolveAliasTarget()`은 chain tracking을 유지한 채 다른 token으로 resolution을 redirect합니다. 즉 `{ useExisting }`는 복사된 인스턴스가 아닙니다. 기존 token에 대한 위임 조회입니다.

transient provider는 cache를 의도적으로 건너뛰는 유일한 경로입니다. `path:packages/di/src/container.ts:426-428`은 transient를 `withTokenInChain()` 아래에서 바로 `instantiate()`로 보냅니다. 그 외의 non-alias provider는 결국 `path:packages/di/src/container.ts:527-548`의 `resolveScopedOrSingletonInstance()`로 갑니다.

alias 분기 이후에는 transient와 cache 기반 provider가 갈라집니다.

`path:packages/di/src/container.ts:426-432`
```typescript
    if (provider.scope === 'transient') {
      return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
    }

    return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveScopedOrSingletonInstance(provider, c, at),
    )) as T;
```

transient는 cache를 보지 않고 바로 생성됩니다. 그 외 scope는 같은 chain 추적 안에서 scope-aware cache 선택으로 넘어가므로 cycle 보고와 cache 정책이 분리되지 않습니다.

`path:packages/di/src/container.ts:582-597`의 `withTokenInChain()`은 작지만 결정적인 helper입니다. 현재 token을 chain 배열과 active set에 넣고, `finally`에서 반드시 제거합니다. 이 구조 덕분에 Fluo는 두 가지를 동시에 얻습니다. 하나는 사람이 읽는 dependency chain입니다. 다른 하나는 O(1) membership 검사로 동작하는 cycle detector입니다.

chain과 active set은 같은 helper에서 함께 갱신되고, 예외가 나도 함께 정리됩니다.

`path:packages/di/src/container.ts:582-597`
```typescript
  private async withTokenInChain<T>(
    token: Token,
    chain: Token[],
    activeTokens: Set<Token>,
    run: (chain: Token[], activeTokens: Set<Token>) => Promise<T>,
  ): Promise<T> {
    chain.push(token);
    activeTokens.add(token);

    try {
      return await run(chain, activeTokens);
    } finally {
      activeTokens.delete(token);
      chain.pop();
    }
  }
```

배열은 에러 메시지의 경로를 만들고, set은 현재 recursion 안에 있는 token인지 빠르게 판단합니다. `finally`가 있어 실패한 생성 시도 뒤에도 다음 resolve가 오염되지 않습니다.

실제 객체 생성은 `path:packages/di/src/container.ts:796-825`의 `instantiate()`에서 일어납니다. 이 메서드는 먼저 `assertSingletonDependencyScopes()` 호출합니다. 그다음 provider type별로 분기합니다. value provider는 값을 그대로 반환합니다. factory provider는 dependency를 resolve한 뒤 `useFactory`를 호출합니다. class provider는 dependency를 resolve한 뒤 `new useClass(...deps)`를 수행합니다.

객체 생성 단계는 normalized provider의 `type`만 보고 실행됩니다.

`path:packages/di/src/container.ts:796-825`
```typescript
  private async instantiate<T>(provider: NormalizedProvider<T>, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    this.assertSingletonDependencyScopes(provider);

    switch (provider.type) {
      case 'value':
        return provider.useValue as T;
      case 'existing':
        return await this.resolveWithChain(provider.useExisting as Token<T>, [], new Set());
      case 'factory': {
        if (!provider.useFactory) {
          throw new InvariantError('Factory provider is missing useFactory.');
        }

        const deps = await this.resolveProviderDeps(provider, chain, activeTokens);

        return provider.useFactory(...deps);
      }
      case 'class': {
        if (!provider.useClass) {
          throw new InvariantError('Class provider is missing useClass.');
        }

        const deps = await this.resolveProviderDeps(provider, chain, activeTokens);
```

이 발췌는 value, factory, class가 같은 생성 함수 안에서 갈라진다는 점을 보여 줍니다. `class` 분기의 실제 `new provider.useClass(...deps)` 호출은 바로 다음 줄에 이어지며, 앞의 dependency resolution과 같은 규칙을 공유합니다.

dependency resolution 자체는 순차 루프입니다. `path:packages/di/src/container.ts:890-898`의 `resolveProviderDeps()`는 `provider.inject.length`에 맞는 배열을 만들고, 각 token을 순서대로 resolve합니다. 여기에는 speculative parallelism이 없습니다. 그 덕분에 chain ordering과 error reporting이 안정적으로 유지됩니다.

dependency 배열은 provider의 `inject` 순서를 그대로 따릅니다.

`path:packages/di/src/container.ts:890-898`
```typescript
  private async resolveProviderDeps(provider: NormalizedProvider, chain: Token[], activeTokens: Set<Token>): Promise<unknown[]> {
    const deps = new Array<unknown>(provider.inject.length);

    for (const [index, entry] of provider.inject.entries()) {
      deps[index] = await this.resolveDepToken(entry, chain, activeTokens);
    }

    return deps;
  }
```

각 entry가 순서대로 `resolveDepToken()`을 지나므로 constructor 인자 순서와 에러 chain 순서가 일치합니다. 이 단순한 루프가 factory provider와 class provider 모두의 주입 규칙을 고정합니다.

전체 흐름은 이렇게 표현할 수 있습니다.

```text
resolve(token):
  resolveWithChain(token, emptyChain, emptyActiveSet)

resolveWithChain(token, chain, active):
  if token already active:
    throw circular dependency error
  else:
    resolveFromRegisteredProviders(token, chain, active)

resolveFromRegisteredProviders(token, chain, active):
  if local single provider exists:
    use it
  else if collected multi providers exist:
    resolve every entry and return array
  else:
    require visible single provider or throw missing-provider error

  if provider is alias:
    resolve target token recursively
  else if provider is transient:
    instantiate directly
  else:
    resolve through scope-aware cache
```

`path:packages/di/src/container.test.ts:10-40`과 `path:packages/di/src/container.test.ts:638-679`는 바깥에서 보이는 의도를 고정합니다. singleton은 같은 인스턴스를 재사용하고, factory provider는 주입받은 dependency를 인자로 받으며, multi provider는 등록 순서를 보존한 배열을 반환합니다.

고급 독자에게 중요한 결론은 이것입니다. Fluo의 resolver는 재귀적이지만 결코 마법적이지 않습니다. 모든 재귀 단계는 `container.ts`에 그대로 드러나 있고, 모든 분기는 runtime reflection이 아니라 normalized provider 데이터로부터 결정됩니다.

## 4.4 Optional tokens, forward references, aliases, and multi providers
Fluo 설계의 우아한 지점은 special case가 한곳에 모인다는 점입니다. 모두 `path:packages/di/src/container.ts:558-579`의 `resolveDepToken()`으로 흘러갑니다. 이 helper 하나가 optional wrapper, forward reference, ordinary token을 해석합니다.

special dependency entry는 모두 이 helper에서 해석됩니다.

`path:packages/di/src/container.ts:558-579`
```typescript
  private async resolveDepToken(
    depEntry: Token | ForwardRefFn | OptionalToken,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (isOptionalToken(depEntry)) {
      const innerToken = depEntry.token;

      if (!this.has(innerToken)) {
        return undefined;
      }

      return this.resolveWithChain(innerToken, chain, activeTokens);
    }

    if (isForwardRef(depEntry)) {
      const resolvedToken = depEntry.forwardRef();

      return this.resolveWithChain(resolvedToken, chain, activeTokens, /* allowForwardRef */ true);
    }

    return this.resolveWithChain(depEntry as Token, chain, activeTokens);
  }
```

optional은 먼저 등록 여부를 보고 없으면 `undefined`를 반환합니다. `forwardRef`는 factory를 호출해 실제 token을 얻은 뒤, `allowForwardRef` 플래그를 켠 상태로 같은 resolver에 들어갑니다.

optional injection은 가장 작은 분기입니다. dependency entry가 `OptionalToken`이면 컨테이너는 먼저 `has(innerToken)`을 검사합니다. token이 없으면 에러 없이 `undefined`를 반환합니다. 있으면 평범하게 resolve합니다. 정확한 코드는 `path:packages/di/src/container.ts:563-571`에 있고, 테스트는 `path:packages/di/src/container.test.ts:494-532`에 있습니다.

forward reference도 의도적으로 단순합니다. `isForwardRef(depEntry)`가 참이면 wrapper는 `depEntry.forwardRef()`로 lazy evaluation 되고, 그 결과 token을 `resolveWithChain(..., allowForwardRef=true)`에 넘깁니다. 이는 `path:packages/di/src/container.ts:573-577`에 보입니다. 이 wrapper는 token lookup 시점을 늦출 뿐입니다. proxy 인스턴스나 lazy object를 만들어 주지 않습니다.

이 구분이 중요합니다. 실제 constructor cycle이 남아 있으면 `resolveForwardRefCircularDependency()`는 여전히 예외를 던집니다. 다만 이번에는 `forwardRef only defers token lookup and does not resolve true circular construction`라는 detail string을 함께 붙입니다. 근거는 `path:packages/di/src/container.ts:457-475`와 `path:packages/di/src/container.test.ts:320-336`입니다.

forward reference가 허용된 재귀에서도 active token이 다시 보이면 cycle로 처리됩니다.

`path:packages/di/src/container.ts:457-475`
```typescript
  private resolveForwardRefCircularDependency(
    token: Token,
    chain: Token[],
    activeTokens: Set<Token>,
    allowForwardRef: boolean,
  ): Promise<unknown> | undefined {
    if (!activeTokens.has(token)) {
      return undefined;
    }

    if (allowForwardRef) {
      throw new CircularDependencyError(
        [...chain, token],
        'forwardRef only defers token lookup and does not resolve true circular construction.',
      );
    }

    throw new CircularDependencyError([...chain, token]);
  }
```

따라서 `forwardRef`는 선언 시점의 token lookup만 늦춥니다. 이미 생성 중인 token을 다시 만들 수 있게 허용하는 escape hatch는 아닙니다.

alias는 dependency-entry 수준이 아니라 provider 수준 기능입니다. `useExisting` provider는 `path:packages/di/src/container.ts:104-111`에서 정규화되고, 나중에 `path:packages/di/src/container.ts:451-455`의 `resolveAliasTarget()`이 실제 target token으로 redirect합니다. 즉 alias token은 target token의 resolved value에 대한 또 다른 이름입니다.

정규화 단계에서 alias provider는 의존성 없는 `existing` 레코드로 닫힙니다.

`path:packages/di/src/container.ts:104-111`
```typescript
  if (isExistingProvider(provider)) {
    return {
      inject: [],
      provide: provider.provide,
      scope: Scope.DEFAULT,
      type: 'existing',
      useExisting: provider.useExisting,
    };
  }
```

이 레코드는 값을 복사하지 않습니다. `useExisting` target을 보관했다가 resolution 단계에서 같은 체인 추적으로 다시 조회하게 만듭니다.

그래서 alias chain도 허용됩니다. `path:packages/di/src/container.test.ts:552-568`은 여러 단계를 거친 alias chain이 결국 원래 인스턴스를 반환함을 보여 줍니다. 하지만 alias cycle은 허용되지 않습니다. `path:packages/di/src/container.ts:849-876`의 `resolveEffectiveProvider()`는 request-scope mismatch를 확인하기 위해 alias chain을 따라가다가, token이 반복되면 `CircularDependencyError`를 던집니다. 회귀 테스트는 `path:packages/di/src/container.test.ts:570-585`입니다.

alias target 조회는 체인을 유지한 채 target token으로 redirect합니다.

`path:packages/di/src/container.ts:451-525`
```typescript
  private async resolveAliasTarget<T>(existingTarget: Token<T>, token: Token, chain: Token[], activeTokens: Set<Token>): Promise<T> {
    return await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
      this.resolveWithChain(existingTarget, c, at),
    );
  }

  private resolveExistingProviderTarget(provider: NormalizedProvider): Token | undefined {
    if (provider.type !== 'existing') {
      return undefined;
    }

    return provider.useExisting;
  }
```

alias는 별도 인스턴스를 만들지 않고 target token을 다시 해결합니다. `withTokenInChain`을 거치기 때문에 alias token도 에러 경로와 cycle 감지에 남습니다.

multi provider는 또 다른 층위를 추가합니다. `path:packages/di/src/container.ts:373-387`의 `collectMultiProviders()`는 child scope에서 explicit override가 없는 한, 부모와 로컬 배열을 병합합니다. 그래서 request child는 root plugin list를 이어받으면서 자신의 plugin을 추가할 수 있습니다.

multi provider collection은 parent entries 뒤에 local entries를 붙입니다.

`path:packages/di/src/container.ts:373-387`
```typescript
  private collectMultiProviders(token: Token): NormalizedProvider[] {
    const local = this.multiRegistrations.get(token);

    if (this.multiOverriddenTokens.has(token)) {
      return local ?? [];
    }

    const fromParent = this.parent ? this.parent.collectMultiProviders(token) : [];

    if (local) {
      return [...fromParent, ...local];
    }

    return fromParent;
  }
```

override marker가 있으면 parent collection은 끊깁니다. 그렇지 않으면 parent 배열이 먼저 오고 local 배열이 뒤에 오므로 등록 순서가 계층 전체에서도 예측 가능합니다.

동작은 정밀합니다. `path:packages/di/src/container.test.ts:657-679`는 child registration이 parent multi set 뒤에 append됨을 증명합니다. `path:packages/di/src/container.test.ts:669-691`는 `override()`가 해당 token에 대한 parent collection을 끊는다는 점을 증명합니다. replacement가 여전히 multi든 single로 바뀌든 동일합니다.

multi entry의 resolution은 single resolution과 다릅니다. `path:packages/di/src/container.ts:491-517`의 `resolveMultiProviderInstance()`는 token이 아니라 normalized provider object를 key로 cache합니다. 그래서 동일 token 아래 여러 entry가 있더라도, 각 entry는 자기 자신의 singleton/request identity를 유지할 수 있습니다.

multi entry는 token 하나가 아니라 provider record 하나를 기준으로 cache됩니다.

`path:packages/di/src/container.ts:491-517`
```typescript
  private async resolveMultiProviderInstance(
    provider: NormalizedProvider,
    chain: Token[],
    activeTokens: Set<Token>,
  ): Promise<unknown> {
    if (provider.type === 'existing') {
      return await this.resolveWithChain(provider.useExisting as Token, chain, activeTokens);
    }

    if (provider.scope === 'transient') {
      return await this.instantiate(provider, chain, activeTokens);
    }

    if (this.shouldResolveMultiProviderFromRoot(provider)) {
      return await this.root().resolveMultiProviderInstance(provider, chain, activeTokens);
    }

    const cache = this.multiCacheFor(provider);
```

동일 token 아래 여러 provider가 있어도 각 normalized provider가 독립적으로 해석됩니다. 이 발췌 이후의 cache set/get 분기는 provider object를 key로 쓰므로 multi entry마다 identity가 분리됩니다.

special dependency entry 알고리즘은 이렇게 정리됩니다.

```text
resolveDepToken(entry):
  if entry is optional(token):
    if token is absent:
      return undefined
    return resolve(token)
  if entry is forwardRef(factory):
    token = factory()
    return resolve(token, allowForwardRef=true)
  return resolve(entry)
```

multi aggregation 알고리즘은 다음과 같습니다.

```text
collectMultiProviders(token):
  local = local multi registrations for token
  if token was overridden in this scope:
    return local or []
  parentEntries = parent.collectMultiProviders(token)
  if local exists:
    return parentEntries + local
  return parentEntries
```

실무적으로 보면 Fluo는 여러 고급 authoring pattern을 지원하면서도 정신 모델을 지나치게 넓히지 않습니다. special wrapper는 token lookup 규칙을 바꾸고, alias는 token identity를 바꾸며, multi provider는 결과 cardinality를 바꿉니다. 하지만 모두 같은 recursive resolver 위에서 동작합니다.

이 설계는 테스트용 특수 컨테이너 구현도 단순하게 만듭니다. `path:packages/di/src/container.ts:389-432`의 핵심 해결 로직은 특정 등록 맵에 고정되어 있지 않으므로, 테스트 컨테이너는 전체 그래프를 다시 정규화하지 않고 개별 token을 재정의할 수 있습니다. 이런 "정밀 재정의(surgical override)"는 통합 테스트를 빠르고 안정적으로 유지하는 데 도움이 됩니다. 실제 데이터베이스 서비스를 mock 서비스로 교체하면, 리졸버는 그 token 아래의 새 정의를 따라갑니다.

통합된 해결 경로는 구현 유형이 달라도 모든 provider가 같은 프레임워크 규칙을 받도록 합니다. class provider, factory provider, value provider 모두 동일한 의존성 추적과 cycle 감지 로직에 참여합니다. 이 일관성은 Fluo의 "표준 우선" 접근에 중요합니다. 유형마다 별도 규칙을 늘리기보다, 모두에게 적용되는 하나의 해결 계약을 유지합니다.

리졸버는 현재 해결 시도에 대한 "해결 컨텍스트(resolution context)"도 관리합니다. 여기에는 재귀 호출 깊이와 `allowForwardRef` 같은 플래그가 포함됩니다. 이 일시 상태를 컨테이너 필드에 묻어 두지 않고 `resolveWithChain`의 인자 흐름으로 전달하기 때문에, 컨테이너의 장기 상태와 한 번의 해결 시도가 섞이지 않습니다. 동시 요청이 많은 환경에서 특히 중요한 구분입니다.

또 다른 세부 사항은 Fluo가 "순환 의존성 힌트"를 붙이는 방식입니다. cycle이 감지되면 리졸버는 전체 token chain을 수집하고, 흔한 복구 패턴을 에러 메시지에 담을 수 있습니다. `forwardRef`가 이미 있지만 위치나 기대가 잘못된 경우, `path:packages/di/src/errors.ts:115-125`의 메시지는 이를 어떻게 해석해야 하는지 구체적으로 설명합니다. 에러 보고도 알고리즘의 일부로 다뤄지는 셈입니다.

마지막으로 해결 파이프라인은 "핫 패스(hot-path)" 성능을 고려해 구성됩니다. 불필요한 할당을 피하고 chain 추적에 효율적인 자료 구조를 사용해 `resolve()` 호출의 오버헤드를 줄입니다. 이미 singleton cache에 있는 서비스를 해결하는 경우에는 몇 번의 조회로 끝납니다. 복잡한 의존성 그래프에서도 부트스트랩과 런타임 비용을 통제하기 위한 설계입니다.

해결 로직은 컨테이너의 "폐기(disposal)" 생명주기도 존중합니다. 컨테이너가 폐기된 상태라면 새 인스턴스 생성을 막기 위해 해결 시도를 중단합니다. 이는 `path:packages/di/src/container.ts:275-284`의 public `resolve()` 가드에서 확인할 수 있습니다. 생성과 종료가 같은 상태 모델을 공유해야 애플리케이션 실행 기간 전체에서 resource ownership이 흔들리지 않습니다.

## 4.5 Error contracts and why they are part of the algorithm
Fluo에서 에러 보고는 사후 포장이 아닙니다. `path:packages/di/src/errors.ts:1-154`의 error class들은 컨테이너 계약의 일부입니다. 깨진 module graph나 provider declaration을 운영자가 어떻게 추적하는지 자체를 규정합니다.

`path:packages/di/src/errors.ts:14-42`의 `formatDiContext()`는 token, scope, module, dependency chain, hint를 최종 메시지에 조합합니다. 이는 단순한 문자열 연결이 아니라, 개발자가 문제의 원인을 한눈에 파악할 수 있도록 구조화된 정보를 제공합니다. 예를 들어, 순환 의존성이 발생했을 때 단순히 "사이클이 발생했습니다"라고 말하는 대신, 'ServiceA -> ServiceB -> ServiceC -> ServiceA'와 같이 명확한 경로를 시각화하여 보여줍니다.

이 메시지 형식화는 `path:packages/di/src/errors.ts:25-38`에서 볼 수 있듯이, 각 에러 타입에 맞춘 포맷터로 수행됩니다. Fluo는 에러를 던지는 데서 멈추지 않고, 에러 자체가 복구 방향을 알려 주도록 설계합니다. 런타임의 복잡한 상태를 사람이 읽을 수 있는 형태로 바꾸는 과정은 프레임워크 사용성의 핵심 세부 사항입니다.

이 가이드 메시지는 단순한 도움말보다 더 실용적인 역할을 합니다. 실패 지점마다 개발자가 자신의 provider 구성과 module boundary를 다시 볼 수 있게 만듭니다. 즉 throw site는 구조화된 context만 붙이면 되고, 한 formatter가 사람이 읽기 좋은 형태로 정리해 줍니다.

`ContainerResolutionError`는 missing provider, disposed-container operation, 기타 lifecycle failure를 담당합니다. missing-provider 분기는 `path:packages/di/src/container.ts:435-449`의 `requireProvider()`에서 던져집니다. 거기 들어 있는 hint 문구를 보십시오. 이미 reader를 module `providers`, `exports`, `imports` 관계 쪽으로 유도하고 있습니다.

missing provider 에러는 token과 복구 hint를 같은 자리에서 구성합니다.

`path:packages/di/src/container.ts:435-449`
```typescript
  private requireProvider(token: Token): NormalizedProvider {
    const provider = this.lookupProvider(token);

    if (!provider) {
      throw new ContainerResolutionError(
        `No provider registered for token ${formatTokenName(token)}.`,
        {
          token,
          hint: 'Ensure the provider is registered in a module\'s providers array, or that the module exporting it is imported by the consuming module.',
        },
      );
    }

    return provider;
  }
```

이 발췌는 실패한 token lookup이 단순한 `undefined` 반환으로 끝나지 않는다는 점을 보여 줍니다. 에러는 등록 위치와 module import/export 관계를 점검하라는 방향을 함께 제공합니다.

`RequestScopeResolutionError`는 request-scoped provider를 request scope 밖에서 resolve할 때 `cacheFor()`와 `multiCacheFor()`에서 발생합니다. 근거는 `path:packages/di/src/container.ts:633-645`와 `path:packages/di/src/container.ts:656-668`입니다. 이것은 단순 생성 실패가 아니라 아키텍처 위반을 설명하는 런타임 에러입니다.

`ScopeMismatchError`는 한 단계 더 위의 검증입니다. `path:packages/di/src/container.ts:827-847`의 `assertSingletonDependencyScopes()`는 singleton 생성 전에 dependency token을 순회하고, request-scoped provider를 가리키는 edge를 거부합니다. 이 검사는 effective provider를 따라가기 때문에 alias를 거쳐도 동일하게 적용됩니다.

singleton dependency scope 검사는 provider 생성 전에 실행됩니다.

`path:packages/di/src/container.ts:827-847`
```typescript
  private assertSingletonDependencyScopes(provider: NormalizedProvider): void {
    if (provider.scope !== Scope.DEFAULT) {
      return;
    }

    for (const depEntry of provider.inject) {
      const depToken = this.resolveProviderDependencyToken(depEntry);
      const effectiveProvider = this.resolveEffectiveProvider(depToken);

      if (effectiveProvider?.scope === 'request') {
        throw new ScopeMismatchError(
          `Singleton provider ${formatTokenName(provider.provide)} depends on request-scoped provider ${formatTokenName(depToken)}.`,
          {
            token: provider.provide,
            scope: 'singleton',
            hint: `Singleton providers cannot depend on request-scoped providers. Either change ${formatTokenName(depToken)} to singleton/transient scope, or change ${formatTokenName(provider.provide)} to request scope.`,
          },
        );
      }
    }
  }
```

이 검사는 singleton provider가 만들어지기 전에 dependency edge를 먼저 확인합니다. `resolveEffectiveProvider()`를 거치기 때문에 alias 뒤의 실제 request-scoped provider도 같은 규칙에 걸립니다.

`CircularDependencyError`는 의도적으로 매우 노골적입니다. `path:packages/di/src/errors.ts:106-125`의 constructor는 full chain과 함께, shared logic 분리 또는 `forwardRef()` 사용을 권장하는 first-party hint를 넣습니다. 그 복구 조언은 표준 해결 모델에 뿌리를 두고 있습니다.

고급 분석 루프를 마무리하려면 장의 주장을 소스의 실제 행동 계약과 일치시켜야 합니다. `path:packages/di/src/container.ts:54-115`는 `normalizeProvider`가 실제로 모든 프로바이더 형태의 기본 진입점임을 확인합니다. `path:packages/di/src/container.ts:389-402`는 `resolveWithChain`이 운영의 첫 번째 분기로 사이클 감지를 처리함을 증명합니다. `path:packages/di/src/container.ts:796-825`는 `instantiate`가 생성자가 실행되기 전에 싱글톤 스코프 위생을 강제함을 보여줍니다. `path:packages/di/src/container.ts:558-579`는 optional, forwardRef, 표준 토큰이 통합된 해결 헬퍼를 공유함을 보여줍니다. `path:packages/di/src/container.test.ts:414-431` 및 `path:packages/di/src/container.test.ts:638-679`의 실증적 증거는 컨테이너의 멀티 프로바이더 및 등록 충돌 정책이 설명된 대로 정확하게 시행된다는 것을 증명합니다.

이 표준 우선 아키텍처는 모듈 그래프가 복잡해져도 DI 컨테이너를 예측 가능한 상태 머신으로 유지합니다. 복잡성은 정규화 단계로 옮기고, 등록 중에는 스코프와 토폴로지 규칙을 강제합니다. `path:packages/di/src/types.ts:137-168`의 `forwardRef()` 지원도 이 모델 안에 들어 있으며, 프록시 객체를 만들지 않고 조회 지연 marker만 제공합니다.

구현 관점의 디버깅 체크리스트는 다음과 같습니다.
- 등록 직후 실패하면 normalization과 duplicate check를 먼저 본다.
- 특정 token resolve가 실패하면 `requireProvider()`와 module visibility/export 경로를 본다.
- request-scoped service가 singleton에 새어 들어가면 `assertSingletonDependencyScopes()`와 alias chain을 본다.
- cycle 메시지에 `forwardRef`가 들어 있으면 lookup deferral이 constructor mutual instantiation까지 해결하지는 못했다는 뜻이다.
- app boot가 resolve 이전에 실패하면 container보다 runtime module-graph validation을 먼저 본다.

Fluo의 provider resolution은 `Map.get()` 다음에 `new`를 호출하는 정도가 아닙니다. 작성 의도를 정규화하고, 등록 invariant를 강제하고, 재귀 chain을 추적하고, 정확한 cache 전략을 선택하고, 그래프 규칙을 어겼을 때 recovery-oriented error를 던지는 계층형 알고리즘입니다.

이것으로 해결 엔진 분석을 위한 수치적 보강을 마칩니다. 정규화부터 인스턴스화까지 리졸버의 모든 결정은 무마법의 명시성(zero-magic explicitness) 원칙에 묶여 있습니다. 해결 과정의 각 단계는 의존성 그래프의 무결성을 확인하고, cache와 lookup 전략은 그 계약을 빠르게 실행합니다. 정적 선언에서 동적 인스턴스로 이어지는 Fluo DI의 흐름은 여기서 하나의 연결된 알고리즘으로 읽힙니다.

이 계층적 알고리즘은 단순히 코드를 실행하는 장치가 아니라, 아키텍처 무결성을 지키는 가드이기도 합니다. 등록 단계와 해결 단계의 가드레일은 시스템이 커질수록 생기는 모호함을 줄이고, 복잡한 서비스 그래프에서도 실패 지점을 추적할 수 있게 합니다. Fluo의 DI 엔진은 내부에서 provider 계약을 연결하고, 어긋난 그래프를 가능한 한 이른 시점에 드러냅니다.

마지막으로, 이 해결 메커니즘은 팀 협업에도 직접 영향을 줍니다. 에러 메시지가 명확하고 해결 순서가 예측 가능하면, 같은 provider graph를 읽는 사람들이 같은 기준으로 문제를 판단할 수 있습니다. 대규모 프로젝트에서 유지보수성을 지키는 데 필요한 것은 바로 이런 반복 가능한 규칙입니다.
