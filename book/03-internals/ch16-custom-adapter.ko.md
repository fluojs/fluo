# 직접 어댑터를 만들고 계약 검증하기

<!-- book:volume=03-internals;chapter=16 -->

[이전: Next.js 안에서 Fluo 실행하기](./ch15-nextjs-hosting.ko.md) · [목차](./toc.ko.md) · [다음: 재사용 가능한 Fluo 확장 패키지 만들기](./ch17-extension-package.ko.md)

## 새 라우터를 만들기 전에 필요한 접점을 줄인다

운영팀은 FluoBlog와 FluoShop을 사내 요청 재현 도구에 연결하려 한다. 도구는 저장한 HTTP 요청을 Web `Request`로 제공하고 `Response`를 관찰한다. 네트워크 포트도, WebSocket upgrade도 필요 없다. 같은 게시글 조회와 주문 서비스의 module graph를 실행하되 실제 결제나 외부 전송은 하지 않는 환경이다. 기존 Fastify 서버를 띄워 도구가 다시 HTTP로 호출할 수도 있지만, 이번 요구는 이미 존재하는 호스트의 요청 함수에 직접 연결하는 것이다.

앞 세 장에서 알게 된 중요한 사실은 어댑터가 controller를 찾고 직접 호출할 필요가 없다는 점이다. runtime은 모듈을 컴파일하고 DI 컨테이너와 dispatcher를 만든다. `HttpApplicationAdapter.listen(dispatcher)`는 그 dispatcher를 호스트에 연결한다. 메서드·경로·DTO·guard·오류 표현을 새로 구현하면 어댑터를 만드는 대신 프레임워크를 복제하게 된다.

이 장에서는 `@fluojs/runtime/web`의 factory와 dispatch 시작 함수를 재사용하는 작은 host-owned adapter를 완성한다. 이것은 새 공식 platform package나 모든 호스트를 지원하는 범용 서버가 아니다. 소켓·TLS·signal·응답 바디의 네트워크 전송은 주변 호스트가 소유한다. adapter는 요청 수락, dispatcher 연결, 진행 중인 dispatch의 완료와 terminal close를 소유한다. 반환된 스트림의 소비·취소까지 끝난 뒤 application을 닫는 것이 호스트의 계약이다.

특히 dispatch 완료와 응답 전송 완료는 같지 않다. 이 adapter가 기다리는 것은 runtime의 `completion`이며 클라이언트가 마지막 바이트를 받았다는 확인이 아니다. 사내 재현 도구는 응답 본문을 읽거나 취소하고 close를 호출한다. Worker처럼 SSE body와 upgrade된 socket의 수명을 별도로 추적해야 하는 호스트에는 14장의 공식 adapter가 더 적합하다. 이 경계를 처음부터 명시해야 작은 구현이 정직한 구현이 된다.

## 첫 실패는 요청이 아니라 너무 빠른 close에서 만든다

처음 떠올릴 구현은 dispatcher를 필드에 저장하고 `dispatchWebRequest()`를 호출하는 형태다. JSON 한 번을 반환하는 실험은 통과할 수 있다. 하지만 close가 필드만 비우고 끝나면 이미 수락한 handler가 아직 provider를 사용하고 있는데 application이 정리를 시작할 수 있다. “새 요청을 받지 않는다”와 “수락한 작업을 끝냈다”를 동시에 지켜야 한다.

이를 시험하려고 실제 DB 지연을 만들 필요는 없다. 제어 가능한 읽기 관문을 DI로 등록하고 handler 진입 신호를 받은 뒤 close를 호출하면 된다. 아래는 완전한 `src/adapter-probe.module.ts`다. 13장의 `src/posts/posts.module.ts`에서 정의한 `PostsModule`과 `PostsReader`만 재사용하며, 15장의 Next용 루트 모듈에는 의존하지 않는다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { PostsModule, PostsReader } from './posts/posts.module.js';

export class ProbeGate {
  readonly entered = Promise.withResolvers<void>();
  readonly release = Promise.withResolvers<void>();
}

@Inject(PostsReader, ProbeGate)
@Controller('/posts')
class ProbePostsController {
  constructor(
    private readonly posts: PostsReader,
    private readonly gate: ProbeGate,
  ) {}

  @Get('/:id')
  async show(_input: undefined, context: RequestContext) {
    this.gate.entered.resolve();
    await this.gate.release.promise;
    return this.posts.findPublished(context.request.params.id);
  }
}

@Module({
  imports: [PostsModule],
  providers: [ProbeGate],
  controllers: [ProbePostsController],
})
export class AdapterProbeModule {}
```

`ProbeGate`는 애플리케이션 테스트가 소유한 제어 도구다. production `PostsReader`에 sleep을 넣지 않고, 실제 모듈 가시성과 class-level `@Inject`를 유지하면서 요청이 진행 중인 구간만 제어한다. 테스트는 Node24와 현대적인 Promise 타입 라이브러리를 사용한다. `Promise.withResolvers()`는 시간 경과가 아니라 명시적 신호로 경쟁 순서를 고정한다.

이 예제의 기대 실패는 close가 먼저 완료되는 것이다. 아직 요청을 수락하지 않았거나 route가 404여서 빨리 끝나는 것은 같은 실패가 아니다. 반드시 `entered.promise`를 받은 다음 종료를 시작해야 테스트가 해당 회귀를 겨냥한다. 이후 구현을 바꾸어 완료 관문을 열 때까지 close가 pending인지 확인한다. 아래 완성 테스트는 그 두 구현을 구별하도록 작성되어 있으며, 원고에서 실제 red·green 실행 로그를 확보했다고 주장하지 않는다.

## 최소 계약 위에 완료 추적을 더한다

다음은 완전한 `src/hosted-http-adapter.ts`다. 모든 import는 공개 package root 또는 공개 `runtime/web` subpath에서 온다. `@fluojs/runtime/internal*`의 first-party 조립 함수를 애플리케이션에 복사하지 않는다.

```typescript
import {
  createUnsupportedHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import {
  createWebRequestResponseFactory,
  startWebRequestDispatch,
  type CreateWebRequestResponseFactoryOptions,
} from '@fluojs/runtime/web';

export type HostedAdapterOptions = Pick<
  CreateWebRequestResponseFactoryOptions,
  'maxBodySize' | 'multipart' | 'rawBody'
>;

export class HostedHttpAdapter implements HttpApplicationAdapter {
  private dispatcher?: Dispatcher;
  private closed = false;
  private closePromise?: Promise<void>;
  private readonly active = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];
  private readonly factory;

  constructor(options: HostedAdapterOptions = {}) {
    const limit = options.maxBodySize;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw Object.assign(new RangeError('Invalid request body limit'), {
        code: 'HOSTED_ADAPTER_INVALID_BODY_LIMIT',
      });
    }
    this.factory = createWebRequestResponseFactory({
      ...options,
      consumeOriginalBody: true,
    });
  }

  listen(dispatcher: Dispatcher): void {
    if (this.closed) {
      throw Object.assign(new Error('Adapter is closed'), {
        code: 'HOSTED_ADAPTER_CLOSED',
      });
    }
    if (this.dispatcher && this.dispatcher !== dispatcher) {
      throw Object.assign(new Error('Adapter already has a dispatcher'), {
        code: 'HOSTED_ADAPTER_ALREADY_BOUND',
      });
    }
    this.dispatcher = dispatcher;
  }

  readonly fetch = (request: Request): Promise<Response> => {
    const dispatcher = this.dispatcher;
    if (this.closed || dispatcher === undefined) {
      const code = this.closed
        ? 'hosted_adapter_closed'
        : 'hosted_adapter_not_ready';
      return Promise.resolve(Response.json(
        { code, status: 503, title: 'Backend unavailable' },
        {
          status: 503,
          headers: { 'content-type': 'application/problem+json' },
        },
      ));
    }

    const work = startWebRequestDispatch({
      dispatcher,
      factory: this.factory,
      request,
    });
    const tracked = work.completion.then(
      () => undefined,
      (error: unknown) => {
        this.failures.push(error);
      },
    );
    this.active.add(tracked);
    void tracked.then(() => this.active.delete(tracked));
    return work.response;
  };

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closed = true;
    this.closePromise = Promise.all([...this.active]).then(() => {
      this.dispatcher = undefined;
      if (this.failures.length > 0) {
        throw Object.assign(
          new AggregateError(this.failures, 'Request lifecycle cleanup failed'),
          { code: 'HOSTED_ADAPTER_DRAIN_FAILED' },
        );
      }
    });
    return this.closePromise;
  }

  getRealtimeCapability() {
    return createUnsupportedHttpAdapterRealtimeCapability(
      'The host exposes no raw WebSocket upgrade operation.',
    );
  }
}
```

구현에서 가장 중요한 줄은 `closed = true`가 첫 await보다 먼저 실행된다는 것이다. close가 active 집합을 복사한 다음 새 요청이 들어와 집합에 추가되는 틈이 없어야 한다. JavaScript 실행이 이 동기 구간을 마치면 이후 fetch는 503으로 끝나고, 이미 수락한 dispatch만 close의 대기 대상이 된다.

`listen()`의 정책도 이 adapter가 명시적으로 선택했다. 같은 dispatcher로 반복 연결하는 것은 멱등적이지만 live dispatcher 교체는 거절한다. 한 번 닫은 instance는 재사용하지 않는다. 이 동작이 모든 Fluo adapter의 공통 재시작 정책인 것은 아니다. Fastify, Worker, Next에서 확인한 차이가 바로 이 지점이었다. 다른 세대가 필요하면 새로운 `HostedHttpAdapter`와 application을 만든다.

`startWebRequestDispatch()`는 `response`와 `completion`을 분리한다. 스트리밍 응답을 얻기 위해 handler 전체가 끝나기를 기다리면 생산자와 소비자가 서로 기다릴 수 있다. 그래서 fetch는 `work.response`를 반환하고 close만 completion을 추적한다. `Response`가 먼저 만들어진 후 multipart iterator 정리 같은 마지막 단계가 실패할 수도 있다. 그 실패를 흘려보내지 않도록 기록하고 close에서 원래 원인들을 담은 `AggregateError`로 노출한다.

여기서 실패 기록은 고객에게 내부 오류 내용을 응답으로 복사하기 위한 것이 아니다. 응답이 commit된 뒤의 오류를 두 번째 JSON으로 덮어쓸 수도 없다. caller가 lifecycle 실패를 관찰할 수 있게 하는 경로다. 호스트는 close 실패를 로그·실패 상태에 반영해야 하며 이 예제에는 토큰이나 비밀번호를 직렬화하는 diagnostics가 없다.

바디 제한은 외부 구성 경계에서 음수가 아닌 안전한 정수로 검증한다. `0`도 유효하다. 실제 본문 읽기·multipart 제한·raw body 보존·query와 cookie 변환은 공유 factory에 맡긴다. `request.json()`과 문자열 길이 비교로 독자 파서를 추가하지 않으므로 앞 장의 바이트 보존 계약을 재사용할 수 있다.

## 두 종류의 테스트를 섞지 않는다

같은 `AdapterProbeModule`이 실제로 올바르게 연결되었는지는 먼저 application 테스트로 확인할 수 있다. 다음은 완전한 `src/adapter-probe.slice.test.ts`다. 기존 표준 데코레이터 Vitest 설정을 전제로 한다.

```typescript
import { Test } from '@fluojs/testing';
import { expect, it } from 'vitest';
import { AdapterProbeModule, ProbeGate } from './adapter-probe.module.js';

it('resolves the registered reader through the real module graph', async () => {
  const gate = new ProbeGate();
  gate.release.resolve();
  const app = await Test.createApp({
    rootModule: AdapterProbeModule,
    providers: [{ provide: ProbeGate, useValue: gate }],
  });
  try {
    const response = await app.request('GET', '/posts/1').send();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 1,
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
      version: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    });
  } finally {
    await app.close();
  }
});
```

runtime provider 입력으로 관문만 교체하고 `PostsModule`의 실제 export와 controller 주입을 통과한다. 그러나 `Test.createApp()`의 성공이 새 adapter의 성공은 아니다. 이 helper는 가상 요청을 정규화하여 dispatcher를 실행한다. Cookie 헤더의 native parsing, `Request` body의 소비, 실제 listener 종료를 자동으로 시험하지 않는다.

아래 완전한 `src/hosted-http-adapter.test.ts`는 그래서 adapter 자체를 별도로 사용한다. 같은 application을 생성하되 공개 fetch 경계로 들어간다.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { AdapterProbeModule, ProbeGate } from './adapter-probe.module.js';
import { HostedHttpAdapter } from './hosted-http-adapter.js';

it('rejects new ingress while draining the accepted request', async () => {
  const adapter = new HostedHttpAdapter();
  const app = await FluoFactory.create(AdapterProbeModule, { adapter });
  const gate = await app.get(ProbeGate);
  let request: Promise<Response> | undefined;
  let closing: Promise<void> | undefined;

  try {
    const before = await adapter.fetch(new Request('http://probe.test/posts/1'));
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({
      code: 'hosted_adapter_not_ready',
      status: 503,
      title: 'Backend unavailable',
    });

    await app.listen();
    request = adapter.fetch(new Request('http://probe.test/posts/1'));
    await gate.entered.promise;

    let closeSettled = false;
    closing = adapter.close();
    const observedClose = closing.then(() => { closeSettled = true; });
    expect(adapter.close()).toBe(closing);
    const blocked = await adapter.fetch(new Request('http://probe.test/posts/1'));
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get('content-type')).toBe('application/problem+json');
    expect(await blocked.json()).toEqual({
      code: 'hosted_adapter_closed',
      status: 503,
      title: 'Backend unavailable',
    });
    expect(closeSettled).toBe(false);

    gate.release.resolve();
    const response = await request;
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')?.split(';')[0])
      .toBe('application/json');
    expect(await response.json()).toEqual({
      id: 1,
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
      version: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    });
    await observedClose;
    expect(closeSettled).toBe(true);
    expect(() => adapter.listen(app.dispatcher)).toThrow('Adapter is closed');
  } finally {
    gate.release.resolve();
    if (request) {
      const response = await request;
      if (!response.bodyUsed) {
        await response.body?.cancel();
      }
    }
    if (closing) {
      await closing;
    }
    await app.close();
  }
});
```

수락된 요청과 차단된 요청을 동시에 관찰해야 한다. close 전에 들어온 요청은 여전히 200과 올바른 게시글을 반환하고, close 이후 요청은 503이며, 관문이 닫혀 있는 동안 close가 완료되지 않는다. 실패한 테스트에서도 관문을 해제하는 `finally`가 있어야 다음 테스트가 진행 중인 작업을 물려받지 않는다. 이 파일에서는 adapter의 종료 동기 구간을 직접 시험하기 위해 `adapter.close()`를 먼저 호출하고 마지막에 application 자원을 정리한다. 일반 애플리케이션은 `app.close()`를 사용한다.

테스트 runner의 유한 timeout은 실패 시 테스트를 끝내기 위한 상한이다. 정상 동작을 만들기 위한 sleep은 아니다. 실제 handler가 영원히 완료되지 않으면 이 adapter의 drain도 끝나지 않는다. 네트워크 호스트가 요구하는 강제 종료 시한과 연결 abort는 호스트 책임이며, 이 무리스너 adapter가 소유하지 않는 소켓을 강제로 닫았다고 보고하지 않는다.

## 공유 하니스로 자신이 빠뜨린 입력을 찾는다

제품 사례 하나를 통과했다고 query 배열, malformed cookie, 독립적인 `Set-Cookie`, `HEAD`, byte range까지 맞는 것은 아니다. adapter 작성자는 자신이 떠올린 예제만 검사하기 쉽다. `@fluojs/testing/web-runtime-adapter-portability`는 이런 공통 입력·출력 계약을 같은 fixture로 검사하는 공개 subpath다.

다음은 완전한 `src/hosted-http-adapter.portability.test.ts`다. 이 파일의 모듈은 하니스가 생성하므로 게시글 실험의 관문에 의존하지 않는다. Web adapter의 설정과 일반 runtime 옵션을 구분하고, 하니스의 `cors: false`는 이 실험에서 CORS를 설치하지 않는다는 의미로 소비한다. 존재하지 않는 `assertAll()`이나 비공개 fixture를 호출하지 않는다.

```typescript
import { FluoFactory, type CreateApplicationOptions } from '@fluojs/runtime';
import { WebRuntimeHttpAdapterPortabilityHarness } from '@fluojs/testing/web-runtime-adapter-portability';
import { it } from 'vitest';
import {
  HostedHttpAdapter,
  type HostedAdapterOptions,
} from './hosted-http-adapter.js';

type BootstrapOptions =
  Omit<CreateApplicationOptions, 'adapter'> &
  HostedAdapterOptions &
  { cors?: false };

const portability = WebRuntimeHttpAdapterPortabilityHarness.create<BootstrapOptions>({
  name: 'Book hosted adapter',
  createConditionalRequestBootstrapOptions: (options) => options,
  createErrorRepresentationBootstrapOptions: (options) => options,
  async bootstrap(rootModule, {
    maxBodySize,
    multipart,
    rawBody,
    cors: _cors,
    ...runtimeOptions
  }) {
    const adapter = new HostedHttpAdapter({ maxBodySize, multipart, rawBody });
    const app = await FluoFactory.create(rootModule, {
      ...runtimeOptions,
      adapter,
    });
    try {
      await app.listen();
    } catch (error: unknown) {
      try {
        await app.close();
      } catch (cleanupError: unknown) {
        throw new AggregateError([error, cleanupError], 'Startup and cleanup failed');
      }
      throw error;
    }
    return {
      close: () => app.close(),
      dispatch: adapter.fetch,
    };
  },
});

it('preserves decoded query arrays', () =>
  portability.assertPreservesQueryArraysAndDecoding());
it('preserves malformed cookie values', () =>
  portability.assertPreservesMalformedCookieValues());
it('preserves independent response cookies', () =>
  portability.assertSupportsPortableResponseCookies());
it('preserves JSON and text raw bodies', () =>
  portability.assertPreservesRawBodyForJsonAndText());
it('preserves byte-sensitive payloads', () =>
  portability.assertPreservesExactRawBodyBytesForByteSensitivePayloads());
it('excludes raw bodies from multipart requests', () =>
  portability.assertExcludesRawBodyForMultipart());
it('preserves body-bearing extension methods', () =>
  portability.assertSupportsCustomHttpRouteMethods());
it('preserves SSE framing', () =>
  portability.assertSupportsSseStreaming());
it('preserves single byte ranges', () =>
  portability.assertSupportsSingleByteRanges());
it('preserves conditional responses', () =>
  portability.assertSupportsConditionalRequests());
it('preserves negotiated error representations', () =>
  portability.assertSupportsHttpErrorRepresentations());
it('does not commit error representations after abort', () =>
  portability.assertDoesNotCommitAbortedHttpErrorRepresentations());
```

bootstrap callback에서 `listen()`이 실패한 경우의 cleanup을 직접 작성한 이유는 하니스가 아직 반환받지 못한 application을 정리할 수 없기 때문이다. startup 실패와 cleanup 실패가 함께 발생하면 두 원인을 보존한다. application을 반환한 뒤 assertion과 close가 실패하는 경우에는 하니스의 cleanup 계약이 동작한다. 실패한 테스트를 녹색으로 만들려고 close 오류를 무시하면 자원 소유권 검증 자체를 지운 셈이다.

JSON과 text의 raw body 테스트에 더해 byte-sensitive 테스트를 별도로 호출한다. 문자열로 decode했다가 encode하는 구현은 평범한 JSON에서는 통과해도 모든 바이트를 보존하지 못할 수 있다. 응답 cookie 검사도 쉼표로 합친 문자열이 아니라 독립 필드를 보존하는지 확인한다. SSE에서는 event-stream media type과 framing이 대상이며, 최종 소비자의 네트워크 backpressure 성능을 대신 측정하지 않는다.

conditional response와 byte range도 공유 dispatcher의 정책이다. adapter의 “도움이 되는” 직렬화가 body 없는 304·416·HEAD에 본문을 붙이거나 바이너리 범위를 문자열 기준으로 잘라서는 안 된다. 위 설정 builder는 fixture가 요구하는 runtime 옵션을 그대로 전달한다. adapter 옵션만 남기고 나머지를 버리면 이 검사를 실행하는 것처럼 보이지만 정책을 구성하지 않은 다른 애플리케이션을 시험한다.

## 적합성 하니스의 이름보다 소유 계약을 먼저 고른다

`HttpApplicationAdapter`와 `PlatformComponent`는 같은 타입이 아니다. HTTP adapter는 `listen(dispatcher)`와 `close()`를 구현하여 요청 경계를 연결한다. `platform.components`에 등록되는 persistence 같은 component에는 validate, start, stop, snapshot 등 다른 수명주기가 있다. HTTP adapter를 그 목록에 억지로 넣어 generic conformance를 통과시키는 것은 올바른 등록이 아니다.

실제 Node 리스너를 소유하는 어댑터를 만든다면 `HttpAdapterPortabilityHarness.create()`로 listener URL, TLS, signal listener 정리와 stream drain 같은 소유 기능을 검증한다. 이 장처럼 이미 Web request를 받는 호스트 접점은 Web portability 하니스와 실제 호스트의 별도 통합 테스트를 사용한다. Next가 거부하는 메서드를 Next 밖의 함수 테스트만으로 지원한다고 주장해서는 안 되었던 것과 같은 원칙이다.

PlatformComponent를 새로 만든 경우에는 `PlatformConformanceHarness.create()`가 맞고, PlatformShell의 start/stop overlap을 변경한 경우에는 별도의 shell lifecycle 하니스가 필요하다. 역할을 구분하면 검사량을 줄이기 위한 구실이 아니라 빠뜨린 소유권을 찾는 도구가 된다. WebSocket을 지원하지 않는 이 adapter는 unsupported capability를 정직하게 반환한다. `getServer()`를 가짜 객체로 채워 protocol package가 upgrade를 시도하게 만들지 않는다.

요청 재현 도구가 실제 사용 표면이므로 거기서도 본문을 읽고, 취소하고, application을 닫는 순서를 시험해야 한다. GET 성공 뒤 바로 프로세스를 종료하는 데모는 drain과 정리의 증거가 아니다. 호스트가 abort한 뒤 오류 표현 provider가 늦게 완료되는 사례에서는 이미 취소된 요청에 HTML이나 canonical JSON이 새로 commit되지 않는지 확인한다. DB rollback이나 결제 중복 방지는 이 adapter 검사 밖이며 원래 기능 모듈의 테스트를 계속 유지한다.

## 패키지로 만들기 전에 남겨야 할 결론

새 adapter의 가치는 새로운 이름이나 계층의 수가 아니다. 원래 호스트가 제공한 `Request`와 기존 Fluo 모듈 사이에서 필요한 차이만 구현하고, 바디·라우팅·오류 정책은 공유 구현에 남긴 데 있다. 이 장의 구현은 소켓 없는 terminal host-owned 경계이며, 재시작과 강제 종료, 응답 body의 transport drain을 제공한다고 주장하지 않는다. 이런 기능이 필요한 제품에는 이미 검증된 공식 adapter가 더 작은 선택일 수 있다.

본문 코드의 검증 순서는 모듈 wiring, adapter의 실제 fetch와 close 경합, Web portability, 실제 재현 호스트 사용이다. 앞 단계가 뒤 단계의 결과를 대신하지 않는다. 이 장의 예제를 프로젝트에 추출했다면 기존 Vitest 구성에서 세 테스트 파일을 명시적으로 실행하고 실패 원인과 실행 환경을 남긴다. 원고 작성에서는 전체 governance·build suite를 다시 돌리거나 예제를 실행했다고 꾸미지 않는다.

이제 확장의 경계를 하나 완성했다. 다음 장에서는 이런 코드를 다른 팀도 쓸 수 있는 패키지로 옮길 때 공개 export, peer dependency, 등록 방식과 문서 계약을 어떻게 유지하는지 다룬다. 재사용을 시작하는 시점은 일반화할 이름을 찾았을 때가 아니라 실제 소유권과 실패 조건을 설명할 수 있을 때다.

## 근거와 재현 범위

- [runtime README](../../packages/runtime/README.ko.md), [공개 root export](../../packages/runtime/src/index.ts), [공개 Web subpath](../../packages/runtime/package.json), [Web factory·두 완료 신호](../../packages/runtime/src/web.ts).
- [runtime bootstrap](../../packages/runtime/src/bootstrap.ts), [Application과 생성 옵션](../../packages/runtime/src/types.ts), [HttpApplicationAdapter의 실제 계약](../../packages/http/src/adapter.ts).
- [testing README](../../packages/testing/README.ko.md), [공개 root export](../../packages/testing/src/index.ts), [request helper의 가상 입력·응답](../../packages/testing/src/http.ts), [Web portability 하니스](../../packages/testing/src/portability/web-runtime-adapter-portability.ts).
- [Web runtime portability 회귀 테스트](../../packages/testing/src/portability/web-runtime-adapter-portability.test.ts), [factory dispatch와 multipart 정리 구현](../../packages/runtime/src/adapters/request-response-factory.ts), [플랫폼 적합성 작성 계약](../../docs/contracts/platform-conformance-authoring-checklist.ko.md).

본문은 완전한 구현 파일과 테스트 파일을 제시하지만 새 adapter의 실행 통과 보고서는 아니다. 네트워크 listener·TLS·호스트 종료·실제 결제나 외부 전송을 검증했다는 주장은 하지 않는다.

[이전: Next.js 안에서 Fluo 실행하기](./ch15-nextjs-hosting.ko.md) · [목차](./toc.ko.md) · [다음: 재사용 가능한 Fluo 확장 패키지 만들기](./ch17-extension-package.ko.md)
