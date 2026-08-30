<!-- packages: @fluojs/di, @fluojs/core, @fluojs/runtime -->
<!-- project-state: T15 Part 2 source-analysis draft for singleton, request, and transient scope internals -->

# Chapter 5. Scopes: Singleton, Request, and Transient

이 장은 Fluo DI 컨테이너가 singleton, request, transient 세 가지 수명 주기를 어떻게 캐시와 소멸 정책으로 구현하는지 설명합니다. Chapter 4에서 provider resolution의 큰 흐름을 봤다면, 이 장은 그 흐름 안에서 scope가 실제 동작을 어떻게 바꾸는지 좁혀서 분석합니다.

## Learning Objectives
- Fluo가 세 가지 scope만 유지하는 설계 이유를 이해합니다.
- singleton이 루트 컨테이너 캐시를 기준선으로 삼는 방식을 설명합니다.
- request scope가 별도 child container로 모델링되는 구조를 분석합니다.
- transient provider가 캐시를 건너뛰는 의미와 비용을 정리합니다.
- override, cache invalidation, stale disposal이 scope 정책과 어떻게 연결되는지 살펴봅니다.
- shutdown 시점의 disposal order와 소유권 모델을 추적합니다.

## Prerequisites
- Chapter 4 완료.
- Fluo 컨테이너의 provider normalization과 resolve 파이프라인에 대한 이해.
- singleton, request, transient 수명 주기의 일반적인 DI 개념 이해.

## 5.1 The scope vocabulary is small on purpose
Fluo의 scope 시스템은 의도적으로 작습니다.
`path:packages/di/src/types.ts:3-26`은 세 가지 lifetime label만 정의합니다.
`singleton`, `request`, `transient`가 전부입니다. 이 작은 vocabulary는 기능 부족이 아니라 설계 제약입니다. 여러 패키지에 걸쳐 provider lifetime을 이해 가능하게 유지하기 위한 선택입니다.

이 제한은 public type과 helper literal이 같은 위치에 묶여 있어서 더 분명합니다.

`path:packages/di/src/types.ts:3-26`
```typescript
/**
 * Lifetime policy understood by the DI container.
 */
export type Scope = 'singleton' | 'request' | 'transient';

/**
 * Namespace helpers for the public DI scope literals.
 */
export namespace Scope {
  /**
   * Default lifetime used when a provider omits an explicit scope.
   */
  export const DEFAULT: Scope = 'singleton';

  /**
   * Scope literal for providers that should be recreated per request container.
   */
  export const REQUEST: Scope = 'request';

  /**
   * Scope literal for providers that should be recreated on every resolution.
   */
  export const TRANSIENT: Scope = 'transient';
}
```

이 발췌는 새 scope가 설정 파일이나 runtime branch에서 몰래 추가되지 않는다는 점을 보여 줍니다. 컨테이너가 이해하는 lifetime vocabulary는 type alias와 namespace constant에 고정됩니다.

같은 파일의 namespace helper도 이를 잘 보여 줍니다. `Scope.DEFAULT`는 단지 `'singleton'`입니다. `Scope.REQUEST`와 `Scope.TRANSIENT`도 literal alias입니다. 모듈 로컬 cache 전용 네 번째 모드도 없고, provider pooling 전략도 없고, reflection이 암묵적으로 끼어드는 special case도 없습니다.

이 단순함은 `@Scope(...)`에도 그대로 반영됩니다.
`path:packages/core/src/decorators.ts:79-89`의 decorator는 class DI metadata에 문자열 필드 하나만 기록합니다.
그리고 `path:packages/core/src/metadata/class-di.ts:33-83`가 그 필드를 constructor lineage를 따라 상속 가능하게 만듭니다. 즉 scope는 explicit metadata와 container policy의 조합일 뿐입니다. 사용 패턴에서 추론되지 않습니다.

이 점은 예측 가능성에 직접 연결됩니다. class가 `@Scope(...)`를 생략하면,
`path:packages/di/src/container.ts:55-65` 또는 `path:packages/di/src/container.ts:91-102`의 normalization이 `Scope.DEFAULT`를 넣습니다.
즉 Fluo는 작성자가 더 짧은 lifetime을 명시하지 않는 한 singleton-first입니다.

class provider 정규화는 이 기본값을 실제 내부 record에 저장합니다.

`path:packages/di/src/container.ts:55-65`
```typescript
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
```

여기서 scope 결정은 instantiation보다 먼저 끝납니다. 이후 resolve 경로는 이 `scope` 필드를 보고 cache map을 고를 뿐, class 생성 방식을 scope마다 따로 바꾸지 않습니다.

테스트도 이 계약을 강화합니다.
`path:packages/di/src/container.test.ts:89-122`는 `Scope.REQUEST`와 `Scope.TRANSIENT` 상수가 decorator와 provider object 모두에서 동작함을 검증합니다.
`path:packages/di/src/container.test.ts:68-87`은 같은 metadata 경로가 `@Inject`와 `@Scope` 조합에서도 정상 동작함을 보여 줍니다.

고급 독자가 눈여겨봐야 할 점은, scope 선택이 instantiation 이전에 완료된다는 사실입니다. `normalizeProvider()`는 scope를 계산해 normalized record에 저장합니다. 그 이후 scope는 cache selection과 guardrail에만 영향을 줍니다. 객체 생성 코드를 바꾸지는 않습니다.

그래서 정신 모델이 깔끔해집니다. constructor 경로는 하나입니다. 그 바깥에 여러 cache policy가 둘러싸여 있습니다. provider의 scope label이 어떤 policy를 적용할지 결정합니다.

의사코드로 줄이면 lifetime 시스템은 이 한 줄에서 시작합니다.

```text
provider.scope = explicit provider scope
  or inherited class scope metadata
  or singleton default
```

```typescript
import { Container } from '@fluojs/di';
import { Scope } from '@fluojs/core';

@Scope('request')
class RequestBase {}

@Scope('transient')
class ExplicitTransient {}

class InheritedRequest extends RequestBase {}
class DefaultSingleton {}

const root = new Container().register(ExplicitTransient, InheritedRequest, DefaultSingleton);
const request = root.createRequestScope();

// explicit decorator가 있으면 그 scope가 그대로 적용됩니다.
const transientA = await request.resolve(ExplicitTransient);
const transientB = await request.resolve(ExplicitTransient);
// decorator가 없더라도 base class metadata는 상속됩니다.
const inherited = await request.resolve(InheritedRequest);
// 아무 scope도 없으면 기본값은 singleton입니다.
const singleton = await root.resolve(DefaultSingleton);
```

이 장의 나머지는 이 한 줄이 실제 cache, request boundary, disposal order로 어떻게 확장되는지 추적합니다.

## 5.2 Singleton caching and the root container baseline
singleton은 기본 lifetime이지만, Fluo의 singleton 동작은 단순한 "영원히 객체 하나"보다 더 정밀합니다. 실제로는 "문서화된 override 경로가 없는 한 root singleton cache에 token별 promise 하나"에 가깝습니다.

cache field와 construction boundary는 `path:packages/di/src/container.ts:296-347`에 선언되어 있습니다. single provider 쪽의 핵심은 `singletonCache: Map<Token, Promise<unknown>>`입니다. multi provider는 `multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>`를 따로 가집니다.

컨테이너 field를 보면 singleton, request, multi provider가 서로 다른 cache map을 갖는 이유가 바로 드러납니다.

`path:packages/di/src/container.ts:296-347`
```typescript
private readonly registrations = new Map<Token, NormalizedProvider>();
private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
private readonly multiOverriddenTokens = new Set<Token>();
private requestCache: Map<Token, Promise<unknown>> | undefined;
private multiRequestCache: Map<NormalizedProvider, Promise<unknown>> | undefined;
private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
private readonly staleDisposalTasks = new Set<StaleDisposalTask>();
private readonly singletonCache: Map<Token, Promise<unknown>>;
private readonly forwardRefTokenCache = new WeakMap<ForwardRefFn, Token>();
private readonly factoryResolutionKinds = new WeakMap<NormalizedProvider, FactoryResolutionKind>();
private readonly providerLookupPlanCache = new Map<Token, CachedResolutionPlan<NormalizedProvider | undefined>>();
private readonly multiProviderPlanCache = new Map<Token, CachedResolutionPlan<readonly NormalizedProvider[]>>();
private readonly requestScopeVerdictPlanCache = new Map<Token, CachedResolutionPlan<boolean>>();
private readonly effectiveProviderPlanCache = new Map<Token, CachedResolutionPlan<NormalizedProvider | undefined>>();
private childScopes: Set<Container> | undefined;
private disposePromise: Promise<void> | undefined;
private disposed = false;
private trackedByParent = false;
private graphRevision = 0;

private readonly parent: Container | undefined;
private readonly requestScopeEnabled: boolean;

constructor(...construction: never[]) {
  if (construction.length > 0) {
    throw new ContainerResolutionError(
      'Container child-scope construction is package-owned and cannot be invoked directly.',
      {
        hint: 'Construct root containers with new Container() and create child scopes with container.createRequestScope().',
      },
    );
  }

  const childScope = Container.#childScopeConstruction;

  this.parent = childScope?.parent;
  this.requestScopeEnabled = childScope?.requestScopeEnabled ?? false;
  this.singletonCache = childScope?.singletonCache ?? new Map<Token, Promise<unknown>>();
}
```

public construction surface는 의도적으로 좁습니다. caller가 사용할 수 있는 형태는 `new Container()` 하나뿐이며, `...construction: never[]` signature는 consumer가 만족시킬 수 있는 인자 타입을 남기지 않습니다. parent, request-scope, singleton-cache wiring은 package-private construction path로만 전달되므로, emitted declaration에 대한 structural cast로도 위조할 수 없습니다.

이 구조 때문에 singleton cache는 token 기준이고, multi singleton cache는 개별 normalized provider 기준입니다. request cache도 같은 분리를 반복하지만 child container의 소유물이 됩니다.

root container가 singleton cache state를 소유합니다.
`path:packages/di/src/container.ts:609-622`의 `createRequestScope()`는 `this.root().singletonCache`를 넘겨 child container를 생성합니다.
즉 request scope는 singleton state를 복제하지 않습니다. 공유합니다.

request child 생성 코드는 그 공유를 package-private construction path로 넘깁니다. 다음 source excerpt는 `Container` 메서드 본문입니다. 여기의 `#createChildScope` 호출은 private class-member access이므로 consumer가 복사하거나 호출할 수 있는 application code가 아닙니다.

`path:packages/di/src/container.ts:609-622`
```typescript
createRequestScope(): Container {
  if (this.isDisposedInHierarchy()) {
    throw new ContainerResolutionError(
      'Container has been disposed and can no longer create request scopes.',
      { hint: 'Create request scopes before calling container.dispose().' },
    );
  }

  return Container.#createChildScope({
    parent: this,
    requestScopeEnabled: true,
    singletonCache: this.root().singletonCache,
  });
}
```

따라서 request child는 parent와 request flag를 갖지만, singleton promise map은 root의 것을 봅니다. construction path가 package-private이므로 그 wiring에 도달하는 경로는 `createRequestScope()`뿐이며, application 코드가 다른 컨테이너의 singleton cache를 넘겨줄 수 없습니다. 빈 scope shell은 즉시 추적되지 않습니다. `path:packages/di/src/container.ts:1144-1153`의 `ensureTrackedRequestScope()`와 `path:packages/di/src/container.ts:1155-1166`의 lazy request-cache writer는 request-owned cache state가 처음 materialize될 때 child chain을 연결합니다. 이 방식은 chapter의 ownership rule을 유지하면서 descendant invalidation과 disposal이 생성된 모든 scope object가 아니라 실제 request cache를 대상으로 동작하게 합니다.

이 구조는 resolution 단계에서 다시 강제됩니다.
`path:packages/di/src/container.ts:1032-1041`의 `resolveScopedOrSingletonInstance()`는 먼저 `cacheOwnerFor(provider)`에 cache를 소유할 container를 묻습니다.
`path:packages/di/src/container.ts:1087-1098`의 `cacheOwnerFor()`는 local default provider를 request child에 남기고 inherited default provider를 parent/root cache owner로 위임합니다.

실제 cache map 선택은 `cacheFor()`가 합니다.
`path:packages/di/src/container.ts:1191-1213`가 핵심 규칙을 보여 줍니다.
default-scope provider는 원칙적으로 root `singletonCache`를 사용합니다. 단 request child에 locally registered된 경우만 예외적으로 request cache를 사용합니다. 메서드 주석이 이 예외를 일부러 footgun으로 문서화하는 이유도 여기에 있습니다.

cache 선택 규칙은 한 번만 자세히 보겠습니다. 뒤의 request, override, disposal 문단은 이 발췌를 전제로 recap만 붙입니다.

`path:packages/di/src/container.ts:1191-1213`
```typescript
private cacheFor(provider: NormalizedProvider): Map<Token, Promise<unknown>> {
  if (provider.scope === Scope.DEFAULT) {
    if (this.requestScopeEnabled && this.registrations.has(provider.provide)) {
      return this.requestCacheForWrite();
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

  return this.requestCacheForWrite();
}
```

이 발췌는 세 가지 주장을 동시에 지원합니다. default provider는 root singleton cache로 갑니다. request child의 local default registration만 request cache 예외가 됩니다. request provider를 root에서 resolve하면 cache miss가 아니라 명시적 error가 납니다.

테스트는 외부에서 보이는 singleton identity를 보여 줍니다.
`path:packages/di/src/container.test.ts:10-19`는 같은 singleton token을 두 번 resolve하면 동일 인스턴스가 돌아옴을 검증합니다.
`path:packages/di/src/container.test.ts:756-778`은 request-scope override가 root singleton cache를 오염시키지 않음을 증명합니다.

이 마지막 테스트는 특히 중요합니다. root는 원래 singleton을 resolve합니다. request child가 같은 token을 override합니다. child는 override를 봅니다. 하지만 root와 두 번째 request child는 여전히 원래 root singleton을 봅니다. 이것은 root singleton state가 계층 전체의 기준선이고, child override state는 국지적이기 때문에 가능한 동작입니다.

더 강한 회귀 테스트도 있습니다.
`path:packages/di/src/container.test.ts:780-805`에서는 request child가 `ConfigService`를 override해도,
root singleton consumer의 dependency graph는 바뀌지 않습니다. request child가 받아 가는 consumer 역시 이미 root에 캐시된 singleton consumer이며, 그 안에는 root config가 묶여 있습니다. Fluo가 graph stability를 얼마나 강하게 우선하는지 보여 주는 부분입니다.

singleton 알고리즘은 다음처럼 정리할 수 있습니다.

```text
if provider.scope is singleton:
  if current container is request child and provider is inherited from root:
    resolve through root cache
  else:
    resolve through local/request-local path defined by cacheFor()
  cache promise by token
```

```typescript
import { Container } from '@fluojs/di';
import { Scope } from '@fluojs/core';

@Scope('singleton')
class ConfigService {
  constructor(readonly source: string = 'root') {}
}

const root = new Container().register(ConfigService);
const first = await root.resolve(ConfigService);
const second = await root.resolve(ConfigService);

const request = root.createRequestScope();
request.override({ provide: ConfigService, useFactory: () => new ConfigService('request') });

// root에서는 같은 singleton promise/cache를 계속 재사용합니다.
const rootValue = await root.resolve(ConfigService);
// request child override는 자기 child 안에서만 보입니다.
const requestValue = await request.resolve(ConfigService);

console.log(first === second, rootValue.source, requestValue.source);
```

핵심 구현 포인트는 Fluo가 settled instance가 아니라 promise를 cache한다는 점입니다.
`path:packages/di/src/container.ts:538-545`는 await하기 전에 promise를 먼저 저장합니다.
그래서 같은 singleton token에 대한 동시 construction이 중복 실행되지 않습니다. 만약 construction이 실패하면 catch handler가 cache entry를 삭제합니다.

promise cache 자체는 짧은 분기 하나로 구현됩니다.

`path:packages/di/src/container.ts:536-547`
```typescript
const cache = this.cacheFor(provider);

if (!cache.has(provider.provide)) {
  const promise = this.instantiate(provider, chain, activeTokens).catch((error: unknown) => {
    cache.delete(provider.provide);
    throw error;
  });

  cache.set(provider.provide, promise);
}

return cache.get(provider.provide);
```

`await`보다 `cache.set()`이 먼저 나오기 때문에 동시 resolve는 같은 promise를 공유합니다. 실패 시 삭제하는 branch는 다음 resolve가 실패한 promise를 영구 재사용하지 않게 만듭니다.

## 5.3 Request scope is a child container, not a flag on a provider
request lifetime은 구조적으로 모델링됩니다. 단순히 "이 provider는 자주 다시 만들어라"라는 label이 아닙니다. Fluo는 request boundary마다 child container를 실제로 만듭니다.

`path:packages/di/src/container.ts:609-622`의 `createRequestScope()`는 package-private child construction path를 호출합니다.
이 construction 안에 세 가지 결정이 들어 있습니다. child는 parent reference를 갖습니다. request-scope enabled 상태가 됩니다. 그리고 root singleton cache를 공유합니다.

즉 request scope는 root container 내부의 특별한 cache bucket이 아닙니다. 자기 own `requestCache`와 `multiRequestCache`를 가진 별도 container instance입니다. 이 field들은 `path:packages/di/src/container.ts:300-301`에 선언되어 있습니다.

request-only resolution은 `cacheFor()`와 `multiCacheFor()`에서 강제됩니다. provider scope가 `request`인데 `requestScopeEnabled`가 false이면, 컨테이너는 `container.createRequestScope()`를 사용하라는 힌트와 함께 `RequestScopeResolutionError`를 던집니다. 코드는 `path:packages/di/src/container.ts:1191-1213`와 `path:packages/di/src/container.ts:1214-1236`에 있습니다.

위 `cacheFor()` 발췌가 single provider의 request guard를 이미 보여 주므로 여기서는 multi provider 쪽만 보강하면 충분합니다.

`path:packages/di/src/container.ts:1214-1236`
```typescript
private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
  if (provider.scope === Scope.DEFAULT) {
    if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
      return this.multiRequestCacheForWrite();
    }

    return this.root().multiSingletonCache;
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

  return this.multiRequestCacheForWrite();
}
```

single provider와 multi provider는 key만 다를 뿐 같은 tier 규칙을 따릅니다. 그래서 request boundary 설명은 두 cache helper를 따로 반복하지 않아도 한 모델로 읽을 수 있습니다.

이 영역에서 가장 중요한 테스트는 첫 번째 것입니다.
`path:packages/di/src/container.test.ts:42-66`은 root에 request-scoped provider를 등록하고,
root resolution이 실패함을 확인한 뒤, 같은 child 안에서는 동일 인스턴스를 재사용하고 다른 child끼리는 다른 인스턴스를 받음을 보여 줍니다. 이 테스트 하나가 request scope 계약 전체를 설명합니다.

이 경우는 구현보다 테스트가 public contract를 더 압축해서 보여 줍니다.

`path:packages/di/src/container.test.ts:42-66`
```typescript
it('keeps request-scoped providers unique per request scope', async () => {
  let created = 0;

  class RequestStore {
    readonly id = ++created;
  }

  const root = new Container().register({
    provide: RequestStore,
    scope: 'request',
    useClass: RequestStore,
  });

  await expect(root.resolve(RequestStore)).rejects.toThrow('outside request scope');

  const requestA = root.createRequestScope();
  const requestB = root.createRequestScope();

  const a1 = await requestA.resolve(RequestStore);
  const a2 = await requestA.resolve(RequestStore);
  const b1 = await requestB.resolve(RequestStore);

  expect(a1).toBe(a2);
  expect(a1).not.toBe(b1);
});
```

여기서는 root error, same-child reuse, sibling isolation이 한 테스트에 함께 있습니다. 그래서 request cache helper만 보는 것보다 독자가 실제 보장 범위를 더 빨리 확인할 수 있습니다.

request-scope registration 자체에도 작성 경계가 있습니다.
`path:packages/di/src/container.ts:163-172`는 request child에 default singleton을 직접 등록하는 것을 금지합니다.
대응 테스트는 `path:packages/di/src/container.test.ts:485-491`입니다. Fluo는 request child를 두 번째 root container처럼 쓰는 것을 막고 싶어 합니다. request child의 주된 역할은 resolution boundary입니다.

multi provider도 같은 request 경계를 공유합니다.
`path:packages/di/src/container.test.ts:693-720`은 request-scoped multi provider가 request child마다 별도 캐시됨을 보여 줍니다.
같은 child 안의 두 resolve는 같은 entry 인스턴스를 돌려주고, 다른 child는 다른 인스턴스를 받습니다.

request-scope 흐름은 다음과 같습니다.

```text
root.createRequestScope() -> child container
child inherits root singleton cache
child owns request cache
request-scoped providers must resolve in child
each child isolates request-scoped instances from sibling children
```

```typescript
import { Container, RequestScopeResolutionError } from '@fluojs/di';
import { Scope } from '@fluojs/core';

let created = 0;

@Scope('request')
class RequestStore {
  readonly id = ++created;
}

const root = new Container().register(RequestStore);

// request provider를 root에서 바로 resolve하면 에러가 납니다.
const rootError = await root.resolve(RequestStore).catch((error: unknown) => error);
const request = root.createRequestScope();
const first = await request.resolve(RequestStore);
const second = await request.resolve(RequestStore);

console.log(rootError instanceof RequestScopeResolutionError, first === second, first.id);
```

구현 관점에서 이 구조는 힘이 있습니다. `Container` reference만 있으면 HTTP든 다른 transport든 bounded request lifetime을 만들 수 있습니다. DI 추상화가 transport-neutral하게 유지되는 이유가 여기에 있습니다.

## 5.4 Transient providers skip caches entirely
transient scope는 의미론적으로 가장 단순한 lifetime이고, 개념적으로는 가장 쉽게 오해되는 lifetime입니다. 뜻은 "이 token이 resolve될 때마다 새 인스턴스를 만든다"입니다. "consumer class마다 한 번"도 아니고, "처음 만든 뒤 복제"도 아닙니다.

type-level label은 `path:packages/di/src/types.ts:20-26`에서 옵니다. 실제 런타임 동작은 `path:packages/di/src/container.ts:426-428`과 `path:packages/di/src/container.ts:500-502`에 있습니다. 컨테이너가 `provider.scope === 'transient'`를 보는 순간, 그 provider는 바로 `instantiate()`로 갑니다. token cache write는 없습니다.

transient 분기는 cache helper를 호출하기 전에 빠져나갑니다.

`path:packages/di/src/container.ts:419-432`
```typescript
const provider = this.requireProvider(token);
const existingTarget = this.resolveExistingProviderTarget(provider);

if (existingTarget !== undefined) {
  return await this.resolveAliasTarget(existingTarget as Token<T>, token, chain, activeTokens);
}

if (provider.scope === 'transient') {
  return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) => this.instantiate(provider, c, at))) as T;
}

return (await this.withTokenInChain(token, chain, activeTokens, async (c, at) =>
  this.resolveScopedOrSingletonInstance(provider, c, at),
)) as T;
```

이 코드에서 transient는 `resolveScopedOrSingletonInstance()`로 내려가지 않습니다. 그러므로 singleton/request cache 선택, promise 저장, cache invalidation은 transient token 자체에는 적용되지 않습니다.

그래서 transient 테스트는 아주 직접적입니다.
`path:packages/di/src/container.test.ts:124-160`은 transient token을 두 번 resolve하고 서로 다른 인스턴스임을 확인합니다.
`path:packages/di/src/container.test.ts:162-181`은 request scope 내부에서도 동일한 규칙이 유지됨을 보여 줍니다.
request scope는 transient semantics를 바꾸지 않습니다.

흥미로운 뉘앙스는 dependency graph에서 나타납니다.
`path:packages/di/src/container.test.ts:183-200`은 singleton이 transient provider에 의존할 수 있음을 증명합니다.
겉보기엔 모순 같지만 construction 시점과 이후 resolve를 분리해서 보면 자연스럽습니다. singleton은 자기 자신이 생성되는 순간 transient 인스턴스 하나를 받습니다. 그 이후 다른 위치에서 transient token을 resolve하면 여전히 새 인스턴스가 나옵니다.

반대로 문제가 되는 edge는 Fluo가 명시적으로 금지합니다.
`path:packages/di/src/container.ts:827-847`의 `assertSingletonDependencyScopes()`는 singleton -> request dependency를 거부하지만,
singleton -> transient dependency는 허용합니다. 즉 Fluo의 lifetime 모델은 긴 lifetime 객체가 더 짧은 lifetime 참조를 붙들었을 때의 안전성을 기준으로 설계되어 있습니다. transient는 ambient request identity가 없기 때문에 안전합니다.

금지되는 쪽은 dependency scope check에 `request`만 명시되어 있습니다.

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

이 발췌는 transient 허용을 부정형으로 증명합니다. singleton provider의 dependency 검사에서 막는 대상은 request-scoped provider뿐이며, transient는 별도 ambient scope를 요구하지 않습니다.

transient 알고리즘은 거의 자명합니다.

```text
if provider.scope is transient:
  resolve dependencies now
  instantiate provider now
  return instance without caching
```

```typescript
import { Container } from '@fluojs/di';
import { Inject, Scope } from '@fluojs/core';

@Scope('transient')
class QueryBuilder {
  readonly id = Symbol('query-builder');
}

@Inject(QueryBuilder)
class ReportService {
  constructor(private readonly builder: QueryBuilder) {}

  currentBuilder() {
    return this.builder;
  }
}

const container = new Container().register(QueryBuilder, ReportService);
// transient token은 resolve할 때마다 새 인스턴스를 만듭니다.
const first = await container.resolve(QueryBuilder);
const second = await container.resolve(QueryBuilder);
// singleton consumer가 transient를 받는 것은 허용됩니다.
const report = await container.resolve(ReportService);

console.log(first === second, report.currentBuilder() instanceof QueryBuilder);
```

하지만 아키텍처적 의미는 작지 않습니다. transient provider는 request-scope 인프라를 도입하지 않고도, 사용 시점마다 fresh object가 필요할 때 선택할 수 있는 가장 낮은 비용의 탈출구입니다. 가벼운 mapper, builder, 임시 logger decorator, adapter object 같은 곳에 잘 맞습니다.

대가도 분명합니다. 컨테이너가 결과를 전혀 cache하지 않기 때문에, 매 resolve마다 full dependency resolution과 instantiation 비용을 다시 지불합니다. 그래서 구현자가 던져야 할 질문은 correctness만이 아닙니다. 반복 생성이 의도된 것인지, 그리고 그 비용이 감당 가능한지까지 포함됩니다.

## 5.5 Overrides, cache invalidation, and stale instance disposal
컨테이너의 가장 미묘한 lifetime 동작은, 이미 resolve된 뒤의 provider를 override할 때 나타납니다. 바로 여기서 scope와 cache invalidation, disposal이 만납니다.

현재 `override()` 구현은 `path:packages/di/src/container.ts:384-457`에 있습니다. 먼저 token별 전체 replacement set을 normalize하고 검증합니다. 각 token이 유효하면 single 또는 multi registration을 교체하기 전에 현재 container hierarchy에서 영향을 받는 cached entry를 무효화합니다.

`path:packages/di/src/container.ts:423-454`
```typescript
for (const [token, normalizedProviders] of normalizedByToken) {
  const firstProvider = normalizedProviders[0];

  if (!firstProvider) {
    continue;
  }

  const containsMultiProvider = normalizedProviders.some((normalized) => normalized.multi === true);

  if (containsMultiProvider && normalizedProviders.some((normalized) => normalized.multi !== true)) {
    throw new DuplicateProviderError(token);
  }

  if (!containsMultiProvider && normalizedProviders.length > 1) {
    throw new DuplicateProviderError(token);
  }

  this.invalidateAffectedCachedEntriesInHierarchy(token);
  this.registrations.delete(token);
  this.multiRegistrations.delete(token);

  if (containsMultiProvider) {
    this.multiRegistrations.set(token, normalizedProviders);
    this.multiOverriddenTokens.add(token);
    this.advanceGraphRevision();
    continue;
  }

  this.multiOverriddenTokens.add(token);
  this.registrations.set(token, firstProvider);
  this.advanceGraphRevision();
}
```

hierarchy walk은 `path:packages/di/src/container.ts:1551-1605`에 구현되어 있습니다. override를 받은 컨테이너와 추적 중인 모든 request-scope descendant를 방문합니다. `path:packages/di/src/container.ts:1066-1087`에서 보듯 request scope는 request cache 또는 request-local multi cache를 처음 materialize할 때 추적 대상이 됩니다. 따라서 root override는 이미 materialize된 descendant request entry 중 overridden token 자체와, provider graph가 그 token에 의존하는 cached consumer를 evict할 수 있습니다. direct, alias, multi-provider dependency path를 포괄하는 dependency-aware 검사는 `path:packages/di/src/container.ts:1607-1662`에 있습니다.

이는 targeted invalidation이지, 모든 child cache를 비우거나 각 child가 ancestor 변경으로부터 격리된다는 보장이 아닙니다. 영향을 받는 materialized entry가 없는 descendant에는 retire할 대상이 없고, 이후 resolve는 갱신된 ancestor graph를 따릅니다. child-local override는 해당 child와 그 descendant만 순회하며 ancestor는 순회하지 않습니다. 또한 cache eviction이 application code가 이미 보관 중인 stale reference를 회수할 수는 없습니다.

evict된 각 cached promise는 `path:packages/di/src/container.ts:1309-1340`의 `scheduleStaleDisposal()`로 전달됩니다. `override()`는 여전히 동기적입니다. 비동기 retirement task를 시작하지만 cleanup 완료를 기다리지는 않습니다. task는 cached resolution promise를 기다리고, resolve된 값이 disposable이면 `onDestroy()`도 await합니다. 완료가 보장되는 시점은 `override()`가 반환하는 순간이 아니라 다음 observing lifecycle boundary입니다.

stale disposal은 이제 shutdown-only error accumulator가 아니라 task state machine입니다. `StaleDisposalTask`는 promise, failure, 그리고 failure가 이미 소비되었는지를 기록합니다(`path:packages/di/src/container.ts:31-36`). `resolve()`는 replacement resolution을 시작하기 전에 `assertStaleDisposalsSettled()`를 호출합니다(`path:packages/di/src/container.ts:584-595`). disposal도 `disposeCache()`를 통해 같은 경계에 도달하며(`path:packages/di/src/container.ts:1181-1197`), cleanup이 계속될 수 있도록 resolution failure와 일반 `onDestroy()` failure도 함께 수집합니다.

`path:packages/di/src/container.ts:1289-1340`
```typescript
private async assertStaleDisposalsSettled(): Promise<void> {
  const errors: unknown[] = [];

  while (this.staleDisposalTasks.size > 0) {
    const tasks = Array.from(this.staleDisposalTasks);
    await Promise.all(tasks.map((task) => task.promise));

    for (const task of tasks) {
      this.staleDisposalTasks.delete(task);

      if (task.failed && !task.errorConsumed) {
        task.errorConsumed = true;
        errors.push(task.error);
      }
    }
  }

  this.throwDisposalErrors(errors);
}

private scheduleStaleDisposal(instancePromise: Promise<unknown>, staleDisposalOwner: Container): void {
  const observers = staleDisposalOwner === this ? [this] : [this, staleDisposalOwner];
  const task: StaleDisposalTask = {
    error: undefined,
    errorConsumed: false,
    failed: false,
    promise: Promise.resolve(),
  };

  task.promise = (async () => {
    try {
      const instance = await instancePromise;

      if (this.isDisposable(instance)) {
        await instance.onDestroy();
      }
    } catch (error) {
      task.error = error;
      task.failed = true;
    }
  })().finally(() => {
    if (!task.failed) {
      for (const observer of observers) {
        observer.staleDisposalTasks.delete(task);
      }
    }
  });

  for (const observer of observers) {
    observer.staleDisposalTasks.add(task);
  }
}
```

observer set이 lifecycle boundary를 정확히 정의합니다. local override는 해당 컨테이너가 관찰합니다. ancestor override가 descendant cache를 무효화하면 그 descendant와 invalidation을 시작한 ancestor가 같은 task를 관찰합니다. 따라서 descendant replacement resolve와 root replacement resolve 모두 영향을 받은 descendant retirement를 기다립니다. 반면 unrelated root resolve는 child-local override를 기다리지 않으며, child-local stale-disposal failure도 그 unrelated root resolve로 유출되지 않습니다.

stale disposal이 실패하면 observing container의 다음 `resolve()` 또는 `dispose()` 중 처음 도달한 호출이 failure를 소비하고 전파합니다. `resolve()`는 replacement를 만들기 전에 reject하며, task failure는 한 번만 소비되므로 retry는 계속 진행할 수 있습니다. `dispose()`는 failure를 기록하고 나머지 teardown을 계속한 뒤, 단일 error 또는 여러 cleanup path가 실패했을 때 `AggregateError`를 던집니다(`path:packages/di/src/container.ts:1342-1359`). 따라서 failure reporting은 shutdown 시점에만 미뤄지지 않습니다.

테스트는 각 경계를 고정합니다. `path:packages/di/src/container.test.ts:503-690`은 direct, dependency-aware, materialized child, nested descendant invalidation을 다룹니다. `path:packages/di/src/container.test.ts:1959-2016`은 replacement resolution의 대기와 stale-disposal failure 수신을 증명합니다. `path:packages/di/src/container.test.ts:2045-2188`은 descendant disposal, root 대기, descendant failure propagation을 다룹니다. `path:packages/di/src/container.test.ts:2190-2248`은 child-local/unrelated-root 경계를 고정하고, `path:packages/di/src/container.test.ts:2251-2329`는 multi-provider 및 반복 override retirement를 다룹니다.

override-and-retire state machine은 이렇게 정리할 수 있습니다.

```text
override(owner, token, replacements):
  validate the complete replacement set
  walk owner and already-materialized descendants
  evict direct and dependency-affected cache entries
  start one stale-disposal task per evicted cached promise
  let the evicted container and invalidation owner observe that task
  install the replacement registration
  return without waiting

before resolve(observer):
  await every observed stale-disposal task
  propagate each unconsumed failure once
  only then resolve the replacement

during dispose(observer):
  settle observed stale-disposal tasks and collect failures
  continue ordinary cache teardown
  report one error or an AggregateError
```

```typescript
import { Container } from '@fluojs/di';

const CACHE_TOKEN = Symbol('CACHE_TOKEN');
const events: string[] = [];

class FirstCache {
  async onDestroy() {
    events.push('first disposed');
  }
}

class SecondCache {}

const container = new Container().register({ provide: CACHE_TOKEN, useClass: FirstCache });
const stale = await container.resolve<FirstCache>(CACHE_TOKEN);

container.override({ provide: CACHE_TOKEN, useClass: SecondCache });
// resolve()는 stale 인스턴스의 onDestroy()가 settle할 때까지 기다립니다.
const fresh = await container.resolve<SecondCache>(CACHE_TOKEN);
console.log(stale instanceof FirstCache, fresh instanceof SecondCache, events);
```

이 부분은 Fluo가 DI를 단순 constructor helper가 아니라 lifecycle system으로 취급한다는 증거입니다. 컨테이너는 초기 생성만큼이나 stale object의 retirement 경로도 엄격하게 관리합니다.

테스트 harness나 hot-reload 비슷한 흐름을 만드는 고급 사용자라면, 여기서 중요한 교훈은 이것입니다. `override()`는 registration state와 lifetime state를 함께 바꾸지만, 비동기 settlement boundary는 다음 observing `resolve()` 또는 `dispose()`에 있습니다. `override()`가 반환했다는 이유만으로 stale cleanup이 끝났다고 가정해서는 안 됩니다.

## 5.6 Disposal order, child scopes, and shutdown guarantees
마지막 scope 질문은 인스턴스가 어떻게 죽느냐입니다. Fluo의 답은 deterministic teardown이며, root singleton과 request child를 명확히 분리합니다.

public `dispose()` entrypoint와 origin-aware helper는 `path:packages/di/src/container.ts:616-640`에 있습니다. public 호출은 direct ownership으로 진입하고 parent traversal은 private `disposeFromParent()` entrypoint를 사용합니다. 두 경로 모두 `disposeWithOrigin(...)`을 호출합니다.

shared helper는 재진입, 실패 재시도, active attempt의 origin을 함께 다룹니다.

`path:packages/di/src/container.ts:616-640`
```typescript
async dispose(): Promise<void> {
  await this.disposeWithOrigin('direct');
}

private async disposeFromParent(): Promise<void> {
  await this.disposeWithOrigin('parent');
}

private async disposeWithOrigin(origin: DisposalAttemptOrigin): Promise<void> {
  if (this.disposePromise) {
    await this.disposePromise;
    return;
  }

  this.disposed = true;
  this.advanceGraphRevision();
  this.disposePromise = this.disposeAll(origin);

  try {
    await this.disposePromise;
  } catch (error) {
    this.disposePromise = undefined;
    throw error;
  }
}
```

동시 caller는 active promise를 기다리므로 겹치는 caller가 teardown을 중복 실행하지 않습니다. 첫 caller는 나중 caller가 참여하기 전에 이미 direct 또는 parent ownership을 선택합니다. 성공한 attempt는 settle된 promise를 유지해 이후 호출을 멱등으로 만듭니다. 실패하면 settlement 뒤 promise를 비워 이후 명시적 호출이 재시도할 수 있습니다. Terminal `disposed` gate는 재시도 중과 이후에도 닫힌 상태를 유지합니다.

`path:packages/di/src/container.ts:642-672`의 `disposeAll()`은 추적 중인 모든 request child에 `disposeFromParent()`로 진입한 뒤 현재 tier를 정리합니다. 마지막 detach 조건은 성공한 parent-owned attempt와 settle된 모든 direct attempt를 구분합니다.

origin-aware child traversal과 detach 규칙은 이 동작의 핵심입니다.

`path:packages/di/src/container.ts:642-672`
```typescript
private async disposeAll(origin: DisposalAttemptOrigin): Promise<void> {
  const errors: unknown[] = [];
  let completed = false;

  try {
    if (this.childScopes && this.childScopes.size > 0) {
      const childResults = await Promise.allSettled(
        Array.from(this.childScopes).map((child) =>
          child.disposeFromParent(),
        ),
      );

      for (const result of childResults) {
        if (result.status === 'rejected') {
          this.collectDisposalError(result.reason, errors);
        }
      }
    }

    try {
      await this.disposeCache(this.disposalCacheEntries());
    } catch (error) {
      this.collectDisposalError(error, errors);
    }

    this.throwDisposalErrors(errors);
    completed = true;
  } finally {
    if ((completed || origin === 'direct') && this.parent && this.trackedByParent) {
      this.parent.childScopes?.delete(this);
      this.trackedByParent = false;
    }
  }
}
```

Disposal 재시도는 다음 다섯 ownership 규칙을 따릅니다.

1. public `child.dispose()`를 직접 호출하면 request child는 active attempt가 settle된 뒤 parent graph에서 분리됩니다. 유지된 `onDestroy()` hook이 실패해도 분리됩니다.
2. 분리된 child 참조를 유지한 caller는 `dispose()`를 다시 호출할 수 있습니다. 이 호출은 해당 child의 실패한 hook만 재시도하며 성공한 sibling hook은 반복하지 않습니다.
3. parent 또는 root disposal이 먼저 진입한 child는 실패 후에도 parent가 계속 추적합니다. 이후 parent 또는 root `dispose()`는 parent나 root가 유지한 hook보다 그 child를 먼저 재시도합니다.
4. 동시 direct caller와 parent caller는 하나의 active attempt를 공유합니다. shared attempt를 시작한 caller가 direct 또는 parent ownership을 결정합니다. 나중에 참여한 caller는 이를 바꿀 수 없습니다.
5. parent가 유지한 child를 나중에 `child.dispose()`로 직접 재시도하면 해당 direct attempt가 settle된 뒤 child를 분리합니다. direct 재시도가 다시 실패해도 분리됩니다.

모든 child attempt는 parent tier가 시작되기 전에 settle됩니다. Parent와 root는 같은 호출에서 자신의 cleanup도 시도하고 해당 attempt의 모든 실패를 aggregate합니다.

cache entry 선택도 root와 child로 나뉩니다.
`path:packages/di/src/container.ts:1197-1213`의 `disposalCacheEntries()`는 child container에서는 request cache와 multi request cache만 반환하고,
root에서는 singleton cache와 multi singleton cache를 반환합니다. 즉 request child 하나를 dispose해도 root singleton은 파괴되지 않습니다.

tier별 cache ownership은 disposal 대상 목록에서도 반복됩니다.

`path:packages/di/src/container.ts:1197-1213`
```typescript
private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
  if (this.parent) {
    const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> =
      Array.from(this.requestCache?.entries() ?? []);

    for (const [provider, promise] of this.multiRequestCache?.entries() ?? []) {
      entries.push([provider, promise]);
    }

    return entries;
  }

  const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.singletonCache.entries());
  for (const [provider, promise] of this.multiSingletonCache.entries()) {
    entries.push([provider, promise]);
  }
  return entries;
}
```

이 발췌는 request child disposal이 root singleton을 건드리지 않는 이유를 직접 보여 줍니다. child는 request cache만 내놓고, root만 singleton cache를 내놓습니다.

실제 instance 수집은 `path:packages/di/src/container.ts:1239-1269`의 `collectDisposableInstances()`에서 `Promise.allSettled`로 수행됩니다. 이 점이 중요합니다. provider promise 하나가 reject되어도, 컨테이너는 다른 disposable instance들을 계속 모을 수 있습니다. 첫 시도에서는 `disposeInstancesInReverseOrder()`가 `onDestroy()`를 생성 역순으로 호출합니다. 실패한 instance만 원래 생성 순서로 다시 저장하므로 다음 명시적 시도는 그 유지 목록을 다시 뒤집어 같은 destruction order를 지키면서 성공한 hook을 다시 방문하지 않습니다.

수집과 호출은 일부 실패를 견디도록 분리되어 있습니다.

`path:packages/di/src/container.ts:1215-1286`
```typescript
const {
  disposables: materializedDisposables,
  errors: resolutionErrors,
} = await this.collectDisposableInstances(entries);
const disposables = this.pendingDisposables.length > 0
  ? this.pendingDisposables
  : materializedDisposables;

errors.push(...resolutionErrors);
errors.push(...(await this.disposeInstancesInReverseOrder(disposables)));

this.clearDisposalCaches();
this.throwDisposalErrors(errors);

private async disposeInstancesInReverseOrder(disposables: readonly Disposable[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  const pendingDisposables: Disposable[] = [];

  for (const instance of [...disposables].reverse()) {
    try {
      await instance.onDestroy();
    } catch (error) {
      errors.push(error);
      pendingDisposables.unshift(instance);
    }
  }

  this.pendingDisposables.splice(0, this.pendingDisposables.length, ...pendingDisposables);
  return errors;
}
```

수집, 유지된 ownership, reverse loop가 함께 보이므로 이 발췌는 실패 격리, 생성 역순 정리, 성공한 hook의 exactly-once completion이라는 세 보장을 동시에 설명합니다.

테스트는 보장을 명확하게 설명합니다.
`path:packages/di/src/container.test.ts:1625-1647`은 reverse-order singleton disposal을 검증합니다.
`path:packages/di/src/container.test.ts:1649-1680`은 request child disposal이 request instance만 제거하고 root singleton은 root dispose까지 살려 둠을 증명합니다.
`path:packages/di/src/container-disposal-retry.test.ts`는 failed-only retry order, nested child-before-parent/root retry, active-attempt 공유, terminal operation 거부, 성공한 disposal의 멱등성을 증명합니다.
`path:packages/di/src/container-disposal-ownership.test.ts`는 direct detach, caller-retained retry, parent-retained retry, first-starter ownership, 이후 direct detach를 증명합니다.

실행 가능한 근거는 graph ownership을 검증하는 `packages/di/src/container-disposal-ownership.test.ts`와 failed-hook ordering 및 idempotency를 검증하는 `packages/di/src/container-disposal-retry.test.ts`에 있습니다.

request child와 root singleton의 분리는 테스트가 더 읽기 쉽습니다.

`path:packages/di/src/container.test.ts:778-809`
```typescript
it('disposes only the request cache for request-scoped containers', async () => {
  const events: string[] = [];

  class SingletonService {
    onDestroy() { events.push('singleton'); }
  }

  class RequestService {
    onDestroy() { events.push('request'); }
  }

  const root = new Container().register(
    SingletonService,
    { provide: RequestService, scope: 'request', useClass: RequestService },
  );

  const requestScope = root.createRequestScope();

  await root.resolve(SingletonService);
  await requestScope.resolve(RequestService);
  await requestScope.dispose();

  expect(events).toEqual(['request']);

  await root.dispose();

  expect(events).toEqual(['request', 'singleton']);
});
```

이 테스트는 child dispose 시점과 root dispose 시점의 event 배열을 나눠 보여 줍니다. 그래서 implementation-only proof보다 reader-facing lifecycle 보장이 더 선명합니다.

failure handling도 의도적입니다.
`path:packages/di/src/container.ts:1403-1411`의 `throwDisposalErrors()`는 에러가 하나면 그대로 던지고,
여러 개면 `AggregateError`를 던집니다.
`path:packages/di/src/container.test.ts:1793-1928`은 현재 tier 또는 child tier의 hook이 실패해도 나머지 instance와 root cleanup을 계속 수행함을 보여 줍니다.

shutdown pipeline은 이렇게 표현할 수 있습니다.

```text
dispose(container, origin):
  if another disposal attempt is active, await it without changing origin
  close the terminal operation gate
  enter all live request children with parent origin first
  collect relevant cached promises for this container tier
  await stale disposal tasks
  use retained failed hooks, or gather first-attempt disposable instances
  call onDestroy in reverse order
  retain only hooks that failed, preserving creation order
  clear caches
  throw aggregated disposal errors if any
  detach a direct child after settlement, even on failure
  detach a parent-entered child only after successful cleanup
  after every retained hook succeeds, reuse the successful promise idempotently
```

```typescript
import { Container } from '@fluojs/di';
import { Inject, Scope } from '@fluojs/core';

const events: string[] = [];

class RootDatabase {
  onDestroy() { events.push('root database'); }
}

@Inject(RootDatabase)
class RootApi {
  constructor(private readonly db: RootDatabase) {}
  onDestroy() { events.push('root api'); }
}

@Scope('request')
class RequestContext {
  onDestroy() { events.push('request context'); }
}

const root = new Container().register(RootDatabase, RootApi, RequestContext);
const request = root.createRequestScope();
await root.resolve(RootDatabase);
await root.resolve(RootApi);
await request.resolve(RequestContext);
await root.dispose();

// request child가 먼저 dispose되고, root singleton은 생성 역순으로 정리됩니다.
console.log(events); // ['request context', 'root api', 'root database']
```

구현 관점에서 이것이 scope 이야기의 완성입니다. scope는 인스턴스가 어디서 생성되고 cache되는지만 결정하지 않습니다. 어느 container tier가 그 인스턴스의 최종 destruction을 소유하는지도 결정합니다.

그래서 Fluo의 세 가지 scope 모델은 작아도 충분히 강력합니다. singleton은 root ownership을 정의하고, request는 child ownership을 정의하며, transient는 caching ownership 자체를 포기합니다. 이 세 범주를 "하나의 constructor 경로를 감싼 cache-and-disposal policy"로 이해하면, 컨테이너 전체가 훨씬 명확하게 읽히기 시작합니다.
