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

cache field는 `path:packages/di/src/container.ts:121-140`에 선언되어 있습니다. single provider 쪽의 핵심은 `singletonCache: Map<Token, Promise<unknown>>`입니다. multi provider는 `multiSingletonCache: Map<NormalizedProvider, Promise<unknown>>`를 따로 가집니다.

컨테이너 field를 보면 singleton, request, multi provider가 서로 다른 cache map을 갖는 이유가 바로 드러납니다.

`path:packages/di/src/container.ts:121-140`
```typescript
private readonly registrations = new Map<Token, NormalizedProvider>();
private readonly multiRegistrations = new Map<Token, NormalizedProvider[]>();
private readonly multiOverriddenTokens = new Set<Token>();
private readonly requestCache = new Map<Token, Promise<unknown>>();
private readonly multiRequestCache = new Map<NormalizedProvider, Promise<unknown>>();
private readonly multiSingletonCache = new Map<NormalizedProvider, Promise<unknown>>();
private readonly staleDisposalTasks = new Set<Promise<void>>();
private readonly staleDisposalErrors: unknown[] = [];
private readonly singletonCache: Map<Token, Promise<unknown>>;
private readonly childScopes = new Set<Container>();
private disposePromise: Promise<void> | undefined;
private disposed = false;

constructor(
  private readonly parent?: Container,
  private readonly requestScopeEnabled = false,
  singletonCache?: Map<Token, Promise<unknown>>,
) {
  this.singletonCache = singletonCache ?? new Map<Token, Promise<unknown>>();
}
```

이 구조 때문에 singleton cache는 token 기준이고, multi singleton cache는 개별 normalized provider 기준입니다. request cache도 같은 분리를 반복하지만 child container의 소유물이 됩니다.

root container가 singleton cache state를 소유합니다.
`path:packages/di/src/container.ts:247-263`의 `createRequestScope()`는 `this.root().singletonCache`를 넘겨 child container를 생성합니다.
즉 request scope는 singleton state를 복제하지 않습니다. 공유합니다.

request child 생성 코드는 그 공유를 constructor 인자로 직접 넘깁니다.

`path:packages/di/src/container.ts:252-263`
```typescript
createRequestScope(): Container {
  if (this.disposed) {
    throw new ContainerResolutionError(
      'Container has been disposed and can no longer create request scopes.',
      { hint: 'Create request scopes before calling container.dispose().' },
    );
  }

  const child = new Container(this, true, this.root().singletonCache);
  this.root().childScopes.add(child);
  return child;
}
```

따라서 request child는 parent와 request flag를 갖지만, singleton promise map은 root의 것을 봅니다. 이 한 줄이 "child는 boundary이고 singleton owner는 root"라는 장의 주장을 지탱합니다.

이 구조는 resolution 단계에서 다시 강제됩니다.
`path:packages/di/src/container.ts:527-548`의 `resolveScopedOrSingletonInstance()`는 먼저 `shouldResolveFromRoot(provider)`를 검사합니다.
그리고 `path:packages/di/src/container.ts:550-552`의 helper는 provider가 default-scope이고, 현재 container가 request-scoped이며, provider가 local registration이 아닐 때 true를 반환합니다. 그 경우 child는 root로 위임합니다.

실제 cache map 선택은 `cacheFor()`가 합니다.
`path:packages/di/src/container.ts:624-645`가 핵심 규칙을 보여 줍니다.
default-scope provider는 원칙적으로 root `singletonCache`를 사용합니다. 단 request child에 locally registered된 경우만 예외적으로 request cache를 사용합니다. 메서드 주석이 이 예외를 일부러 footgun으로 문서화하는 이유도 여기에 있습니다.

cache 선택 규칙은 한 번만 자세히 보겠습니다. 뒤의 request, override, disposal 문단은 이 발췌를 전제로 recap만 붙입니다.

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

이 발췌는 세 가지 주장을 동시에 지원합니다. default provider는 root singleton cache로 갑니다. request child의 local default registration만 request cache 예외가 됩니다. request provider를 root에서 resolve하면 cache miss가 아니라 명시적 error가 납니다.

테스트는 외부에서 보이는 singleton identity를 보여 줍니다.
`path:packages/di/src/container.test.ts:10-19`는 같은 singleton token을 두 번 resolve하면 동일 인스턴스가 돌아옴을 검증합니다.
`path:packages/di/src/container.test.ts:434-456`은 request-scope override가 root singleton cache를 오염시키지 않음을 증명합니다.

이 마지막 테스트는 특히 중요합니다. root는 원래 singleton을 resolve합니다. request child가 같은 token을 override합니다. child는 override를 봅니다. 하지만 root와 두 번째 request child는 여전히 원래 root singleton을 봅니다. 이것은 root singleton state가 계층 전체의 기준선이고, child override state는 국지적이기 때문에 가능한 동작입니다.

더 강한 회귀 테스트도 있습니다.
`path:packages/di/src/container.test.ts:458-483`에서는 request child가 `ConfigService`를 override해도,
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

`path:packages/di/src/container.ts:247-263`의 `createRequestScope()`는 `new Container(this, true, this.root().singletonCache)`를 호출합니다.
이 constructor 호출 안에 세 가지 결정이 들어 있습니다. child는 parent reference를 갖습니다. request-scope enabled 상태가 됩니다. 그리고 root singleton cache를 공유합니다.

즉 request scope는 root container 내부의 특별한 cache bucket이 아닙니다. 자기 own `requestCache`와 `multiRequestCache`를 가진 별도 container instance입니다. 이 field들은 `path:packages/di/src/container.ts:124-127`에 선언되어 있습니다.

request-only resolution은 `cacheFor()`와 `multiCacheFor()`에서 강제됩니다. provider scope가 `request`인데 `requestScopeEnabled`가 false이면, 컨테이너는 `container.createRequestScope()`를 사용하라는 힌트와 함께 `RequestScopeResolutionError`를 던집니다. 코드는 `path:packages/di/src/container.ts:633-645`와 `path:packages/di/src/container.ts:656-668`에 있습니다.

위 `cacheFor()` 발췌가 single provider의 request guard를 이미 보여 주므로 여기서는 multi provider 쪽만 보강하면 충분합니다.

`path:packages/di/src/container.ts:647-668`
```typescript
private multiCacheFor(provider: NormalizedProvider): Map<NormalizedProvider, Promise<unknown>> {
  if (provider.scope === Scope.DEFAULT) {
    if (this.requestScopeEnabled && this.hasLocalMultiProvider(provider)) {
      return this.multiRequestCache;
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

  return this.multiRequestCache;
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

`override()` 자체는 `path:packages/di/src/container.ts:207-234`에 구현되어 있습니다. incoming provider를 normalize하고, 기존 visible provider를 찾고, 해당 token의 single/multi registration을 모두 삭제한 뒤, `invalidateCachedEntry(token, existing?.scope ?? normalized.scope)`를 호출합니다.

override는 registration 교체 전에 lifetime state를 먼저 비웁니다.

`path:packages/di/src/container.ts:207-234`
```typescript
override(...providers: Provider[]): this {
  if (this.disposed) {
    throw new ContainerResolutionError(
      'Container has been disposed and can no longer override providers.',
      { hint: 'Ensure overrides are applied before calling container.dispose().' },
    );
  }

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

  return this;
}
```

이 순서가 중요합니다. 기존 registration만 지우고 cache를 남기면 다음 resolve가 새 provider를 보지 못할 수 있습니다. Fluo는 override를 registration update와 cache eviction의 결합으로 취급합니다.

이 invalidation routine은 `path:packages/di/src/container.ts:900-944`에 있습니다. request cache entry, root singleton cache entry, root multi singleton cache entry, request multi cache entry를 모두 검사합니다. cached promise가 있으면 cache entry를 삭제하기 전에 stale disposal을 예약합니다.

routine 전체는 길지만, stale single cache를 다루는 앞부분만으로 핵심 소유권을 볼 수 있습니다.

`path:packages/di/src/container.ts:900-923`
```typescript
private invalidateCachedEntry(token: Token, scope: Scope): void {
  if (this.requestCache.has(token)) {
    const cached = this.requestCache.get(token);

    if (cached) {
      this.scheduleStaleDisposal(cached);
    }

    this.requestCache.delete(token);
  }

  if (!this.parent && scope === Scope.DEFAULT) {
    const singletonCache = this.singletonCache;

    if (singletonCache.has(token)) {
      const cached = singletonCache.get(token);

      if (cached) {
        this.scheduleStaleDisposal(cached);
      }

      singletonCache.delete(token);
    }
  }
```

request cache와 root singleton cache가 모두 검사되는 이유는 override 위치와 provider scope가 다를 수 있기 때문입니다. 뒤의 multi cache 분기도 같은 원칙을 provider 배열 entry에 적용합니다.

실제 예약 경로는 `path:packages/di/src/container.ts:762-780`의 `scheduleStaleDisposal()`입니다. Fluo는 stale instance reference를 그냥 버리지 않습니다. 이미 만들어진 promise를 await하고, 그 결과 인스턴스에 `onDestroy()`가 있으면 정확히 한 번 실행합니다. 여기서 발생한 에러는 `override()`를 동기적으로 깨뜨리지 않고 `staleDisposalErrors`에 누적됩니다.

stale disposal 예약은 cached promise를 기준으로 동작합니다.

`path:packages/di/src/container.ts:762-780`
```typescript
private scheduleStaleDisposal(instancePromise: Promise<unknown>): void {
  let task: Promise<void>;

  task = (async () => {
    try {
      const instance = await instancePromise;

      if (this.isDisposable(instance)) {
        await instance.onDestroy();
      }
    } catch (error) {
      this.staleDisposalErrors.push(error);
    }
  })().finally(() => {
    this.staleDisposalTasks.delete(task);
  });

  this.staleDisposalTasks.add(task);
}
```

이미 만들어진 객체만 dispose할 수 있으므로 promise를 await하는 설계가 필요합니다. 에러를 모아 두는 구조는 override 호출 자체와 나중의 shutdown reporting을 분리합니다.

이 동작은 테스트로 촘촘히 고정되어 있습니다.
`path:packages/di/src/container.test.ts:385-397`은 이미 resolve된 singleton을 override하면 cache가 무효화됨을 검증합니다.
`path:packages/di/src/container.test.ts:905-932`는 stale overridden singleton instance가 즉시 그리고 정확히 한 번 dispose됨을 증명합니다.
`path:packages/di/src/container.test.ts:934-974`는 같은 보장을 multi-provider singleton entry까지 확장합니다.

반복 override에 대한 회귀 테스트도 있습니다.
`path:packages/di/src/container.test.ts:976-1012`는 stale singleton 버전이 계속 쌓이지 않음을 확인합니다.
token이 `v1`에서 `v2`, `v3`로 바뀌는 동안 각 예전 버전은 정확히 한 번만 dispose됩니다.

override-and-evict 알고리즘은 이렇게 정리할 수 있습니다.

```text
override(token, replacement):
  delete visible registrations for token in current scope
  find and evict matching cache entries
  for each evicted cached promise:
    schedule disposal of resolved stale instance
  register replacement provider
```

```typescript
import { Container } from '@fluojs/di';

const CACHE_TOKEN = Symbol('CACHE_TOKEN');
const events: string[] = [];

class FirstCache {
  onDestroy() {
    events.push('first disposed');
  }
}

class SecondCache {}

const container = new Container().register({ provide: CACHE_TOKEN, useClass: FirstCache });
const stale = await container.resolve<FirstCache>(CACHE_TOKEN);

container.override({ provide: CACHE_TOKEN, useClass: SecondCache });
await Promise.resolve(); // stale singleton 정리는 override 직후 예약됩니다.

const fresh = await container.resolve<SecondCache>(CACHE_TOKEN);
console.log(stale instanceof FirstCache, fresh instanceof SecondCache, events);
```

이 부분은 Fluo가 DI를 단순 constructor helper가 아니라 lifecycle system으로 취급한다는 증거입니다. 컨테이너는 초기 생성만큼이나 stale object의 retirement 경로도 엄격하게 관리합니다.

테스트 harness나 hot-reload 비슷한 흐름을 만드는 고급 사용자라면, 여기서 중요한 교훈은 이것입니다. `override()`가 안전한 이유는 registration state와 lifetime state를 동시에 바꾸기 때문입니다. 만약 map만 바꾸고 cache를 건드리지 않았다면 singleton 동작은 매우 위험하게 뒤틀렸을 것입니다.

## 5.6 Disposal order, child scopes, and shutdown guarantees
마지막 scope 질문은 인스턴스가 어떻게 죽느냐입니다. Fluo의 답은 deterministic teardown이며, root singleton과 request child를 명확히 분리합니다.

공개 진입점은 `path:packages/di/src/container.ts:292-307`의 `dispose()`입니다. 이 메서드는 `disposePromise`를 memoize하고, 컨테이너를 disposed 상태로 표시한 뒤, `disposeAll()`을 실행합니다. 그리고 disposal이 실패한 경우에만 promise를 초기화합니다. 그래서 성공적인 `dispose()`는 사실상 idempotent합니다.

dispose entrypoint는 재진입과 실패 재시도를 함께 다룹니다.

`path:packages/di/src/container.ts:292-307`
```typescript
async dispose(): Promise<void> {
  if (this.disposePromise) {
    await this.disposePromise;
    return;
  }

  this.disposed = true;
  this.disposePromise = this.disposeAll();

  try {
    await this.disposePromise;
  } catch (error) {
    this.disposePromise = undefined;
    throw error;
  }
}
```

성공한 dispose는 같은 promise를 재사용하므로 두 번 호출해도 중복 teardown이 일어나지 않습니다. 실패한 경우에만 promise를 비워 다음 호출이 다시 정리할 기회를 갖습니다.

`path:packages/di/src/container.ts:309-323`의 `disposeAll()`은 root에서 호출된 경우,
먼저 살아 있는 request-scope child를 전부 dispose합니다. 그다음 현재 tier의 cache entry를 정리합니다. 이 순서가 중요한 이유는 request-scoped instance가 root singleton에 의존할 수는 있어도, 그 반대는 허용되지 않기 때문입니다.

root와 child의 정리 순서는 `finally`까지 포함해야 정확합니다.

`path:packages/di/src/container.ts:309-323`
```typescript
private async disposeAll(): Promise<void> {
  try {
    // Dispose all live request-scope children first (root only)
    if (!this.parent && this.childScopes.size > 0) {
      await Promise.all(Array.from(this.childScopes).map((child) => child.dispose()));
      this.childScopes.clear();
    }

    await this.disposeCache(this.disposalCacheEntries());
  } finally {
    if (this.parent) {
      this.root().childScopes.delete(this);
    }
  }
}
```

root dispose는 child scope를 먼저 닫고, child dispose는 root registry에서 자신을 제거합니다. 이 조합이 request boundary의 생존 기간을 root가 추적하게 만듭니다.

cache entry 선택도 root와 child로 나뉩니다.
`path:packages/di/src/container.ts:674-690`의 `disposalCacheEntries()`는 child container에서는 request cache와 multi request cache만 반환하고,
root에서는 singleton cache와 multi singleton cache를 반환합니다. 즉 request child 하나를 dispose해도 root singleton은 파괴되지 않습니다.

tier별 cache ownership은 disposal 대상 목록에서도 반복됩니다.

`path:packages/di/src/container.ts:674-690`
```typescript
private disposalCacheEntries(): Array<[NormalizedProvider | Token, Promise<unknown>]> {
  if (this.parent) {
    const entries: Array<[NormalizedProvider | Token, Promise<unknown>]> = Array.from(this.requestCache.entries());

    for (const [provider, promise] of this.multiRequestCache.entries()) {
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

실제 instance 수집은 `path:packages/di/src/container.ts:705-729`의 `collectDisposableInstances()`에서 `Promise.allSettled`로 수행됩니다. 이 점이 중요합니다. provider promise 하나가 reject되어도, 컨테이너는 다른 disposable instance들을 계속 모을 수 있습니다. 이후 `path:packages/di/src/container.ts:731-743`의 `disposeInstancesInReverseOrder()`가 `onDestroy()`를 생성 역순으로 호출합니다.

수집과 호출은 일부 실패를 견디도록 분리되어 있습니다.

`path:packages/di/src/container.ts:712-743`
```typescript
const settled = await Promise.allSettled(entries.map(([, p]) => p));

for (const result of settled) {
  if (result.status === 'rejected') {
    errors.push(result.reason);
    continue;
  }

  const instance = result.value;

  if (this.isDisposable(instance) && !seenInstances.has(instance)) {
    seenInstances.add(instance);
    disposables.push(instance);
  }
}

return { disposables, errors };
}

private async disposeInstancesInReverseOrder(disposables: readonly Disposable[]): Promise<unknown[]> {
  const errors: unknown[] = [];

  for (const instance of [...disposables].reverse()) {
    try {
      await instance.onDestroy();
    } catch (error) {
      errors.push(error);
    }
  }
```

`Promise.allSettled`와 reverse loop가 함께 보이므로 이 발췌는 실패 격리와 생성 역순 정리라는 두 보장을 동시에 설명합니다.

테스트는 보장을 명확하게 설명합니다.
`path:packages/di/src/container.test.ts:753-776`은 reverse-order singleton disposal을 검증합니다.
`path:packages/di/src/container.test.ts:778-809`는 request child disposal이 request instance만 제거하고 root singleton은 root dispose까지 살려 둠을 증명합니다.
`path:packages/di/src/container.test.ts:811-820`는 dispose된 request scope가 root child registry에서 제거됨을 보여 줍니다.

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
`path:packages/di/src/container.ts:782-790`의 `throwDisposalErrors()`는 에러가 하나면 그대로 던지고,
여러 개면 `AggregateError`를 던집니다.
`path:packages/di/src/container.test.ts:880-903`은 `onDestroy()` 하나가 실패해도 나머지 인스턴스 disposal은 계속 진행됨을 보여 줍니다.

shutdown pipeline은 이렇게 표현할 수 있습니다.

```text
dispose(container):
  if root:
    dispose all live request children first
  collect relevant cached promises for this container tier
  await stale disposal tasks
  gather resolved disposable instances
  call onDestroy in reverse order
  clear caches
  throw aggregated disposal errors if any
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
