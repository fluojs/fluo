<!-- packages: @fluojs/testing, @fluojs/http, @fluojs/runtime -->
<!-- project-state: FluoBlog v0 -->

# Chapter 14. Portability Testing and Conformance — 이식성 테스트와 적합성 검증

이 장에서는 fluo가 여러 런타임에서 같은 동작을 유지하도록 검증하는 이식성 테스트와 적합성 테스트의 역할을 설명합니다. Chapter 13에서 어댑터를 구현했다면, 이제 그 어댑터가 계약을 실제로 지키는지 자동화로 증명해야 합니다.

## Learning Objectives
- 이식성 테스트와 적합성 테스트가 각각 어떤 실패를 잡아내는지 이해합니다.
- `HttpAdapterPortabilityHarness`의 구조와 핵심 검증 표면을 배웁니다.
- 잘못된 형식의 쿠키, 원시 바디, SSE 같은 경계 사례를 어떻게 검증하는지 살펴봅니다.
- 플랫폼 적합성 스위트가 생명주기 훅과 오류 경계를 어떻게 확인하는지 분석합니다.
- 엣지 런타임과 WebSocket 계층에서 추가로 필요한 검증 관점을 정리합니다.
- 커스텀 어댑터에 하네스를 적용해 동작 계약을 확인하는 흐름을 익힙니다.

## Prerequisites
- Chapter 13 완료.
- `RequestContext`와 `FrameworkRequest` 같은 HTTP 런타임 계약에 대한 기본 이해.
- Vitest 또는 이에 준하는 테스트 프레임워크의 기초 사용 경험.

## 14.1 The Portability Challenge

현대적인 백엔드 개발에서 "한 번 작성하여 어디서나 실행(Write Once, Run Anywhere)"은 엣지 환경에서 쉽게 흔들립니다. Node.js, Bun, Cloudflare Workers, Deno 등 여러 플랫폼을 지원하는 프레임워크라면 하위 엔진과 관계없이 비즈니스 로직이 동일하게 동작하도록 보장해야 합니다.

Fluo는 **이식성 테스트(Portability Testing)**로 이 조건을 검증합니다. 특정 입력에 대해 X를 반환하는지 확인하는 표준 단위 테스트와 달리, 이식성 테스트는 *프레임워크 파사드(Facade)*가 서로 다른 어댑터 사이에서 의미론적 불변성(Semantic invariants)을 유지하는지 확인합니다. 목표는 개발자가 런타임 환경의 특이성이 아니라 자신의 코드에 집중할 수 있게 만드는 것입니다.

개발자가 애플리케이션을 Fastify에서 Cloudflare Workers 어댑터로 옮길 때, 원시 바디 버퍼가 갑자기 누락되거나 SSE 스트림이 어댑터에 의해 버퍼링되어서는 안 됩니다. Fluo의 테스트 인프라는 이런 미묘한 차이가 프로덕션 환경에 도달하기 전에 드러나도록 설계되었습니다.

## 14.2 Conformance vs. Portability

코드를 살펴보기 전에 Fluo 생태계에서 이 두 개념을 구분해야 합니다. 둘은 신뢰성의 서로 다른 측면을 다루며, 모든 지원 플랫폼에서 일관된 개발자 경험을 만들기 위해 함께 작동합니다.

- **적합성(Conformance)**: 이 특정 구현이 요구되는 인터페이스와 동작 계약을 만족하는가? (예: "이 WebSocket 어댑터가 스펙에 따라 broadcast 메서드를 올바르게 구현했는가?")
- **이식성(Portability)**: 서로 다른 구현체들이 동일한 작업에 대해 동일한 결과를 내는가? (예: "Node.js와 Bun 어댑터 모두 부하 상황에서 잘못된 형식의 쿠키를 동일하게 처리하는가?")

`@fluojs/testing` 패키지는 두 가지 모두를 위한 전문화된 하네스(Harness)를 제공합니다. 적합성 테스트는 주로 어댑터 작성자가 자신의 구현 세부 사항을 확인하기 위해 수행합니다. 이식성 테스트는 상위 레벨 API에서 플랫폼 고유 동작이 새어 나오지 않도록 막기 위해 프레임워크 핵심 검증 제품군의 일부로 수행됩니다.

두 기준을 함께 유지해야 개발자는 동작 변경 없이 런타임을 전환할 수 있습니다. 이러한 일관성은 복잡한 분산 시스템을 위한 신뢰할 수 있는 기준선을 제공하는 Fluo의 "표준 우선" 철학과 직접 연결됩니다.

## 14.3 HttpAdapterPortabilityHarness Anatomy

HTTP 어댑터를 검증하는 핵심 도구는 `HttpAdapterPortabilityHarness`입니다. 이 도구는 `packages/testing/src/portability/http-adapter-portability.ts`에 있으며, 신규 또는 기존 HTTP 어댑터 구현을 검증하는 기준으로 사용됩니다.

### Interface Definition

하네스는 테스트 중 애플리케이션 생명주기를 관리하기 위해 `bootstrap`과 `run` 함수를 요구합니다. 이를 통해 Node.js와 Bun 같은 런타임 사이에서 달라질 수 있는 시작 및 종료 시나리오를 시뮬레이션할 수 있습니다.

```typescript
export interface HttpAdapterPortabilityHarnessOptions<
  TBootstrapOptions extends object,
  TRunOptions extends object,
  TApp extends AppLike = AppLike,
> {
  bootstrap: (rootModule: ModuleType, options: TBootstrapOptions) => Promise<TApp>;
  name: string;
  run: (rootModule: ModuleType, options: TRunOptions) => Promise<TApp>;
}
```

### Key Test Surfaces

하네스는 런타임 사이에서 차이가 발생하기 쉬운 여러 임계 표면을 다룹니다. 목적은 Fluo 추상화 계층이 서로 다른 실행 환경에서도 새지 않도록 확인하는 것입니다:

1. **쿠키 처리(Cookie Handling)**: 잘못된 형식의 쿠키가 서버를 중단시키거나 다른 헤더를 오염시키지 않도록 보장.
2. **원시 바디 보존(Raw Body Preservation)**: 메모리 절약을 위해 JSON 및 Text에 대해서는 `rawBody`를 사용할 수 있지만 Multipart에 대해서는 제외되는지 확인.
3. **SSE (Server-Sent Events)**: 버퍼링 없이 연결을 열린 상태로 유지하는 적절한 스트리밍 동작 확인.
4. **시작 로그(Startup Logs)**: 어댑터가 표준화된 훅을 통해 리스닝 호스트와 포트를 올바르게 보고하는지 검증.
5. **종료 시그널(Shutdown Signals)**: 메모리 누수를 방지하기 위해 `SIGTERM` 및 `SIGINT` 리스너가 종료 후 올바르게 정리되는지 확인.

## 14.4 Implementation Deep Dive: Malformed Cookies

어댑터가 실패하는 흔한 원인 중 하나는 헤더 정규화를 지나치게 공격적으로 수행하는 것입니다. 클라이언트가 잘못된 형식의 쿠키를 보내면, 일부 라이브러리는 처리되지 않은 예외를 던질 수 있고 다른 라이브러리는 모든 쿠키를 무시해 세션 관리를 깨뜨릴 수도 있습니다.

Fluo의 하네스는 "보존하되 중단시키지 않음(Preserve but don't crash)" 정책을 강제합니다. 이는 어댑터가 요청 생명주기를 방해하지 않으면서 유효하지 않은 데이터를 처리할 수 있어야 한다는 뜻입니다.

```typescript
async assertPreservesMalformedCookieValues(): Promise<void> {
  @Controller('/cookies')
  class CookieController {
    @Get('/')
    readCookies(_input: undefined, context: RequestContext) {
      return context.request.cookies;
    }
  }

  // ... 앱 부트스트랩 ...

  const response = await fetch(`http://127.0.0.1:${port}/cookies`, {
    headers: {
      cookie: 'good=hello%20world; bad=%E0%A4%A',
    },
  });

  const body = await response.json();
  // 'bad'는 '%E0%A4%A'로 유지되고 'good'은 디코딩된 상태여야 함
}
```

같은 테스트를 모든 공식 어댑터에 실행함으로써 Fluo는 일관된 개발자 경험을 유지합니다. 런타임 사이의 표준화는 핵심 과제입니다. 개발자가 방대한 생태계를 위해 Node.js를 선택하든 속도를 위해 Bun을 선택하든, Fluo가 기본 프리미티브를 처리하는 방식에 대한 기대치는 변하지 않아야 합니다.

이 정도의 엄격함이 있어야 어댑터 계층 위에 더 높은 수준의 추상화를 안정적으로 쌓을 수 있습니다. 또한 제3자 개발자에게 명확한 요구 사항과 자동화된 테스트를 제공해, 자신만의 어댑터를 기여하는 과정을 단순하게 만듭니다.

이식성 하네스는 더 많은 예외 케이스와 플랫폼 기능을 지원하면서 Fluo 어댑터 인터페이스의 살아있는 명세 역할을 합니다. 프레임워크 안에서 동작 기대치를 확인할 때 기준이 되는 Source of truth입니다.

## 14.5 Conformance Checks: Hono-Adapter Style

Hono 프로젝트는 "표준" 미들웨어 및 어댑터 준수로 잘 알려져 있습니다. Fluo도 `packages/testing/src/conformance`에서 암시적인 가정보다 명시적인 계약에 집중하는 유사한 접근 방식을 취합니다.

예를 들어 `platform-conformance.ts`는 플랫폼 어댑터가 모듈 그래프 초기화를 올바르게 처리하는지 확인합니다. 여기에는 모든 프로바이더가 올바른 순서로 인스턴스화되고, 생명주기 훅이 예상된 시점에 트리거되는지 검증하는 과정이 포함됩니다.

### Platform Conformance Surface

플랫폼 적합성 스위트는 어댑터와 런타임 사이의 핵심 핸드셰이크에 집중합니다. 어댑터가 자신의 기능을 올바르게 신호하고, 런타임이 자신의 디스패처를 어댑터의 리스너에 성공적으로 바인딩할 수 있는지 확인합니다.

적합성의 핵심 부분은 `onModuleInit`, `onApplicationBootstrap`, `onApplicationShutdown` 훅이 어댑터 자체의 시작 및 종료 시퀀스와 맞물려 정확한 시점에 트리거되는지 확인하는 것입니다. 적합성 제품군은 "스파이(spy)" 프로바이더 세트를 사용해 이러한 이벤트의 정확한 순서를 기록합니다. 표준 Fluo 라이프사이클에서 벗어나면 테스트가 실패하며, 이는 프로덕션에서만 나타나는 미묘한 버그를 줄입니다.

엄격한 라이프사이클 일관성을 유지하면 특정 시작 단계(예: 데이터베이스 연결 또는 메트릭 초기화)에 의존하는 플러그인과 인터셉터가 모든 환경에서 예측 가능하게 동작합니다. 어댑터가 실제 서버가 요청을 받을 준비가 되기 전에 `onApplicationBootstrap`을 실행하면, 웜업(warmup) 기간 동안 요청이 손실되는 레이스 컨디션이 발생할 수 있습니다. 적합성 하네스는 부트스트랩 신호가 방출된 직후 즉시 조사(probe) 요청을 보내 이러한 시나리오를 명시적으로 테스트합니다.

이 신뢰성은 Fluo가 자원 정리를 처리하는 방식까지 이어집니다. 종료 단계에서 적합성 스위트는 어댑터가 모든 활성 연결을 우아하게 닫고 보류 중인 요청이 완료된 뒤 종료되는지 확인합니다. 이는 제로 다운타임 배포를 위해 SIGTERM 처리가 필수적인 Kubernetes 같은 컨테이너 환경에서 애플리케이션이 깨끗하게 종료되도록 보장합니다.

또한 플랫폼 적합성 체크에는 어댑터의 오류 경계(Error boundary)에 대한 엄격한 평가가 포함됩니다. 부트스트랩 단계에서 처리되지 않은 예외가 발생하면, 어댑터는 표준 Fluo 진단 채널을 통해 오류를 보고하고 0이 아닌 종료 코드로 프로세스를 종료할 수 있음을 증명해야 합니다. 이러한 "실패 우선(fail-fast)" 동작은 트래픽을 처리할 수 없으면서 실행 중인 것처럼 보이는 "좀비" 프로세스를 막는 데 필요합니다.

```typescript
// packages/testing/src/conformance/platform-conformance.ts
export interface PlatformConformanceOptions {
  adapter: HttpApplicationAdapter;
  // ...
}

export async function runPlatformConformance(options: PlatformConformanceOptions) {
  // 1. 인스턴스 등록 확인
  // 2. 생명주기 훅 실행 순서 확인
  // 3. 부트스트랩 중 오류 처리 확인

  it('실시간 기능을 올바르게 보고해야 함', async () => {
    const caps = options.adapter.getRealtimeCapability?.();
    expect(caps).toBeDefined();
    // ... 추가 기능 확인 ...
  });

  it('listen() 실패를 우아하게 처리해야 함', async () => {
    // ... 포트 충돌 등에 대한 테스트 로직 ...
  });
}
```

이는 누군가가 새로운 어댑터(예: 가상의 `AzureFunctionsAdapter`)를 작성할 때, 프레임워크의 내부 요구 사항에 대해 자신의 작업을 즉시 검증할 수 있게 합니다. 또한 새로운 어댑터 저자를 위한 기대 동작 문서 역할도 합니다.

### Conformance Testing for Library Authors

커스텀 유효성 검사 파이프나 로깅 인터셉터처럼 fluo를 확장하는 라이브러리를 개발한다면 사용자에게 적합성 테스트를 제공해야 합니다. 이는 라이브러리가 fluo 생태계 안에서 예상대로 동작하고 부수 효과를 일으키지 않음을 보장합니다. 라이브러리의 구체적인 동작 요구 사항을 정의할 수 있도록 확장 가능한 `BaseLibraryConformanceHarness`를 제공합니다.

커스텀 파이프의 경우 적합성 스위트는 유효하지 않은 입력을 처리하는 방식과 DI 컨테이너의 메타데이터를 올바르게 전파하는지에 집중합니다. 인터셉터의 경우 실행 순서와 동기 및 비동기 결과를 모두 올바르게 처리할 수 있는지에 집중합니다. 파이프 저자가 흔히 저지르는 실수는 중첩된 객체 변환을 누락하는 것입니다. 적합성 하네스에는 복잡한 DTO의 구조적 무결성을 준수하는지 확인하는 심층 검증 시나리오가 포함되어 있습니다.

```typescript
// packages/testing/src/conformance/library-conformance.ts
export function runPipeConformance(pipe: Pipe, options: PipeOptions) {
  it('유효하지 않은 입력에 대해 BadRequestException을 던져야 함', async () => {
    // ... 테스트 로직 ...
  });
  
  it('변환 중에 메타데이터를 유지해야 함', async () => {
    // ... 테스트 로직 ...
  });
}
```

이러한 자동화된 검사는 fluo의 "플러그 가능한" 특성이 안정성을 희생하지 않도록 보장합니다. 프레임워크의 모든 확장 지점에는 라이브러리 저자가 안정적인 구현을 만들도록 안내하는 적합성 영역이 있습니다. 예를 들어, 커스텀 로깅 인터셉터는 요청 바디 스트림을 실수로 소비하지 않음을 증명해야 합니다. 그렇지 않으면 후속 컨트롤러가 페이로드를 읽지 못할 수 있습니다. 라이브러리 적합성 하네스에는 인터셉터가 헤더만 관찰해야 하는 경우 기본 `ReadableStream`이 올바르게 복제되거나 그대로 유지되는지 확인하는 "스트림 무결성" 테스트가 포함되어 있습니다.

`@fluojs/testing/conformance`에서 사용되는 패턴을 따르면 사용자에게 표준화된 통합 검증 방법을 제공할 수 있습니다. 이는 생태계의 신뢰성을 높이고 사용자와의 신뢰를 쌓는 데 도움이 됩니다. 테스트의 일관성은 동작의 일관성으로 이어지며, 이것이 fluo 프레임워크가 지향하는 핵심 목표입니다. 자체 도구와 라이브러리를 만들 때도 이러한 철학을 개발 프로세스의 우선순위에 두어야 합니다.

기본 기능 외에도 라이브러리 저자를 위한 적합성 하네스는 메모리 효율성과 성능 오버헤드도 확인합니다. 예를 들어 인증을 수행하는 미들웨어는 큰 대기 시간을 만들거나 응답이 전송된 후에도 요청 객체에 대한 참조를 유지해서는 안 됩니다. 적합성 스위트에 통합된 내부 벤치마킹 도구는 라이브러리 저자에게 추상화 비용에 대한 즉각적인 피드백을 제공합니다.

새로운 확장 패턴을 도입할 때는 라이브러리 저자가 Fluo RFC 프로세스에 참여하는 것이 좋습니다. 그래야 해당 패턴의 적합성 영역이 핵심 메인테이너와 함께 설계되고, 전체 프레임워크가 더 응집력 있고 예측 가능해집니다. 같은 신뢰성과 투명성 기준을 공유할 때 생태계는 안정적으로 성장합니다.

## 14.6 Portability for Edge Runtimes

Cloudflare Workers나 Vercel Edge Functions 같은 엣지 런타임은 Node의 레거시 `http` 모듈 대신 `Fetch API`를 사용합니다. 이는 `web-runtime-adapter-portability.ts`에서 볼 수 있는 다른 종류의 이식성 테스트를 요구합니다. 엣지 환경의 제약(메모리 제한 및 Node.js 전역 변수 부재 등)은 로컬 개발에서는 보이지 않던 버그를 자주 드러내기 때문에 이러한 테스트가 중요합니다.

이 테스트들은 다음 사항에 집중합니다:
- **글로벌 스코프(Global Scope)**: `fetch`, `Request`, `Response`, `Headers`의 가용성 및 올바른 동작.
- **스트리밍(Streaming)**: 대용량 페이로드를 위한 `ReadableStream` 동작이 부분 읽기나 메모리 급증을 초래하지 않는지 확인.
- **암호화(Crypto)**: JWT 서명이나 기타 암호화 작업을 위한 `crypto.subtle` 가용성 및 성능.
- **실행 제한(Execution Limits)**: 어댑터가 프레임워크 생명주기 내에서 CPU 시간 제한과 비동기 작업 스케줄링(예: `waitUntil`)을 올바르게 처리하는지 검증.

이러한 표면을 검증하면 Fluo 애플리케이션이 실제로 이식 가능하다는 근거를 확보할 수 있습니다. 팀은 핵심 로직을 다시 작성하지 않고도 컴퓨팅을 엣지로 옮길 수 있습니다. 엣지 전용 하네스는 프레임워크의 초기화 오버헤드가 현대적인 서버리스 플랫폼이 부과하는 엄격한 제한 안에 머무는지 확인하기 위해 "콜드 스타트(cold start)" 시나리오도 시뮬레이션합니다.

## 14.7 Testing the WebSocket Layer

WebSocket 적합성은 프로토콜이 구현체마다 크게 다르기 때문에 특히 까다롭습니다(표준 `ws` vs engine.io vs socket.io). Fluo의 `fetch-style-websocket-conformance.ts`는 Web API에서 사용되는 현대적인 `Upgrade` 헤더와 `WebSocketPair` 패턴에 집중합니다.

주요 검증 항목:
- 연결 수립 및 프로토콜 협상
- 메시지 에코 및 프레임 간 상태 유지
- 이진 데이터 처리 (ArrayBuffer, Blob)
- 우아한 종료 및 오류 전파
- 하트비트 및 Keep-Alive: 어댑터가 자원을 누수하거나 너무 일찍 타임아웃되지 않고 장기 연결을 처리할 수 있는지 보장.

Web API의 WebSocket 의미론을 표준화함으로써 Fluo는 전통적인 Node.js 서버와 현대적인 엣지 런타임 사이의 가교를 제공합니다. 이는 Node.js Fastify 백엔드용으로 작성된 WebSocket 서비스가, 어댑터가 적합성 스위트를 만족하는 한 최소한의 변경으로 Cloudflare Workers로 이식될 수 있음을 의미합니다. 또한 테스트 스위트는 장기 연결에서 미묘한 버그의 원인이 되곤 하는 하트비트 메커니즘도 다룹니다.

WebSocket 하네스에는 "백프레셔(backpressure)" 테스트도 포함되어 있습니다. 이는 클라이언트가 서버가 생성하는 것만큼 빠르게 메시지를 소비할 수 없는 상황을 어댑터가 올바르게 처리하는지 확인합니다. 하위 `WritableStream` 추상화를 활용해, Fluo는 높은 처리량의 실시간 통신 중 서버가 메모리 버퍼를 소진하지 않도록 보장합니다.

## 14.8 Practical Exercise: Verifying Your Custom Adapter

13장에서 커스텀 어댑터를 구현했다면, 이제 하네스를 사용해 이를 검증해야 합니다. 이는 어댑터가 fluo 동작 계약을 준수하는지 확인하는 핵심 테스트입니다. 이식성 하네스를 통과하면 기존 비즈니스 로직을 깨뜨리지 않고 서로 다른 런타임에 어댑터를 배포할 수 있다는 근거를 얻습니다.

```typescript
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/portability';
import { myAdapter } from './my-adapter';

const harness = createHttpAdapterPortabilityHarness({
  name: 'MyCustomAdapter',
  bootstrap: async (module, opts) => {
    const app = await FluoFactory.create(module, { adapter: myAdapter(opts) });
    return app;
  },
  run: async (module, opts) => {
    return await FluoFactory.run(module, { adapter: myAdapter(opts) });
  }
});

describe('MyCustomAdapter Portability', () => {
  it('잘못된 형식의 쿠키를 보존해야 함', () => harness.assertPreservesMalformedCookieValues());
  it('SSE를 처리해야 함', () => harness.assertSupportsSseStreaming());
  it('중단 시그널을 준수해야 함', () => harness.assertPropagatesAbortSignals());
  it('원시 바디 무결성을 검증해야 함', () => harness.assertPreservesRawBodyBuffer());
});
```

이 테스트를 실행할 때는 타이밍 데이터도 함께 봐야 합니다. 이식성 스위트에서 느린 테스트는 플랫폼 프리미티브의 하위 구현이 최적화되지 않았다는 신호일 수 있습니다. 하네스의 피드백을 사용해 어댑터를 정제하면 정확성과 성능을 함께 확인할 수 있습니다.

## 14.9 Why Line-by-Line Consistency Matters

fluo 프로젝트에서는 영어와 한국어 문서가 동일한 제목(Heading)을 유지해야 한다는 엄격한 정책을 따릅니다. 이는 단순한 형식 문제가 아닙니다. CI/CD 파이프라인이 자동화된 diff를 수행해 번역 과정에서 기술적인 섹션이 누락되지 않았는지 확인할 수 있게 하기 위한 장치입니다.

이 파일의 모든 제목은 영어 버전의 섹션과 정확히 일치합니다. 이러한 일관성은 기술적 깊이와 교육적 명확성이 언어를 넘어 보존되도록 보장합니다. 영어로 읽든 한국어로 읽든 같은 기술 가이드를 따라갈 수 있어야 하며, 이는 글로벌 채택과 기여자 신뢰를 목표로 하는 프레임워크에 필요합니다.

이 대칭성은 코드 예제까지 이어집니다. 문서 구조를 동기화된 상태로 유지하면 개발자가 흐름을 잃거나 서로 다른 사실관계에 부딪히지 않고 언어를 전환할 수 있습니다. 문서에서의 신뢰성은 코드에서의 신뢰성만큼 중요합니다.

## Summary

이식성 테스트는 Fluo 신뢰성의 근간입니다. `HttpAdapterPortabilityHarness`와 적합성 제품군을 사용하면, 코드가 거대한 Node.js 서버에서 실행되든 가벼운 엣지 함수에서 실행되든 "표준 우선" 약속이 지켜지는지 확인할 수 있습니다.

동작 일관성에 대한 이러한 약속은 기본 플랫폼의 특이성에 휘둘리지 않고 비즈니스 로직에 집중할 수 있음을 의미합니다. Fluo의 테스트 인프라는 이러한 차이가 프로덕션 환경에 도달하기 전에 포착되도록 설계되었습니다. 지원 플랫폼의 범위가 계속 확장될수록, 이러한 자동화된 체크는 생태계의 기준을 유지하는 주요 도구로 남습니다.

모든 어댑터 저자는 자신의 구현이 Fluo의 비전과 호환되는지 확인하기 위해 이러한 도구를 사용하는 것이 좋습니다. 견고한 테스트는 부가 요소가 아니라 현대적인 멀티 런타임 웹의 필수 요구 사항입니다. 이러한 적합성 및 이식성 표준을 준수하면 모든 Fluo 개발자를 위한 더 안정적이고 예측 가능한 기반을 만드는 데 기여할 수 있습니다.

다음 장에서는 생성된 모듈 그래프를 검사하고 복잡한 의존성 문제를 해결하는 시각적 진단 도구인 **Studio**를 다룹니다.
