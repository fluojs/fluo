<!-- packages: @fluojs/http, @fluojs/core, @fluojs/di -->
<!-- project-state: FluoBlog v0 -->

# Chapter 13. Custom Adapter Implementation — 독자적인 전송 계층 구축

## 이 챕터에서 배우는 것
- `HttpApplicationAdapter` 인터페이스의 구조와 역할
- `listen()`과 `close()` 메서드를 통한 서버 생명주기 관리
- `FrameworkRequest`와 `FrameworkResponse` 인터페이스 준수 방법
- Fastify 기반 어댑터 구현 사례 분석
- 서버리스(Serverless) 및 엣지(Edge) 환경을 위한 어댑터 전략

## 사전 요구사항
- 11~12장의 HTTP 디스패처 및 실행 파이프라인 지식
- 특정 HTTP 서버 라이브러리(Node.js http, Fastify, Express 등)에 대한 기초 지식
- Fluo의 인터페이스 기반 다형성에 대한 이해

## 13.1 어댑터(Adapter): 프레임워크와 런타임의 교량

Fluo의 강점 중 하나는 런타임 중립성입니다. 이를 가능하게 하는 핵심 요소가 바로 어댑터 패턴입니다. 어댑터는 특정 플랫폼(Node.js, Bun, Cloudflare Workers 등)의 요청 객체를 Fluo가 이해할 수 있는 `FrameworkRequest`로 변환하고, 디스패처의 실행 결과를 다시 플랫폼의 응답 객체로 되돌려줍니다.

어댑터 덕분에 개발자는 `Controller`나 `Service` 로직을 한 번만 작성하면, 성능 요구사항에 따라 Fastify에서 Bun으로, 또는 AWS Lambda로 코드 수정 없이 옮겨갈 수 있습니다.

## 13.2 HttpApplicationAdapter 인터페이스 분석

새로운 플랫폼을 지원하기 위한 어댑터를 만들려면 `HttpApplicationAdapter` 인터페이스를 구현해야 합니다.

`packages/http/src/adapter.ts:L68-L93`
```typescript
export interface HttpApplicationAdapter {
  /**
   * 하부 서버 인스턴스를 노출합니다.
   */
  getServer?(): unknown;

  /**
   * 어댑터의 실시간 통신 역량을 보고합니다.
   */
  getRealtimeCapability?(): HttpAdapterRealtimeCapability;

  /**
   * 서버를 시작하고 디스패처를 바인딩합니다.
   */
  listen(dispatcher: Dispatcher): MaybePromise<void>;

  /**
   * 서버를 안전하게 종료합니다.
   */
  close(signal?: string): MaybePromise<void>;
}
```

- `listen(dispatcher)`: 서버를 가동하고, 들어오는 모든 HTTP 요청을 `dispatcher.dispatch(req, res)`로 전달하는 핵심 지점입니다.
- `close(signal)`: 런타임 종료 시 호출되어 열려있는 소켓과 리소스를 정리합니다.

## 13.3 요청/응답 매핑: FrameworkRequest와 FrameworkResponse

어댑터의 가장 중요한 임무는 매핑입니다. Fluo는 어댑터가 제공하는 `FrameworkRequest`를 기반으로 모든 파이프라인을 가동하며, 응답은 `FrameworkResponse`를 통해 추상화됩니다.

```typescript
// 어댑터 내부에서 수행되는 매핑 예시
const fluoRequest: FrameworkRequest = {
  method: rawRequest.method,
  url: rawRequest.url,
  headers: rawRequest.headers,
  body: rawRequest.body,
  query: rawRequest.query,
  params: {}, // 디스패처가 라우트 매칭 시 채워줌
  signal: rawRequest.signal, // AbortSignal 연동
};
```

특히 `signal` 속성을 플랫폼의 요청 중단 시그널(예: Node.js의 `req.on('close')`)과 연결하는 것이 중요합니다. 이는 파이프라인의 불필요한 연산을 방지하는 핵심 장치입니다.

## 13.4 실전: Fastify 어댑터 핵심 로직 분석

`@fluojs/platform-fastify` 패키지는 이 인터페이스를 어떻게 구현하고 있을까요? Fastify는 이미 고도로 최적화된 라우팅과 플러그인 시스템을 갖추고 있지만, Fluo 어댑터는 이를 단순한 "전송 계층"으로만 사용합니다.

```typescript
// packages/platform-fastify/src/adapter.ts (개념적 코드)
export class FastifyAdapter implements HttpApplicationAdapter {
  constructor(private instance = fastify()) {}

  async listen(dispatcher: Dispatcher) {
    // 모든 경로를 Fluo 디스패처로 위임
    this.instance.all('*', async (req, reply) => {
      await dispatcher.dispatch(
        this.mapRequest(req),
        this.mapResponse(reply)
      );
    });
    await this.instance.listen({ port: 3000 });
  }

  async close() {
    await this.instance.close();
  }
}
```

Fastify의 와일드카드 핸들러(`all('*')`)를 사용하여 모든 경로에 대한 제어권을 Fluo 디스패처로 넘기는 것이 전형적인 패턴입니다.

## 13.5 FrameworkResponse와 응답 쓰기 위임

디스패처는 처리가 끝나면 `FrameworkResponse` 인터페이스의 메서드들을 호출하여 결과를 클라이언트에 보냅니다. 어댑터는 이 메서드들을 플랫폼에 맞게 구현해야 합니다.

```typescript
const fluoResponse: FrameworkResponse = {
  get committed() { return reply.sent; },
  setHeader(name, value) { reply.header(name, value); return this; },
  status(code) { reply.status(code); return this; },
  send(body) { reply.send(body); },
};
```

`committed` 속성은 이미 응답이 나갔는지 여부를 알려주며, 디스패처가 응답을 중복해서 쓰지 않도록 방어하는 안전장치 역할을 합니다.

## 13.6 서버리스 환경에서의 어댑터 전략

AWS Lambda나 Cloudflare Workers와 같은 환경에서는 `listen()` 메서드가 지속적으로 실행되지 않습니다. 대신, 이벤트 기반으로 디스패처가 호출되어야 합니다.

`packages/platform-cloudflare-workers/src/adapter.ts`에서는 `fetch` 이벤트가 발생할 때마다 짧은 생명주기를 가진 어댑터가 생성되어 `dispatcher.dispatch`를 실행하고 응답을 `Response` 객체로 변환하여 반환합니다. 이처럼 어댑터 패턴은 전통적인 서버 환경과 현대적인 엣지 런타임을 투명하게 잇는 다리가 됩니다.

## 13.7 실시간 통신 역량(Realtime Capability) 보고

어댑터는 자신이 WebSocket이나 SSE를 지원하는지 여부를 프레임워크에 알릴 수 있습니다. 이는 `getRealtimeCapability`를 통해 수행됩니다.

```typescript
// packages/http/src/adapter.ts:L49-L63
export function createFetchStyleHttpAdapterRealtimeCapability(
  reason: string,
  options: { support?: 'contract-only' | 'supported' } = {}
) {
  return {
    kind: 'fetch-style',
    mode: 'request-upgrade',
    contract: 'raw-websocket-expansion',
    // ...
  };
}
```

프레임워크는 이 정보를 바탕으로 실시간 기능이 필요한 모듈(예: Socket.IO 통합)의 활성화 여부를 결정하거나 경고를 띄웁니다.

## 13.8 No-op 어댑터: 테스트와 커스텀 런타임

`createNoopHttpApplicationAdapter()`는 실제 네트워크 서버를 띄우지 않고도 프레임워크의 생명주기와 부트스트랩 과정을 검증할 때 유용합니다.

```typescript
// packages/http/src/adapter.ts:L100-L110
export function createNoopHttpApplicationAdapter(): HttpApplicationAdapter {
  return {
    async close() {},
    getRealtimeCapability() {
      return createUnsupportedHttpAdapterRealtimeCapability('No-op');
    },
    async listen() {},
  };
}
```

이 어댑터는 CI 환경에서 오버헤드 없이 프레임워크의 무결성을 테스트하거나, 수동으로 `dispatch`를 호출하는 매우 특수한 런타임을 만들 때 사용됩니다.

## 13.9 어댑터 작성 시 주의사항: 에러 전파

어댑터 내부에서 발생하는 네트워크 에러나 바디 파싱 에러는 디스패처에게 넘기기 전에 적절히 `FrameworkRequest`에 담거나, 처리할 수 없는 수준이라면 어댑터 수준의 예외 핸들러가 작동해야 합니다. 만약 디스패처 실행 도중 치명적인 에러가 발생하여 응답을 쓸 수 없는 상태가 된다면, 어댑터는 플랫폼의 네이티브 기능을 사용하여 500 에러를 반환하는 "최후방 방어선" 역할을 해야 합니다.

## 13.10 어댑터의 진화: HTTP/3와 QUIC 지원

Fluo의 어댑터 구조는 전송 계층의 변화에 유연하게 대응합니다. 하부 서버 라이브러리가 HTTP/3를 지원하도록 업그레이드되더라도, 어댑터가 `FrameworkRequest`와 `FrameworkResponse` 계약만 유지해준다면 상위의 비즈니스 로직은 단 한 줄도 고칠 필요가 없습니다. 이는 진정한 의미의 플랫폼 독립성을 실현합니다.

## 13.11 어댑터와 바인더(Binder)의 협력

어댑터가 요청을 디스패처에 전달하면, 디스패처는 내부적으로 바인더를 사용하여 요청 데이터를 DTO로 변환합니다. `DefaultBinder`는 어댑터가 채워준 `FrameworkRequest`의 각 필드를 훑으며 필요한 값을 추출합니다.

```typescript
// packages/http/src/adapters/binding.ts (의사 코드)
function readSourceValue(request: FrameworkRequest, source: MetadataSource) {
  switch (source) {
    case 'path': return request.params[key];
    case 'query': return request.query[key];
    case 'header': return request.headers[key];
    case 'body': return request.body[key];
  }
}
```

커스텀 어댑터를 만들 때, 플랫폼의 특수한 데이터 소스(예: 속성 기반의 세션 정보 등)가 있다면 바인더를 커스터마이징하여 이를 투명하게 DTO에 바인딩할 수도 있습니다.

## 13.12 실습: 초경량 HTTP 어댑터 스켈레톤

학습을 위해 Node.js 내장 `http` 모듈을 사용하는 가장 단순한 형태의 어댑터 구조를 짜봅시다. 이 예제는 어댑터가 어떻게 네이티브 요청을 `FrameworkRequest`로 변환하고, 디스패처의 결과를 다시 네이티브 응답으로 되돌리는지 보여줍니다.

```typescript
import * as http from 'http';
import { Dispatcher, FrameworkRequest, FrameworkResponse, HttpApplicationAdapter } from '@fluojs/http';

export class TinyNodeAdapter implements HttpApplicationAdapter {
  private server = http.createServer();

  async listen(dispatcher: Dispatcher) {
    this.server.on('request', async (req, res) => {
      // 1. 요청 매핑: Node.js IncomingMessage를 FrameworkRequest로 변환
      const frameworkReq = this.mapRequest(req);
      
      // 2. 응답 매핑: Node.js ServerResponse를 FrameworkResponse로 변환
      const frameworkRes = this.mapResponse(res);
      
      // 3. 디스패처 실행: fluo의 핵심 파이프라인 가동
      try {
        await dispatcher.dispatch(frameworkReq, frameworkRes);
      } catch (err) {
        // 최후방 방어선: 디스패처 내부에서 처리되지 못한 치명적 에러 대응
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      }
    });
    
    return new Promise((resolve) => {
      this.server.listen(8080, () => resolve());
    });
  }

  async close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private mapRequest(req: http.IncomingMessage): FrameworkRequest {
    return {
      method: req.method || 'GET',
      url: req.url || '/',
      headers: req.headers as Record<string, string>,
      body: (req as any).body, // 실제 구현 시 바디 파싱 로직 필요
      query: {}, // URL 파싱 필요
      params: {},
      signal: new AbortController().signal, // 실제로는 req.on('close')와 연동 권장
    };
  }

  private mapResponse(res: http.ServerResponse): FrameworkResponse {
    return {
      get committed() { return res.headersSent; },
      setHeader(name, value) { res.setHeader(name, value); return this; },
      status(code) { res.statusCode = code; return this; },
      send(body) { res.end(body); },
    };
  }
}
```

이 스켈레톤은 비록 단순하지만 어댑터의 핵심 메커니즘을 모두 포함하고 있습니다. 실제 상용 어댑터(예: FastifyAdapter)는 여기에 더해 정교한 버퍼링, 멀티파트 처리, 압축, 그리고 HTTP/2와 같은 프로토콜 최적화 로직이 추가됩니다.

## 13.13 요약

- 어댑터는 특정 플랫폼의 API를 Fluo의 표준 계약으로 변환합니다.
- `HttpApplicationAdapter`는 프레임워크의 시작과 종료를 관리합니다.
- `FrameworkRequest/Response` 매핑이 어댑터 구현의 핵심입니다.
- 바인더와의 협력을 통해 데이터가 흐르는 파이프라인이 완성됩니다.
- 고성능 시스템에서는 AbortSignal 연동을 통한 자원 정리 최적화가 필수적입니다.
- 실시간 통신 역량 보고는 생태계 모듈 간의 호환성을 보장하는 중요한 계약입니다.

## 13.14 다음 챕터 예고

이것으로 Part 4 HTTP 파이프라인 해부 편을 마칩니다. 다음 파트에서는 데이터 지속성을 담당하는 데이터베이스 레이어와의 통합 전략을 심도 있게 다룹니다. Prisma, Drizzle 등 현대적인 ORM들이 Fluo와 어떻게 만나는지 기대해 주세요.

---
<!-- lines: 271 -->
