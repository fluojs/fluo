<!-- packages: @fluojs/testing, @fluojs/http, @fluojs/runtime -->
<!-- project-state: FluoBlog v0 -->

# Chapter 14. Portability Testing and Conformance — 이식성 테스트와 적합성 검증

이 장에서는 fluo가 여러 런타임에서 같은 동작을 유지하도록 검증하는 이식성 테스트와 적합성 테스트의 역할을 설명합니다. Chapter 13에서 어댑터를 구현했다면, 이제 그 어댑터가 계약을 실제로 지키는지 자동화로 증명해야 합니다.

## Learning Objectives
- 이식성 테스트와 적합성 테스트가 각각 어떤 실패를 잡아내는지 이해합니다.
- `HttpAdapterPortabilityHarness`의 구조와 핵심 검증 표면을 배웁니다.
- 잘못된 형식의 쿠키, 원시 바디, SSE 같은 경계 사례를 어떻게 검증하는지 살펴봅니다.
- 플랫폼 적합성 스위트가 결정론적 start, 멱등적 stop, 안전한 진단과 스냅샷, 검증 cleanup 같은 공개 컴포넌트 단언을 어떻게 검증하는지 분석합니다.
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
2. **원시 바디 보존(Raw Body Preservation)**: JSON 및 text에서는 `rawBody`를 사용할 수 있고, byte-sensitive payload에서는 정확한 바이트가 보존되며, 메모리 절약을 위해 multipart request에서는 제외되는지 확인.
3. **SSE (Server-Sent Events)**: 버퍼링 없이 연결을 열린 상태로 유지하는 적절한 스트리밍 동작 확인.
4. **시작 로그(Startup Logs)**: 어댑터가 표준화된 훅을 통해 리스닝 호스트와 포트를 올바르게 보고하는지 검증.
5. **종료 시그널(Shutdown Signals)**: 메모리 누수를 방지하기 위해 `SIGTERM` 및 `SIGINT` 리스너가 종료 후 올바르게 정리되는지 확인.

하니스가 앱을 bootstrap한 뒤 assertion 본문이 실행되기 전에 setup 또는 `listen()`이 실패해도 cleanup은 계약에 포함됩니다. 부분적으로 bootstrap된 앱은 반드시 닫혀야 하며, `close()`까지 실패하면 원래 setup 실패와 cleanup 실패를 함께 보고합니다.

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

예를 들어 `platform-conformance.ts`는 플랫폼 지향 패키지가 `createPlatformConformanceHarness(...)`를 통해 노출할 수 있는 공개 컴포넌트 수준 계약을 확인합니다. 검증은 오래 지속되는 부수 효과를 남기지 않아야 하며, 시작은 결정론적이어야 하고, 정지는 멱등적이어야 하며, degraded/failed 상태의 스냅샷은 안전해야 하고, 진단은 안정적이어야 하며, 스냅샷은 민감한 키를 제거해야 합니다.

### Platform Conformance Surface

플랫폼 적합성 스위트는 숨겨진 라이프사이클 안무가 아니라 안정적인 공개 단언에 집중합니다. 모든 프로바이더 라이프사이클 훅이 특정 네트워크 준비 시점에 실행되었는지, 활성 연결이 drain되었는지, 부트스트랩 실패 뒤 프로세스가 종료되었는지를 증명하지는 않습니다. 그런 보장은 해당 동작을 소유한 어댑터나 런타임 패키지 테스트에 두어야 합니다. 공개 하네스는 어댑터 및 도구 작성자를 위해 재사용 가능한 공개 컴포넌트 계약 기준선을 제공합니다. 반복적인 start/stop 호출은 예측 가능해야 하고, 진단과 스냅샷은 안전하게 검사할 수 있어야 하며, 검증은 지속 상태를 남기면 안 됩니다.

```typescript
import { createPlatformConformanceHarness } from '@fluojs/testing/platform-conformance';

const harness = createPlatformConformanceHarness({
  createComponent: () => myPlatformComponent,
  // ...
});

await harness.assertAll();
```

이는 플랫폼 지향 컴포넌트를 작성하는 사람이 공개 컴포넌트 계약에 대해 자신의 작업을 즉시 검증할 수 있게 합니다. 또한 어댑터 및 도구 작성자를 위한 기대 동작 문서 역할도 합니다.

### Conformance Testing for Library Authors

커스텀 유효성 검사 파이프나 로깅 인터셉터처럼 fluo를 확장하는 라이브러리를 개발한다면 사용자에게 게시하는 계약을 설명하는 테스트를 여전히 제공해야 합니다. `@fluojs/testing`은 현재 platform, HTTP adapter, web-runtime adapter, fetch-style WebSocket 계약을 위한 구체적인 harness subpath를 배포합니다. 전용 pipe/interceptor/library conformance harness는 아직 공개 표면에 포함되어 있지 않으므로, custom library 저자는 존재하지 않는 공유 하네스에 의존하지 말고 이러한 패턴을 참고해 자신의 패키지 테스트를 작성해야 합니다.

`@fluojs/testing/platform-conformance`와 다른 배포된 harness subpath에서 사용하는 명시적 단언 스타일을 따르면 사용자에게 표준화된 통합 검증 방법을 제공할 수 있습니다. 이는 생태계의 신뢰성을 높이고 사용자와의 신뢰를 쌓는 데 도움이 됩니다. 테스트의 일관성은 동작의 일관성으로 이어지며, 이것이 fluo 프레임워크가 지향하는 핵심 목표입니다. 새로운 확장 패턴에 공유 적합성 영역이 필요하다면, 먼저 패키지 소유 테스트와 RFC에서 시작해 향후 공개 하네스의 범위를 명확하게 설계하세요.

## 14.6 Portability for Edge Runtimes

Cloudflare Workers나 Vercel Edge Functions 같은 엣지 런타임은 Node의 레거시 `http` 모듈 대신 `Fetch API`를 사용합니다. 이는 `web-runtime-adapter-portability.ts`에서 볼 수 있는 다른 종류의 이식성 테스트를 요구합니다. Fetch 형태의 요청/응답 처리는 Node의 스트림 우선 API와 다르기 때문에 이러한 테스트가 중요합니다.

이 테스트들은 다음 사항에 집중합니다:
- **쿼리 디코딩(Query decoding)**: 반복 쿼리 파라미터와 잘못된 percent-encoding 동작 보존.
- **쿠키 정규화(Cookie normalization)**: 유효한 쿠키 값은 디코딩하고 잘못된 값은 정확히 보존.
- **Raw body 처리**: JSON/text raw body 및 바이트 민감 페이로드의 정확한 바이트 보존.
- **Multipart 경계**: multipart 요청에서 `rawBody`를 제외하면서도 파싱된 필드와 파일 노출.
- **SSE framing**: 안정적인 event/data framing을 가진 `text/event-stream` 응답 반환.

이러한 표면을 검증하면 HTTP 요청 의미론이 Fetch 스타일 런타임 사이에서 이식 가능하게 유지된다는 근거를 확보할 수 있습니다. 현재 web-runtime 하네스는 global-scope 가용성, `crypto.subtle` 성능, CPU 제한, `waitUntil`, cold-start budget을 확인하지 않습니다. 어댑터가 그런 항목을 문서화한다면 별도의 패키지 소유 테스트가 필요합니다.

## 14.7 Testing the WebSocket Layer

WebSocket 적합성은 프로토콜이 구현체마다 크게 다르기 때문에 특히 까다롭습니다(표준 `ws` vs engine.io vs socket.io). 현재 Fluo의 `fetch-style-websocket-conformance.ts`는 의도적으로 좁은 범위를 가집니다. 어댑터가 raw WebSocket 확장 계약을 설명하는 안정적인 fetch-style realtime capability를 노출하는지 확인합니다.

주요 검증 항목:
- 어댑터가 `getRealtimeCapability()`를 제공하는지
- capability가 `kind: 'fetch-style'`인지
- capability가 `raw-websocket-expansion` 계약 태그, `request-upgrade` 모드, version `1`을 유지하는지
- support level과 reason이 어댑터의 문서화된 WebSocket 지원과 일치하는지

이 단언은 Fluo의 raw WebSocket 계약이 발전하는 동안 어댑터 지원 주장이 정직하게 유지되도록 합니다. 소켓을 열거나, subprotocol을 협상하거나, 메시지를 echo하거나, binary frame을 검사하거나, 우아한 종료를 단언하거나, heartbeat 동작을 테스트하거나, backpressure를 적용하지는 않습니다. 어댑터가 오늘 그런 동작을 약속한다면 해당 어댑터 패키지의 자체 테스트에서 다뤄야 합니다.

## 14.8 Practical Exercise: Verifying Your Custom Adapter

13장에서 커스텀 어댑터를 구현했다면, 이제 하네스를 사용해 이를 검증해야 합니다. 이는 어댑터가 fluo 동작 계약을 준수하는지 확인하는 핵심 테스트입니다. 이식성 하네스를 통과하면 기존 비즈니스 로직을 깨뜨리지 않고 서로 다른 런타임에 어댑터를 배포할 수 있다는 근거를 얻습니다.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { createHttpAdapterPortabilityHarness } from '@fluojs/testing/http-adapter-portability';
import { myAdapter } from './my-adapter';

const harness = createHttpAdapterPortabilityHarness({
  name: 'MyCustomAdapter',
  bootstrap: async (module, opts) => {
    const app = await FluoFactory.create(module, { adapter: myAdapter(opts) });
    return app;
  },
  run: async (module, opts) => {
    const app = await FluoFactory.create(module, { adapter: myAdapter(opts) });
    await app.listen();
    return app;
  }
});

describe('MyCustomAdapter Portability', () => {
  it('잘못된 형식의 쿠키를 보존해야 함', () => harness.assertPreservesMalformedCookieValues());
  it('SSE를 처리해야 함', () => harness.assertSupportsSseStreaming());
  it('JSON 및 text 원시 바디를 보존해야 함', () => harness.assertPreservesRawBodyForJsonAndText());
  it('multipart 원시 바디를 제외해야 함', () => harness.assertExcludesRawBodyForMultipart());
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
