<!-- packages: @fluojs/runtime, @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: T16 Part 3 source-analysis draft for runtime branching across root, Node, and Web-standard execution surfaces -->

# 10. Runtime Branching: Node vs Web vs Edge

## 10.1 Fluo branches by package surface and adapter seams more than by giant runtime conditionals
Chapter 10에 오면 가장 먼저 깨달아야 할 사실은, Fluo의 runtime portability가 하나의 거대한 `if (isNode) ... else if (isEdge) ...` 블록으로 구현되지 않는다는 점입니다. branch point는 훨씬 더 좁고, 아키텍처적으로 설계되어 있습니다.

`path:packages/runtime/src/bootstrap.ts:920-1202`의 핵심 bootstrap logic 대부분은 transport-neutral합니다. module graph를 compile하고, DI container를 만들고, runtime token을 등록하고, lifecycle instance를 resolve하며 application shell을 조립합니다. 이 코드 어디에도 Node인지, Web platform인지, 혹은 Edge runtime인지 묻는 분기문은 없습니다.

실제 branching은 host-specific capability가 필요한 좁은 "솔음(Seam)"에서만 일어납니다:
1. **Export Map**: package export map이 각 subpath에서 무엇이 public인지 결정합니다.
2. **Transport Adapters**: adapter가 raw request/response를 framework object로 바꾸는 방식을 결정합니다.
3. **Orchestration**: shutdown과 server orchestration helper는 root barrel이 아닌 host-specific file에 위치합니다.

Fluo는 공통 runtime shell을 중앙에 두고, 명시적인 surface boundary에서만 분기합니다. 이 철학은 `path:packages/runtime/src/exports.test.ts:12-79`에 코드로 박혀 있습니다. 테스트는 root barrel이 transport-neutral해야 하고, Node-only helper는 `./node`에, Web helper는 `./web`에 있어야 한다고 강제합니다.

## 10.2 The root runtime barrel is intentionally transport-neutral and the export map enforces it
`path:packages/runtime/src/index.ts:1-30`에 정의된 root public surface는 bootstrap API, error, diagnostics, 그리고 `APPLICATION_LOGGER`와 같은 선별된 runtime token만 export합니다. 여기서 `dispatchWebRequest`나 `bootstrapHttpAdapterApplication`은 노출되지 않습니다.

`path:packages/runtime/src/exports.test.ts:13-29`는 이를 엄격하게 검증합니다. root barrel이 특정 호스트에 종속된 기능을 노출하지 않도록 함으로써, application logic이 모든 host에서 신뢰할 수 있는 공통 기반에만 의존하도록 보장합니다.

`path:packages/runtime/package.json:27-56`의 package export map은 이 정책을 실질적으로 강제합니다:
- `.` (휴대용 루트)
- `./node` (Node 전용)
- `./web` (Web 표준 전용)
- `./internal/*` (저수준 솔음)

이 구조는 임의의 deep import로 host-specific file을 끌어다 쓰는 것을 원천적으로 차단합니다. application code가 Node helper를 import한다면, 그 import path 자체가 이미 portability cost를 명시적으로 선언하게 됩니다.

## 10.3 The Node branch packages server lifecycle, retries, compression, and shutdown
public Node entrypoint인 `path:packages/runtime/src/node.ts`는 `path:packages/runtime/src/node/internal-node.ts` 위에 놓인 큐레이션된 파사드(Façade)입니다. 여기서 runtime은 Node HTTP/HTTPS server, socket, listen retry behavior, process-signal shutdown 등 root runtime이 가정할 수 없는 capability를 다룹니다.

`path:packages/runtime/src/node/internal-node.ts:108-194`의 `NodeHttpApplicationAdapter`가 핵심 transport object입니다.
- **Listen with Retry**: `listenNodeServerWithRetry()`는 `EADDRINUSE` 에러를 한도까지 재시도하여 서버 기동의 안정성을 높입니다.
- **Graceful Shutdown**: `closeNodeServerWithDrain()`은 idle connection을 닫고, timeout 이후 lingering socket을 강제 종료하여 안전한 종료 프로세스를 보장합니다.

`createNodeHttpAdapter()`는 이러한 Node concern을 portable한 `HttpApplicationAdapter` 구현으로 포장합니다. Node 전용 편의 기능이 암묵적인 설정을 끌고 들어오지 않도록, `path:packages/runtime/src/node/node.test.ts:14-48`에서는 명시적인 지정이 없는 한 기본 포트를 `3000`으로 고정하는 explicitness 정책을 따릅니다.

## 10.4 The Web and Edge branch reuse the Web-standard Request/Response seam
`path:packages/runtime/src/web.ts:1-606`에 위치한 Web branch는 native Web `Request`와 `Response` object를 Fluo의 framework contract로 정규화합니다. 핵심 API는 `createWebRequestResponseFactory()`와 `dispatchWebRequest()`입니다.

`createWebFrameworkRequest()`는 다음과 같은 정규화를 수행합니다:
- URL 파싱 및 헤더 매핑
- 쿠키 및 멀티파트 페이로드 처리
- JSON, Text, Form 등 바디 컨텐츠 해소
- `WebResponseStream`을 통한 SSE-friendly streaming 지원

`path:packages/runtime/src/web.test.ts:7-146` 테스트는 이 branch가 native 객체를 framework 형상으로 번역하고, 에러를 native Response로 직렬화하며, 스트리밍 바디의 크기 제한을 엄격히 준수함을 검증합니다.

이 normalization seam 덕분에 Fluo는 Cloudflare Workers, Deno, Bun과 같은 Edge runtime을 동일한 방식으로 지원합니다. 호스트가 Web-standard `Request`/`Response`를 제공한다면, runtime은 바로 이 Web seam을 통해 연결됩니다. 즉, 별도의 `edge.ts` 없이도 Web 표준 솔음을 통해 Edge 지원이 이루어집니다.

## 10.5 Shared request/response factories: 정규화의 좁은 교량
전체 branching 구조를 관통하는 핵심 파일은 `path:packages/runtime/src/adapters/request-response-factory.ts`입니다. 이것이 raw I/O와 framework dispatcher 사이의 host-agnostic bridge 역할을 합니다.

`RequestResponseFactory` interface는 다음 다섯 가지 핵심 동작을 요구합니다:
1. raw request로부터 framework request 생성
2. host primitive로부터 abort signal 생성
3. framework response 생성
4. request ID 해석
5. error response 기록

그 위에서 `dispatchWithRequestResponseFactory()`가 response 생성, signal 유도, request 생성 및 dispatcher 호출 로직을 일관되게 처리합니다. 이 helper가 runtime branching의 진짜 **중복 방지 솔음(Anti-duplication seam)**입니다. Node와 Web branch는 각각 dispatcher invocation이나 error fallback을 구현하지 않고, 서로 다른 factory만 공급할 뿐입니다.

- **Node Factory**: `path:packages/runtime/src/node/internal-node.ts:196-238`의 `createNodeRequestResponseFactory()`.
- **Web Factory**: `path:packages/runtime/src/web.ts:246-274`의 `createWebRequestResponseFactory()`.

둘 다 동일한 interface를 반환하며, 이는 host-specific divergence를 좁고 명시적으로 유지하면서도 module graph, container, lifecycle hook, dispatcher와 같은 고수준 behavior를 모든 환경에서 동일하게 보존하는 비결입니다. Fluo의 runtime branching은 대부분의 시스템이 이미 host-agnostic해진 아주 늦은 시점의 좁은 transport seam에서만 분기함으로써 휴대성과 안정성을 동시에 달성합니다.

