# 2장. fluo 멘탈 모델

> **기준 소스**: [repo:docs/reference/glossary-and-mental-model.md] [repo:README.md] [repo:docs/concepts/architecture-overview.md]
> **주요 구현 앵커**: [ex:minimal/src/main.ts] [ex:minimal/src/app.ts]

fluo를 제대로 이해하려면 먼저 프레임워크를 “데코레이터 모음”이 아니라 **여러 층이 순서대로 이어지는 시스템**으로 봐야 한다. 이 장에서는 이후 모든 챕터의 기반이 되는 멘탈 모델을 고정한다.

## 먼저 큰 그림을 잡자

fluo를 처음 접하면 종종 `@Module`, `@Inject`, `@Controller` 같은 표면 문법이 먼저 눈에 들어온다. 하지만 그 표면만 보면 항상 오해가 생긴다. 예를 들어 `@Inject`를 보면 DI 기능처럼 느껴지고, `@Controller`를 보면 HTTP 기능처럼 보인다. 그러나 실제로는 이 데코레이터들이 **각자 바로 일을 처리하는 것이 아니라**, 뒤에서 다른 계층이 읽을 수 있는 선언을 남긴다 `[pkg:core/src/decorators.ts]` `[pkg:core/src/metadata.ts]`.

그래서 fluo를 이해하는 가장 좋은 방식은 기능별 API 문서를 외우는 것이 아니라, “이 선언이 다음 층에서 어떻게 해석되는가?”를 계속 따라가는 것이다.

## fluo를 네 층으로 보기

가장 단순한 관점은 다음 네 층이다.

1. `core`: 클래스와 메서드에 메타데이터를 적는다 `[pkg:core/README.md]`.
2. `di`: 토큰과 스코프 규칙에 따라 인스턴스를 해석한다 `[pkg:di/README.md]`.
3. `runtime`: 모듈 그래프를 만들고 애플리케이션을 부팅한다 `[pkg:runtime/README.md]`.
4. `http`: 요청을 바인딩, 검증, 가드, 인터셉터, 핸들러 순서로 처리한다 `[repo:docs/concepts/http-runtime.md]` `[pkg:http/README.md]`.

이 네 층을 한 줄로 쓰면 **“선언한 메타데이터가 실제 실행 파이프라인이 되는 과정”**이다.

이 문장은 중요하다. 왜냐하면 fluo의 거의 모든 기능이 이 공식을 반복하기 때문이다.

- 클래스에 적는다.
- 메타데이터가 저장된다.
- runtime/di/http가 그것을 읽는다.
- 실제 실행이 일어난다.

## 왜 이 관점이 중요한가

많은 프레임워크는 이 과정을 내부에서 한 번에 처리해 버린다. 그러면 사용자는 편하지만, 어느 순간부터는 “무슨 일이 일어나는지”를 프레임워크 내부에 맡기게 된다. fluo는 반대로 각 단계를 드러낸다.

- 모듈은 `@Module(...)`로 선언한다 `[pkg:core/src/decorators.ts]`.
- 의존성은 `@Inject(...)`로 선언한다 `[pkg:core/src/decorators.ts]`.
- runtime은 어댑터를 받아 애플리케이션을 만든다 `[ex:minimal/src/main.ts]`.
- HTTP는 DTO와 request context를 사용해 요청 경계를 만든다 `[repo:docs/concepts/http-runtime.md]`.

즉, fluo의 명시성은 단순한 취향이 아니라 **시스템 전체의 관찰 가능성**을 위한 설계다.

## 이 멘탈 모델이 디버깅에서 주는 이점

멘탈 모델은 추상 개념처럼 들리지만, 실제로는 디버깅 속도를 결정한다. 예를 들어 어떤 서비스가 주입되지 않는다고 가정해 보자. fluo에서는 이 문제를 다음 순서로 생각할 수 있다.

1. `core`에서 해당 클래스에 `@Inject`가 제대로 기록되었는가? `[pkg:core/src/decorators.ts]`
2. 해당 provider가 올바른 module graph 안에 등록되었는가? `[repo:docs/concepts/di-and-modules.md]`
3. `di` container가 그 토큰을 resolve할 수 있는가? `[pkg:di/src/container.ts]`
4. 그 resolve 시점이 root인지 request scope인지 맞는가? `[pkg:di/src/types.ts]`

즉, 문제를 “프레임워크가 이상하다”로 뭉개지 않고, 어느 층에서 깨졌는지 좁혀 갈 수 있다.

## 최소 앱을 이 멘탈 모델로 다시 보기

`examples/minimal/src/main.ts`를 보면 `fluoFactory.create(AppModule, { adapter: createFastifyAdapter(...) })`가 나온다 `[ex:minimal/src/main.ts]`. 이 한 줄 안에는 이미 fluo의 멘탈 모델이 거의 다 들어 있다.

- `AppModule`은 module graph의 시작점이다.
- `adapter`는 실행 환경을 결정한다.
- factory는 둘을 조합해 runnable app을 만든다.

그리고 `examples/minimal/src/app.ts`를 보면 `AppModule`은 `imports`, `controllers`, `providers`를 통해 앱의 구조를 선언한다 `[ex:minimal/src/app.ts]`. 여기서 중요한 것은 이 파일이 아직 아무것도 “직접 실행”하지 않는다는 점이다. 단지 앱의 구조를 선언한다.

이 대비를 기억하면 좋다.

- `main.ts`는 **실행 진입점**이다.
- `app.ts`는 **구조 진입점**이다.

## fluo의 중요한 단어들

이 책 전체에서 반복되는 단어는 다음과 같다 `[repo:docs/reference/glossary-and-mental-model.md]`.

- **Module Graph**: 어떤 모듈이 어떤 모듈을 가져오고, 어떤 provider가 어디에서 보이는지 나타내는 구조
- **Platform Adapter**: Fastify, Bun, Deno, Workers 같은 구체 런타임을 감싸는 계층
- **Bootstrap Path**: 앱이 생성되고 ready 상태로 가는 과정
- **Request DTO**: 요청 데이터를 타입/검증 경계 안으로 들여오는 객체
- **Behavioral Contract**: 패키지와 런타임이 지켜야 할 동작 약속

이 단어들은 문법 용어가 아니라, fluo를 읽는 좌표다.

## “보이는 것”과 “실제로 일어나는 것”을 구분하기

fluo를 읽을 때는 항상 두 층을 구분해야 한다.

### 보이는 것

- 클래스 데코레이터
- 메서드 데코레이터
- module 선언
- controller 코드

### 실제로 일어나는 것

- metadata registry에 정보가 기록됨
- module graph가 컴파일됨
- container가 토큰을 해석함
- dispatcher가 request pipeline을 실행함

이 둘을 분리해서 생각하지 않으면, 코드는 쉬워 보이는데 런타임은 복잡하게 느껴지고, 결국 “프레임워크가 뭔가 알아서 한다”는 인상으로 다시 돌아가게 된다.

## JavaScript 중급자를 위한 읽기 팁

fluo를 공부할 때는 “이 클래스가 무슨 일을 하지?”보다 “이 클래스는 어느 층에 속하지?”를 먼저 묻는 편이 좋다. 예를 들어 `@Inject`를 보면 DI 기능처럼 느껴지지만, 실제로는 `core` 단계의 **메타데이터 기록 도구**다 `[pkg:core/src/decorators.ts]`. 실제 해석은 그 다음 단계인 `di`에서 일어난다 `[pkg:di/src/container.ts]`.

이 구분이 잡히면 core와 di가 왜 분리되어 있는지, 그리고 runtime이 왜 따로 존재하는지 이해가 쉬워진다.

## 메인테이너식 멘탈 모델

사용자 관점의 멘탈 모델이 “이 앱이 어떻게 돌아가는가”라면, 메인테이너 관점의 멘탈 모델은 “이 패키지들이 어떤 계약으로 연결되는가”다.

- `core`는 metadata contract를 보장한다.
- `di`는 token resolution contract를 보장한다.
- `runtime`은 bootstrap/lifecycle contract를 보장한다.
- `http`는 request/response contract를 보장한다.

이 관점까지 들어가면, 책 후반부의 testing, release governance, platform portability가 갑자기 뜬금없는 장이 아니라는 사실도 자연스럽게 이해된다.

## 이 장의 핵심 문장

> fluo를 이해한다는 것은 프레임워크 기능 목록을 아는 것이 아니라, **선언이 어떤 계층을 거쳐 실행으로 변하는지 추적할 수 있는 상태**에 도달하는 것이다.

## 다음 장으로 이어지는 질문

이제 fluo를 읽는 전체 지도가 생겼다. 다음 장에서는 이 지도 위에 실제 용어와 예제 순서를 올려서, 독자가 책 전체를 어떤 경로로 따라가면 되는지 정리한다.
