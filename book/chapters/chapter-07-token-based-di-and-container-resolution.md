# 7장. 토큰 기반 DI와 컨테이너 해석

> **기준 소스**: [repo:docs/concepts/di-and-modules.md] [pkg:di/README.md]
> **주요 구현 앵커**: [pkg:di/src/container.ts] [pkg:di/src/types.ts] [ex:realworld-api/src/users/users.service.ts]

이 장에서는 많은 독자가 가장 궁금해하는 부분, 즉 “fluo의 DI는 실제로 어떻게 동작하는가?”를 다룬다. 결론부터 말하면, fluo의 DI는 **토큰을 기준으로 provider를 정규화하고, scope 규칙에 따라 인스턴스를 해석하는 컨테이너**다 `[pkg:di/README.md]`.

## 왜 이 장이 책의 기준점이 되는가

이 장이 얇으면 fluo는 겉으로만 명시적이고 속은 여전히 블랙박스인 프레임워크처럼 보이게 된다. 반대로 이 장이 충분히 두꺼우면, 독자는 이후 HTTP, auth, runtime 장을 읽을 때 “이 시점에 container가 어떻게 움직이겠구나”를 추론할 수 있게 된다.

## 왜 토큰 기반인가

fluo는 생성자 타입을 몰래 읽는 대신, 의존성을 토큰으로 선언한다 `[repo:docs/concepts/di-and-modules.md]`. 토큰은 클래스일 수도 있고, 문자열이나 심볼일 수도 있다. 이 방식의 장점은 “무엇을 주입할지”가 코드에 직접 드러난다는 것이다.

<!-- diagram-source: repo:docs/concepts/di-and-modules.md, pkg:di/src/container.ts, pkg:di/src/types.ts -->
```mermaid
flowchart TD
  A[Provider Input] --> B[normalizeProvider]
  B --> C[Normalized Provider]
  C --> D[resolve(token)]
  D --> E{scope}
  E -->|singleton| F[Root Cache]
  E -->|request| G[Request Scope Cache]
  E -->|transient| H[New Instance]
  F --> I[Resolved Object]
  G --> I
  H --> I
```

이 도표는 DI 장의 핵심을 아주 단순하게 요약한다. 입력 provider는 먼저 정규화되고, 그다음에야 resolve 알고리즘이 scope 정책을 적용해 singleton cache, request scope cache, transient instantiation 중 하나의 경로를 탄다 `[repo:docs/concepts/di-and-modules.md]` `[pkg:di/src/container.ts]` `[pkg:di/src/types.ts]`.

예를 들어 `UsersService`는 다음처럼 자신이 `UsersRepo`를 원한다고 적는다 `[ex:realworld-api/src/users/users.service.ts]`.

```ts
// source: ex:realworld-api/src/users/users.service.ts
@Inject(UsersRepo)
export class UsersService {
  constructor(private readonly repo: UsersRepo) {}
}
```

이 선언 덕분에 컨테이너는 constructor parameter 타입을 추측할 필요가 없다.

이 대목이 중요하다. fluo는 “클래스 타입을 보면 되잖아?”라는 유혹을 일부러 거부한다. 왜냐하면 토큰을 명시하는 순간, 주입은 타입 시스템의 우연한 부산물이 아니라 **애플리케이션이 공개적으로 선언한 계약**이 되기 때문이다 `[repo:docs/concepts/di-and-modules.md]`.

## `Container`가 실제로 하는 일

`packages/di/src/container.ts`를 보면 컨테이너는 크게 네 단계를 수행한다 `[pkg:di/src/container.ts]`.

1. provider를 입력받는다.
2. provider를 **normalized provider** 형태로 바꾼다.
3. scope 규칙에 맞는 캐시를 사용한다.
4. 토큰 의존성 그래프를 따라 인스턴스를 해석한다.

여기서 특히 중요한 부분은 `normalizeProvider(...)`다. 이 함수는 클래스 provider, value provider, factory provider, existing provider를 모두 같은 내부 표현으로 맞춘다 `[pkg:di/src/container.ts]`.

## `normalizeProvider(...)`가 사실상 첫 번째 핵심이다

`packages/di/src/container.ts`를 읽으면 컨테이너는 public provider shape를 바로 사용하지 않는다. 먼저 `normalizeProvider(...)`를 통해 내부 표준 표현으로 바꾼다 `[pkg:di/src/container.ts#L54-L115]`.

```ts
// source: pkg:di/src/container.ts
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

이 발췌가 중요한 이유는, fluo가 “provider를 등록한다”는 말을 매우 진지하게 다루기 때문이다. 등록이란 단순히 map에 값을 넣는 행위가 아니라, **외부에서 들어온 다양한 provider 모양을 하나의 내부 해석 언어로 번역하는 과정**이다 `[pkg:di/src/container.ts]`.

이 구조를 이해하면 왜 `@Inject` metadata가 필요하고, 왜 `scope`가 metadata와 provider 양쪽에 존재할 수 있는지도 자연스럽게 보인다. normalize 단계가 그 둘을 만나게 해 주기 때문이다.

이 과정에서 일어나는 일은 다음과 같다.

- class constructor provider면 `getClassDiMetadata(...)`를 읽는다.
- value provider면 inject는 비우고 value를 그대로 쓴다.
- factory provider면 `inject`, `scope`, `resolverClass` 정보를 내부 형식으로 모은다.
- class provider면 `provider.inject`와 class metadata를 합성한다.
- existing provider면 alias처럼 취급한다.

이 정규화 단계가 중요한 이유는, 이후 resolve 알고리즘이 provider 타입별 예외 처리를 남발하지 않게 해 주기 때문이다. 다시 말해, 컨테이너는 먼저 “다양한 입력”을 “같은 내부 언어”로 바꾸고 나서야 해석을 시작한다.

## scope는 단순 옵션이 아니라 해석 규칙이다

`packages/di/src/types.ts`를 보면 scope는 `singleton`, `request`, `transient` 세 가지다 `[pkg:di/src/types.ts]`.

- **singleton**: 기본값. 앱 전체에서 공유된다.
- **request**: 요청 단위 컨테이너에서 한 번 생성된다.
- **transient**: resolve할 때마다 새로 만든다.

이 세 가지는 단순한 라이프사이클 옵션이 아니라, 컨테이너가 어떤 캐시를 사용하고 어떤 조합을 허용할지 결정하는 규칙이다.

책에서는 이 지점을 강하게 강조해야 한다. 많은 개발자가 scope를 “생성 시점 옵션” 정도로 생각하지만, 실제로는 **캐시 정책과 접근 가능성 정책**에 가깝다.

## request scope가 중요한 이유

`Container#createRequestScope()`는 root singleton cache를 공유하면서도 요청 단위 인스턴스 캐시를 따로 가진 자식 컨테이너를 만든다 `[pkg:di/src/container.ts]`. 이 설계는 “전역 공유가 안전한 것”과 “요청마다 분리해야 하는 것”을 동시에 다루게 해 준다.

```ts
// source: pkg:di/src/container.ts
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

이 코드는 request scope가 단순 플래그가 아니라 **실제 child container**라는 사실을 보여 준다 `[pkg:di/src/container.ts#L252-L263]`. 즉, request scope는 “요청 단위 lifecycle을 흉내 내는 옵션”이 아니라, 구조적으로 분리된 해석 공간이다.

이것은 HTTP chapter와 직접 이어진다. request가 들어오면 dispatcher는 request context와 함께 request-scope container를 만들고, 그 요청 안에서만 살아야 하는 객체는 그 scope에서 resolve된다 `[pkg:http/src/dispatch/dispatcher.ts#L60-L72]`.

## `resolve(...)`를 어떻게 이해해야 하나

컨테이너에서 가장 중요한 메서드는 당연히 `resolve(...)`다 `[pkg:di/src/container.ts#L265-L285]`. 이 메서드는 겉으로는 단순하지만, 내부에서는 다음 질문에 계속 답한다.

```ts
// source: pkg:di/src/container.ts
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

겉으로는 짧지만, 이 `resolveWithChain(...)` 호출이 바로 fluo DI의 핵심 진입점이다 `[pkg:di/src/container.ts#L275-L284]`. 이 안에서 parent fallback, multi provider 병합, scope 캐시, circular dependency 방어가 모두 연결된다. 즉, `resolve`는 짧은 public API지만, 뒤에 있는 내부 알고리즘은 매우 두껍다.

1. 이 토큰은 이 컨테이너에서 보이는가?
2. multi provider인가, single provider인가?
3. 이미 캐시에 있는가?
4. 현재 scope에서 resolve 가능한가?
5. 순환 참조가 생겼는가?

즉, resolve는 단순 lookup이 아니라 **visibility, caching, lifecycle, safety check가 결합된 알고리즘**이다.

이 부분은 HTTP 장에서 request context와 만나면서 더 중요해진다.

## forwardRef와 optional이 보여주는 것

`packages/di/src/types.ts`에는 `forwardRef(...)`와 `optional(...)` 같은 도구도 있다 `[pkg:di/src/types.ts]`. 이 두 도구는 fluo가 단순한 happy-path DI만 생각한 것이 아니라는 증거다.

- `forwardRef(...)`는 선언 시점 순환 참조를 늦춘다.
- `optional(...)`은 특정 의존성이 없을 수도 있음을 명시한다.

이 두 도구는 fluo가 복잡한 현실을 숨기지 않는다는 증거이기도 하다. 순환 참조나 선택적 의존성은 “나쁜 코드 냄새”로만 볼 수 없는 경우가 있다. 중요한 것은 그 복잡성을 **프레임워크가 추측해서 감추지 않고, 개발자가 명시하게 만든다**는 점이다 `[pkg:di/src/types.ts]`.

## 메인테이너 시각

메인테이너 입장에서 DI container는 가장 민감한 패키지 중 하나다. singleton 캐시, request cache, disposal, override semantics 중 하나라도 잘못 건드리면, 문제가 기능 수준이 아니라 프레임워크 전반으로 번진다 `[pkg:di/src/container.ts]`.

이 역시 “프레임워크가 알아서”가 아니라 **개발자가 조건을 명시**하는 방식이다.

## 이 장의 핵심

fluo DI는 마법 같은 주입이 아니다. `core`가 적어 둔 메타데이터를 `di`가 읽고, provider를 정규화하고, scope 규칙과 캐시 정책을 적용해, 필요한 인스턴스를 해석하는 과정이다. 이 과정을 이해하면 DI는 더 이상 “프레임워크 내부 비밀”이 아니다.

좀 더 강하게 말하면, 이 장을 이해한 독자는 fluo에서 “주입이 안 된다”는 문제를 막연한 감각으로 보지 않게 된다. 그는 이제 metadata, token, visibility, scope, cache, request lifecycle 중 어디서 문제가 났는지를 추적할 수 있다.

## 심화 워크스루 1: 정규화가 없으면 어떤 문제가 생길까

정규화 이전의 provider 세계는 매우 잡다하다. 클래스 하나를 그냥 넣을 수도 있고, `useClass`, `useValue`, `useFactory`, `useExisting` 같은 다양한 표현을 쓸 수도 있다. 컨테이너가 이 모든 형태를 resolve 시점마다 분기 처리한다면 알고리즘은 금방 지저분해진다 `[pkg:di/src/container.ts]`.

그래서 fluo는 먼저 normalize를 한다. 이 단계의 핵심 가치는 다음과 같다.

- 입력 다양성을 초기에 흡수한다.
- resolve 알고리즘을 단순화한다.
- cache/scope 정책을 provider 종류와 분리한다.

즉, normalize는 편의 단계가 아니라 **DI 엔진의 해석 가능성을 지키는 단계**다.

## 심화 워크스루 2: `resolve`는 lookup이 아니라 순회다

앞서 `resolve(...)`를 소개했지만, 실제로 독자가 가져가야 할 감각은 “resolve는 map.get이 아니다”라는 점이다 `[pkg:di/src/container.ts#L265-L285]`. resolve는 사실상 작은 순회 알고리즘이다.

- 현재 컨테이너에 토큰이 있는지 본다.
- 없으면 parent나 다른 visibility 경로를 본다.
- 있으면 provider 종류에 따라 해석한다.
- multi provider면 값을 합친다.
- cache hit인지, 새로 instantiate해야 하는지 판단한다.
- 그 과정에서 순환 참조가 생기면 체인을 보고 에러를 낸다.

이렇게 보면 resolve는 단순 API 호출이 아니라, **container 안에 들어 있는 규칙 전체를 한 번 통과하는 행위**다.

## 심화 워크스루 3: scope를 메모리 관점에서 보기

scope를 단순 설명형 정의로만 이해하면 금방 흐려진다. 오히려 메모리와 캐시 관점에서 이해하는 편이 좋다 `[pkg:di/src/types.ts]`.

- singleton: 루트 캐시에 한 번 저장하고 계속 재사용한다.
- request: request scope 캐시에 한 번 저장하고 요청 종료 시 함께 버린다.
- transient: 캐시에 넣지 않고 그때그때 새로 만든다.

이렇게 보면 scope는 사실상 “이 인스턴스를 어디에 얼마나 오래 붙들어 둘 것인가”에 대한 규칙이다. 이 관점은 특히 request context와 결합되는 HTTP 장에서 큰 힘을 발휘한다 `[pkg:http/src/dispatch/dispatcher.ts#L60-L72]`.

## 심화 워크스루 4: 왜 disposal이 중요한가

DI 책에서는 종종 생성에만 주목하고 disposal은 가볍게 넘긴다. 하지만 메인테이너 관점에서는 disposal이 매우 중요하다. request-scoped resource나 장기 singleton resource가 있다면, 종료 시점에 어떤 순서로 정리하느냐가 실제 안정성을 크게 좌우하기 때문이다 `[pkg:di/src/container.ts]`.

fluo에서 scope와 dispose를 함께 봐야 하는 이유도 여기에 있다. 생성과 해석만큼이나 **종료 시점의 정리 규칙도 DI contract의 일부**이기 때문이다.

## instantiate 단계는 결국 어디에서 끝나는가

정규화와 resolve chain을 따라가다 보면 결국 마지막 질문이 남는다. “그래서 실제 객체는 어디서 만들어지지?” 그 지점이 `instantiate()`다 `[pkg:di/src/container.ts]`.

`instantiate()`의 의미는 단순하다.

- value provider면 값 그대로 반환한다.
- existing provider면 alias target을 다시 resolve한다.
- factory provider면 dependency를 resolve한 뒤 factory를 호출한다.
- class provider면 dependency를 resolve한 뒤 `new useClass(...deps)`를 수행한다.

즉, instantiate는 “어떤 종류의 provider인가?”에 따라 마지막 한 걸음을 다르게 밟는 단계다. 이 때문에 normalize 단계가 더 중요해진다. 입력 형태를 먼저 통일해 두지 않으면, instantiate는 provider 종류별 특수 케이스로 금방 오염되기 쉽다.

## 캐시 정책은 실제 코드에서 어떻게 보이는가

`cacheFor(...)`는 이 장에서 반드시 봐야 할 또 하나의 핵심 함수다 `[pkg:di/src/container.ts#L602-L623]`.

```ts
// source: pkg:di/src/container.ts
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
    );
  }

  return this.requestCache;
}
```

이 코드는 scope가 단순 라벨이 아니라 **실제 캐시 위치를 선택하는 규칙**이라는 점을 보여 준다. singleton이면 root cache, request scope면 request cache다. 그리고 request-scoped provider를 루트에서 해석하려 하면 즉시 `RequestScopeResolutionError`가 난다 `[pkg:di/src/container.ts#L611-L620]`.

책에서 이 부분이 중요한 이유는, DI를 단순 객체 생성기로 오해하는 독자에게 “아니, 이건 메모리와 수명주기까지 포함한 시스템이구나”를 깨닫게 해 주기 때문이다.

## 테스트는 이 알고리즘을 어떻게 증명하는가

`container.test.ts`는 이 장의 훌륭한 보조 텍스트다 `[pkg:di/src/container.test.ts]`. 특히 request scope와 singleton cache 차이를 보여 주는 테스트는 원고에 매우 잘 맞는다.

```ts
// source: pkg:di/src/container.test.ts
it('keeps request-scoped providers unique per request scope', async () => {
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

이 테스트는 긴 설명보다 훨씬 많은 것을 증명한다 `[pkg:di/src/container.test.ts#L42-L66]`.

- request-scoped provider는 루트에서 해석되지 않는다.
- 같은 request scope 안에서는 같은 인스턴스를 재사용한다.
- 다른 request scope끼리는 서로 다른 인스턴스를 가진다.

즉, scope 규칙은 문서 선언이 아니라 **실제로 검증되는 behavior contract**다.

## singleton이 request-scoped dependency를 보면 왜 안 되는가

`ScopeMismatchError` 관련 테스트도 이 장에서 매우 중요하다 `[pkg:di/src/container.test.ts#L202-L215]`. singleton이 request-scoped provider에 의존하면, framework는 이를 허용하지 않는다. 이유는 단순하다. 긴 수명을 가진 객체가 짧은 수명의 객체를 직접 잡으면, 수명 규칙이 모순되기 때문이다.

이 장의 좋은 기술서는 이런 규칙을 단순 “안 됩니다”로 끝내지 말고, **왜 수명주기 모순이 생기는가**까지 함께 설명해야 한다. 그래야 reader가 framework 규칙을 암기하는 것이 아니라 구조적으로 납득하게 된다.

## 7장을 읽고 얻어야 하는 감각

이 장이 충분히 두꺼워져야 하는 이유는, DI가 프레임워크의 “편의 기능”이 아니라 **실행 가능성의 중심 엔진**이라는 사실을 보여 주기 위해서다. fluo에서 resolve는 map.get이 아니고, scope는 string label이 아니며, token은 단순 별명이 아니다.

각각은 다음과 같은 역할을 가진다.

- token은 의존성 계약의 표면이다.
- provider 정규화는 내부 해석 언어를 만든다.
- cache는 lifecycle을 구현한다.
- request scope는 HTTP와 DI를 연결한다.
- 에러 타입은 실패를 추적 가능한 계약으로 바꾼다.

이 다섯 가지가 함께 움직일 때만, fluo DI는 “명시적”이라는 말을 진짜로 할 수 있다.

## 7장의 마지막 문장

이 장을 마무리하는 문장은 이렇게 적는 편이 좋다.

> fluo의 DI는 클래스를 자동으로 연결하는 편의 기능이 아니라, **토큰·가시성·수명주기·실패 경로를 한꺼번에 관리하는 계약 엔진**이다.

그래서 이 장을 이해한 독자는 이후 auth, request context, testing, portability 장에서도 “지금 이 객체는 어떤 container 규칙 안에서 살아 있지?”를 자연스럽게 떠올릴 수 있어야 한다.

그 감각이 생기면, fluo의 explicit DI는 더 이상 번거로움이 아니라 강점으로 보인다.

그리고 바로 그 감각이 메인테이너 관점의 시작점이 된다.

## override는 왜 별도 개념이어야 하는가

DI 시스템이 커질수록 등록과 override를 같은 동작처럼 다루는 유혹이 생긴다. 하지만 fluo는 duplicate provider와 intentional override를 분명히 구분한다 `[pkg:di/src/errors.ts]`. 이것은 메인테이너 관점에서 매우 중요하다.

- accidental duplicate는 버그일 가능성이 높다.
- intentional override는 테스트나 조립 전략의 일부일 수 있다.

즉, DI container는 “중복 등록도 그냥 마지막 wins로 처리하는 편한 도구”가 아니라, **등록 행위의 의미 자체를 엄격하게 구분하는 계약 도구**다.

## request scope와 HTTP의 연결을 다시 강조해야 하는 이유

이 장과 9장을 분리해 읽으면, request scope는 DI 내부의 세부 기능처럼 느껴질 수 있다. 하지만 실제로는 그렇지 않다. `dispatcher.ts`가 request마다 `createRequestScope()`를 호출하는 순간 `[pkg:http/src/dispatch/dispatcher.ts#L60-L72]`, request scope는 단순 DI 옵션이 아니라 HTTP lifecycle의 일부가 된다.

이 교차점을 독자가 분명히 잡아야 한다. 그래야 auth strategy, request context, observability, request-scoped service 같은 개념이 모두 한 구조 안에서 읽힌다.

## 이 장의 두 번째 핵심 문장

앞에서 “DI는 마법 같은 주입이 아니다”라고 했는데, 이 장의 두 번째 핵심 문장은 이렇게 적는 편이 좋다.

> fluo DI는 객체를 만들어 주는 기능이 아니라, **토큰·가시성·수명주기·에러 계약을 함께 관리하는 해석 엔진**이다.

## 심화 워크스루 5: 이 장의 디버깅 체크리스트

실전에서 “주입이 안 된다”는 문제를 만났을 때는 다음 순서로 좁혀 가면 좋다.

1. `@Inject(...)`가 실제로 적혔는가? `[pkg:core/src/decorators.ts]`
2. `getClassDiMetadata(...)`로 읽힐 metadata가 있는가? `[pkg:core/src/metadata/class-di.ts]`
3. provider가 normalize 가능한 형태로 등록되었는가? `[pkg:di/src/container.ts]`
4. 현재 module에서 그 token이 visible한가? `[pkg:runtime/src/module-graph.ts]`
5. request/singleton/transient 중 현재 기대하는 수명 규칙이 맞는가? `[pkg:di/src/types.ts]`

이 체크리스트를 따라갈 수 있다면, fluo DI는 더 이상 “잘 되면 되고 안 되면 어려운 영역”이 아니다. 구조적으로 추적 가능한 영역이 된다.

## DI 에러가 왜 중요한가

좋은 DI 시스템은 객체를 만들어 내는 능력만으로 평가되지 않는다. **실패를 얼마나 구조적으로 설명하느냐**도 중요하다. `packages/di/src/errors.ts`를 보면 fluo는 이 부분을 꽤 진지하게 다룬다 `[pkg:di/src/errors.ts]`.

```ts
// source: pkg:di/src/errors.ts
export class CircularDependencyError extends fluoCodeError {
  constructor(chain: readonly unknown[], detail?: string) {
    const path = chain.map((token) => formatTokenName(token)).join(' -> ');
    const hint = 'Break the cycle by extracting shared logic into a separate provider, or use forwardRef() to defer one side of the dependency.';
    super(
      (detail ? `Circular dependency detected: ${path}. ${detail}` : `Circular dependency detected: ${path}`) +
        `\n  Dependency chain: ${path}` +
        `\n  Hint: ${hint}`,
      'CIRCULAR_DEPENDENCY',
      { meta: { chain: chain.map((t) => formatTokenName(t)), hint } },
    );
  }
}
```

이 발췌가 좋은 이유는, 에러 메시지조차 fluo의 철학을 보여 주기 때문이다. 단순히 “순환 참조 발생”이라고 끝내지 않고, dependency chain과 hint를 함께 준다 `[pkg:di/src/errors.ts#L113-L124]`. 즉, DI 에러도 opaque하지 않게 만들겠다는 의지가 코드에 드러난다.

메인테이너 관점에서는 이 점이 매우 중요하다. 인프라 레벨 에러가 추적 가능하지 않으면, 프레임워크는 규모가 커질수록 급격히 불편해진다.
