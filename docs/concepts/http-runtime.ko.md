# HTTP 런타임

<p><a href="./http-runtime.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti는 기반 웹 서버(Fastify, Bun, Cloudflare Workers 등)의 복잡성을 추상화하면서도 엄격한 phase 기반 요청 lifecycle을 제공하는 고성능 **HTTP Runtime Facade**를 제공합니다.

## 이 개념이 중요한 이유

많은 프레임워크에서 “request journey”는 black box입니다. Middleware, filter, guard, interceptor가 서로 겹쳐 보이기 때문에 다음과 같은 단순한 질문에도 답하기 어렵습니다:
- “인증 로직은 어디에 넣어야 하나요?”
- “왜 내 validation error가 global filter에 잡히지 않나요?”
- “내 response는 logger에 도달하기 전에 이미 serialized 되었나요?”

Konekti는 **명시적인 실행 순서**로 이 모호함을 제거합니다. 모든 요청에 대해 명확하고 단방향인 여정을 정의함으로써 security, validation, observability가 API 전반에서 일관되게 처리되도록 보장합니다.

## 핵심 아이디어

### Runtime 추상화 (the facade)
비즈니스 logic은 Node.js + Fastify에서 실행되는지, serverless Edge function에서 실행되는지에 의존해서는 안 됩니다.
- **통합 컨텍스트**: Konekti는 raw request/response object를 `KonektiContext`로 감쌉니다.
- **Platform Agnostic**: controller와 service는 한 번만 작성하면 됩니다. platform adapter(예: `@konekti/platform-fastify`)가 특정 server engine으로의 변환을 처리합니다.

### materialization gate
Konekti는 들어오는 HTTP data(body, query, params)를 **신뢰할 수 없는 원시 입력**으로 취급합니다.
- **Gatekeeper**: `@FromBody()` 같은 decorator를 사용해 데이터를 타입이 지정된 TypeScript class로 “materialize”합니다.
- **Validation-First**: controller handler가 호출되기 전에 이 materialized data는 정의한 schema에 대해 검증됩니다. 검증에 실패하면 요청은 명확한 400 error로 거부되어 business logic이 손상된 데이터를 다루지 않게 됩니다.

### interceptor “onion”
Konekti는 요청 처리를 위한 “onion” 모델을 사용합니다. 각 phase(Middleware -> Guard -> Interceptor)는 다음 단계를 감싸며, handler의 **전**과 **후** 모두에서 logic을 실행할 수 있게 합니다. 이는 logging, performance timing, response transformation에 특히 적합합니다.

## 실행 순서

1. **Platform Adapter**: 네트워크로부터 raw byte stream을 수신합니다.
2. **Context Initialization**: `KonektiContext`를 생성합니다.
3. **Global Middleware**: 원시 cross-cutting concern(CORS, compression 등)을 처리합니다.
4. **Route Discovery**: URL path를 특정 Controller method와 매칭합니다.
5. **Guard Check**: authorization boundary입니다. guard가 `false`를 반환하면 여정은 403으로 끝납니다.
6. **Interceptor (Pre-Handler)**: 데이터가 처리되기 직전 logic을 실행합니다.
7. **Input Materialization & Validation**: 원시 JSON이 타입이 지정되고 검증된 class instance가 됩니다.
8. **Controller Handler**: business logic이 실행됩니다.
9. **Interceptor (Post-Handler)**: 결과를 변환합니다(예: `{ data: ... }` 객체로 감싸기).
10. **Response Serialization**: 결과를 JSON 또는 요청된 형식으로 다시 변환합니다.
11. **Final Write**: platform adapter가 응답을 클라이언트로 보냅니다.

## 경계

- **Raw Access 금지**: platform portability를 유지하기 위해 `req`나 `res`를 직접 건드리는 것을 지양합니다. `KonektiContext`를 사용하세요.
- **Contract-Based Responses**: controller의 반환값은 `@Produces()` 또는 `@HttpCode()` metadata를 기반으로 자동 serialization됩니다.
- **Exception Boundary**: 어떤 phase에서든 포착되지 않은 error는 **Global Exception Filter**가 잡아 클라이언트에게 raw stack trace 대신 표준화된 error response를 전달합니다.

## 관련 문서

- [Architecture Overview](./architecture-overview.ko.md)
- [Decorators and Metadata](./decorators-and-metadata.ko.md)
- [DI and Modules](./di-and-modules.ko.md)
- [HTTP Package README](../../packages/http/README.ko.md)
