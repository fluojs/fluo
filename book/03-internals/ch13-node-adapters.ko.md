# Node.js 어댑터 비교하기

<!-- book:volume=03-internals;chapter=13 -->

[이전: 요청이 끝나기 전에 연결이 끊긴다면](./ch12-cancellation-and-streaming.ko.md) · [목차](./toc.ko.md) · [다음: Fetch 기반 런타임으로 이동하기](./ch14-fetch-adapters.ko.md)

## 바꾸려는 것은 주문 규칙이 아니라 HTTP 입구다

FluoBlog의 독자가 티셔츠를 사기 시작한 뒤에도 게시글 발행과 사용자 계정은 같은 애플리케이션에 남아 있다. 2권에서 추가한 주문·재고 모듈도 갑자기 다른 서비스로 바뀌지 않았다. 이번 운영 회의의 질문은 더 좁다. “기존 Express 미들웨어를 잠시 유지하면서 FluoShop을 운영할 수 있을까? Fastify 대신 Node.js 내장 서버를 쓰면 문제를 더 쉽게 추적할 수 있을까?” 어댑터를 바꾸는 이유는 이런 구체적인 호스트 요구여야 한다. 패키지 이름이 짧다거나 벤치마크 숫자가 크다는 이유만으로 주문 처리 경로까지 고치는 것은 비교가 아니다.

앞 장에서는 응답을 반환했다는 사실과 연결·스트림이 끝났다는 사실을 구분했다. 이번 장에서는 그 경계를 누가 구현하는지 확인한다. Node.js 어댑터 셋은 모두 Node HTTP 또는 HTTPS 리스너를 소유하지만 요청 파싱, 라우팅 사전 선택, 네이티브 미들웨어와 종료 처리의 조립 방법은 다르다. 공통점은 최종적으로 같은 Fluo dispatcher에 도착한다는 것이다. `OrdersModule`의 상태 전이나 `InventoryModule`의 예약 규칙은 이 dispatcher 뒤의 애플리케이션 책임이다.

실행 기준은 Node24와 pnpm10이다. 세 패키지의 지원 범위는 모두 Node.js `>=24.0.0 <27`이다. 표준 데코레이터를 변환하는 기존 Fluo 빌드 구성을 사용하고 `experimentalDecorators`나 `emitDecoratorMetadata`를 켜지 않는다. 어댑터 교체는 TypeScript의 설계 타입 메타데이터를 DI 등록으로 바꾸어 주지 않는다.

이 장의 코드는 독자가 만든 `fluo-blog`에서 별도로 실행하는 작은 운송 계층 실험이다. 완성된 상점 저장소의 스냅샷이 아니다. 실제 PostgreSQL 저장소, 인증, 웹훅 서명 검증을 아래의 메모리 값으로 교체해 배포하지 않는다. 특히 `examples/fluo-blog`는 초기 HTTP·DI 근거이지 이 장의 상점 체크포인트가 아니다.

## 제품의 관찰 가능한 계약을 먼저 고정한다

비교 대상으로 `/posts/1`의 발행된 글과 `/payments/webhooks`에 도착하는 원본 바이트를 선택하자. 전자는 독자의 기존 링크가 유지되는지를, 후자는 상점을 추가하면서 생긴 바이트 민감한 입력이 유지되는지를 확인한다. 주문을 실제로 생성하거나 결제사에 연결할 필요가 없다. 응답 시간보다 먼저 같은 요청이 같은 의미로 처리되는지 증명해야 한다.

다음은 실험용 `src/posts/posts.module.ts`의 완전한 파일이다. `PostsReader`는 이 장에서 정의하는 읽기 모델이며 Fluo가 제공하는 저장소가 아니다. `id=1`은 첫 실습의 게시글을 발행한 상태다. 내부 레코드에는 작성자와 발행 상태를 보존하되 공개 응답에는 필요한 필드만 담는다.

```typescript
import { Module } from '@fluojs/core';
import { NotFoundException } from '@fluojs/http';

interface PostRecord {
  id: number;
  authorId: string;
  title: string;
  content: string;
  slug: string;
  status: 'draft' | 'published';
  version: number;
  publishedAt: string | null;
}

export interface PublicPost {
  id: number;
  title: string;
  content: string;
  slug: string;
  version: number;
  publishedAt: string;
}

export class PostsReader {
  private readonly post: PostRecord = {
    id: 1,
    authorId: 'user-1',
    title: 'Hello, Fluo!',
    content: 'My first post.',
    slug: 'hello-fluo',
    status: 'published',
    version: 2,
    publishedAt: '2026-09-01T00:00:00.000Z',
  };

  findPublished(id: string): PublicPost {
    const post = this.post;
    if (
      id !== String(post.id) ||
      post.status !== 'published' ||
      post.publishedAt === null
    ) {
      throw new NotFoundException('Post not found');
    }
    return {
      id: post.id,
      title: post.title,
      content: post.content,
      slug: post.slug,
      version: post.version,
      publishedAt: post.publishedAt,
    };
  }
}

@Module({ providers: [PostsReader], exports: [PostsReader] })
export class PostsModule {}
```

`PostsModule`은 provider를 등록하고 밖으로 내보낸다. 다음 `src/app.ts`는 이 실험의 완전한 루트 모듈이다. `@Inject(PostsReader)`는 생성자 인자의 실제 토큰을 지정한다. 생성자 타입 표기만 남겨 두면 모듈 가시성과 토큰 해석을 시험하지 못한다.

```typescript
import { Inject, Module } from '@fluojs/core';
import {
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  type RequestContext,
} from '@fluojs/http';
import { PostsModule, PostsReader } from './posts/posts.module.js';

@Inject(PostsReader)
@Controller('/posts')
class PostsController {
  constructor(private readonly posts: PostsReader) {}

  @Get('/:id')
  show(_input: undefined, context: RequestContext) {
    return this.posts.findPublished(context.request.params.id);
  }
}

@Controller('/payments')
class WebhookBytesController {
  @Post('/webhooks')
  @HttpCode(200)
  receive(_input: undefined, context: RequestContext) {
    const bytes = context.request.rawBody;
    if (bytes === undefined) {
      throw new InternalServerErrorException('Raw body capture is required');
    }
    return {
      mode: 'dry-run',
      byteLength: bytes.byteLength,
      bytes: Array.from(bytes),
    };
  }
}

@Module({
  imports: [PostsModule],
  controllers: [PostsController, WebhookBytesController],
})
export class AppModule {}
```

바이트 컨트롤러는 결제 웹훅 구현이 아니라 전송 경계의 계측기다. 정상 운영의 `PaymentsModule`이 소유하는 서명·중복·주문 전이 코드를 흉내 내지 않는다. 입력을 결제 성공으로 신뢰하지도 않는다. 여기서 `rawBody`가 없으면 빈 배열로 덮지 않고 명시적으로 실패시킨다. 그렇지 않으면 어댑터 설정을 빠뜨렸는데도 “수신 성공”이라는 녹색 결과를 얻게 된다.

공백과 줄바꿈을 포함한 JSON의 파싱 결과는 공백이 없는 JSON과 같을 수 있다. 그러나 서명 대상 바이트는 다르다. `JSON.stringify(context.request.body)`를 원문 복원으로 사용하면 이 차이가 사라진다. `rawBody: true`는 원문 보존 옵션이지 서명 검증이나 멱등성 저장소가 아니다. 이 두 책임은 계속 애플리케이션에 있다.

## 같은 모듈을 세 리스너에 연결한다

처음에는 Fastify 실행 파일 하나로 충분하다. 다음 `src/main.ts`는 위 실험 모듈의 완전한 실행 파일이다.

```typescript
import { runFastifyApplication } from '@fluojs/platform-fastify';
import { AppModule } from './app.js';

export const app = await runFastifyApplication(AppModule, {
  host: '127.0.0.1',
  port: 3000,
  rawBody: true,
  maxBodySize: 256,
  shutdownSignals: ['SIGINT', 'SIGTERM'],
});
```

256바이트 제한은 실패를 쉽게 재현하기 위한 실험값이다. 본문을 포함하는 실제 게시글 작성 API의 운영 제한으로 권하지 않는다. `runFastifyApplication()`이 반환되면 이미 listening과 shutdown registration이 끝난 상태다. 뒤에 `app.listen()`을 다시 붙일 이유가 없다. 반대로 `bootstrapFastifyApplication()`은 리스너를 시작하지 않으므로 호스트가 별도로 `listen()`을 호출한다.

세 어댑터를 비교할 때는 신호 처리보다 요청·응답을 관찰하는 작은 프로그램이 낫다. 다음은 완전한 `src/adapter-probe.ts`다. 세 adapter package를 애플리케이션의 직접 의존성으로 설치하고 기존 표준 데코레이터 빌드 경로로 이 파일과 앞의 두 파일을 함께 변환한다. 출력 위치가 `dist`인 구성에서는 `node dist/adapter-probe.js`로 실행한다.

```typescript
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { createNodejsAdapter } from '@fluojs/platform-nodejs';
import { createExpressAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

const options = {
  host: '127.0.0.1',
  port: 0,
  rawBody: true,
  maxBodySize: 256,
};

const factories = [
  ['fastify', () => createFastifyAdapter(options)],
  ['nodejs', () => createNodejsAdapter(options)],
  ['express', () => createExpressAdapter(options)],
] as const;

for (const [name, createAdapter] of factories) {
  const adapter = createAdapter();
  const app = await FluoFactory.create(AppModule, { adapter });
  try {
    await app.listen();
    const server = adapter.getServer?.();
    assert.ok(server instanceof Server);
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;

    for (const path of ['/posts/1', '/posts//1/']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get('content-type')?.split(';')[0],
        'application/json',
      );
      assert.deepEqual(await response.json(), {
        id: 1,
        title: 'Hello, Fluo!',
        content: 'My first post.',
        slug: 'hello-fluo',
        version: 2,
        publishedAt: '2026-09-01T00:00:00.000Z',
      });
    }

    const missing = await fetch(`${base}/posts/999`);
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();

    const body = '{ "id": "evt-1", "type": "payment.succeeded" }\r\n';
    const receipt = await fetch(`${base}/payments/webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(receipt.status, 200);
    assert.equal(
      receipt.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    const bytes = new TextEncoder().encode(body);
    assert.deepEqual(await receipt.json(), {
      mode: 'dry-run',
      byteLength: bytes.byteLength,
      bytes: Array.from(bytes),
    });

    for (const [body, status] of [['{', 400], ['x'.repeat(257), 413]] as const) {
      const failure = await fetch(`${base}/payments/webhooks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      assert.equal(failure.status, status);
      await failure.arrayBuffer();
    }
    console.log(`${name}: transport assertions passed`);
  } finally {
    await app.close();
  }
}
```

`port: 0`은 운영체제가 빈 포트를 고르게 한다. 테스트 시작 전에 빈 포트를 찾아 놓았다가 나중에 bind하는 경쟁 조건을 만들지 않는다. 주소를 읽는 곳만 Node의 `Server`에 의존하고 컨트롤러에는 그 타입을 전달하지 않는다. 각 응답의 본문을 소비하는 것도 중요하다. 검증 프로그램이 자기 keep-alive 연결을 남겨 종료 실험을 왜곡하지 않도록 한다.

예상 결과는 어댑터마다 정상 JSON, 404, 바이트가 정확히 일치하는 영수증, 잘못된 JSON의 400, 초과 입력의 413을 얻는 것이다. 이 원고 작성에서 위 프로그램을 실행했다는 뜻은 아니다. 실패하면 먼저 실제 status와 Content-Type, 본문을 함께 기록하고, 속도 비교는 중단한다. 전송 계약이 다른 두 결과의 처리량을 비교하면 잘못된 최적화를 선택하기 쉽다.

## 네이티브 라우팅은 dispatcher를 우회하는 지름길이 아니다

Fastify와 Express 소스는 안전하게 옮길 수 있는 라우트에 네이티브 핸들러를 미리 등록한다. `/posts/:id`처럼 의미가 보존되는 경로에서는 호스트가 선택한 descriptor와 params를 dispatcher에 넘겨 중복 매칭을 줄인다. 그 뒤에도 module middleware, guard, interceptor, observer와 오류 응답은 Fluo 경로에 남는다. 네이티브 등록을 “컨트롤러 직접 호출”로 설명하면 request scope와 종료 책임을 놓치게 된다.

`/:id`와 `/:slug`처럼 정규화된 모양이 같은 경로, `@All`, URI 이외의 버전 선택, 정규화에 민감한 요청은 fallback이 필요하다. 앞 실험의 `/posts//1/`는 정상 경로와 의미가 같아야 하지만 네이티브 엔진이 동일한 결정을 한다고 가정할 수 없다. middleware가 framework request의 method나 path를 변경하면 이전 handoff도 무효가 된다. dispatcher는 수정된 요청을 다시 매칭한다.

따라서 운영자가 “주문 상세가 빠르지 않다”며 모든 경로를 네이티브 등록으로 강제하는 것은 올바른 수정이 아니다. 먼저 native handoff가 가능한 경로인지, fallback이 계약을 지키는 비용인지 확인해야 한다. `QUERY`, `PURGE` 같은 검증된 확장 메서드도 wildcard 경로로 전달된다. 일반 controller routing의 범위 밖인 `CONNECT`까지 지원한다고 확대 해석하지 않는다.

## Express 자산을 옮길 때 드러나는 소유권

기존 Express 코드에서 요청 태그만 유지해야 한다면 다음은 `src/main.ts`에서 adapter 생성 부분을 대체하는 애플리케이션 조각이다. `AppModule`은 앞 파일, `FluoFactory`는 runtime의 공개 factory다. 아래 `RequestHandler`를 사용하는 프로젝트는 `express`와 해당 타입 의존성을 직접 관리한다.

```typescript
import type { RequestHandler } from 'express';
import { createExpressAdapter } from '@fluojs/platform-express';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

const legacyTag: RequestHandler = (_request, response, next) => {
  response.setHeader('x-migration-host', 'express');
  next();
};

export const app = await FluoFactory.create(AppModule, {
  adapter: createExpressAdapter({
    host: '127.0.0.1',
    port: 3000,
    rawBody: true,
    nativeMiddleware: [legacyTag],
  }),
});
await app.listen();
```

이 경로의 종료는 호출자가 `app.close()`로 소유한다. `nativeMiddleware`는 생성 시점에 고정되고 Fluo dispatch 앞에서 실행된다. `next()`를 호출하면 Fluo로 이어지지만 네이티브 응답을 끝내면 guard와 controller를 포함한 뒷부분이 실행되지 않는다. `next(error)`나 네이티브 예외는 Express 오류 체인에 남는다. Fluo exception filter가 앞단의 오류까지 통일한다고 생각하면 장애 응답 형식이 두 종류가 된다.

태그처럼 이식 가능한 처리는 최종적으로 Fluo `Middleware`의 `handle(context, next)`로 옮기는 편이 낫다. 반면 꼭 유지해야 하는 Express 전용 라이브러리는 이 좁은 경계에 남길 수 있다. 이미 실행 중인 Express 애플리케이션을 adapter가 채택하거나 bootstrap 후 `use()`로 수정하는 모델은 지원하지 않는다. 네이티브 middleware가 만든 타이머나 클라이언트도 adapter가 찾아서 정리하지 않는다.

Fastify는 같은 요구에 `configureFastify`라는 생성 시점 접점을 제공한다. 설정은 Fluo의 플러그인·라우트 등록 전에 완료되어야 하고 실패하면 listening이 시작되지 않는다. 이 접점으로 네이티브 route를 따로 만들어 인증을 우회해서는 안 된다. 또한 `context.request.raw`는 Node `IncomingMessage`지만 `context.response.raw`는 `FastifyReply`다. 둘 다 Node 원시 객체일 것이라고 cast하는 코드는 어댑터 하나 안에서도 틀린다.

## 종료 실패까지 비교해야 운영 선택이 된다

모든 `close()`가 같은 구현은 아니다. Fastify는 close 진행 중의 `listen()`을 종료 뒤로 연결하지만 Express는 그 시점의 `listen()`을 거절한다. Express와 raw Node의 connection drain 제한과 Fastify의 close 대기 제한도 같은 강제 종료 보장으로 읽으면 안 된다. Fastify의 대기 timeout 뒤에도 기반 close가 진행될 수 있다. `shutdownTimeoutMs: 0`이 유효하다는 사실은 요청이 안전하게 완료된다는 뜻이 아니다.

포트를 다른 서버가 점유한 상태에서 시작한 뒤 `close()`를 호출하는 실패 실험도 의미가 있다. 기대해야 할 것은 “언젠가 시작됨”이 아니라 진행 중인 retry가 취소·정리되어, close가 끝난 뒤 포트를 비워도 닫은 adapter가 뒤늦게 bind하지 않는 것이다. 패키지의 lifecycle 테스트는 이 순서를 관찰한다. 제품 테스트에서는 느린 handler에 진입했다는 신호를 받은 후 종료를 시작하고 작업 완료 신호를 직접 해제한다. 임의의 100밀리초 대기로 경합을 만들면 부하가 큰 CI에서 다른 경로를 시험하게 된다.

시그널 helper의 `forceExitTimeoutMs`는 adapter connection drain 제한과 별개다. Node 계열 run helper는 시그널 종료 실패나 timeout을 로그와 `process.exitCode`로 알리지만 최종 프로세스 종료는 호스트에 맡긴다. 열린 다른 자원이 있으면 exit code를 설정했다고 곧바로 프로세스가 끝나지 않는다. 실험 프로그램의 수동 `finally`와 운영 프로세스의 signal 경로를 분리해 검증해야 하는 이유다.

새로운 요구가 없다면 기존 Fastify를 유지하는 것도 올바른 결론이다. Express는 남겨야 할 네이티브 자산의 비용을 줄이고, raw Node는 중간 HTTP 엔진을 줄이면서 Node 서버 옵션을 직접 선택하게 한다. 어느 쪽도 데이터베이스 트랜잭션이나 인증을 대신하지 않는다. README의 특정 `/health` 성능 수치를 주문 조회의 성능 보장으로 가져오지 말고 실제 payload와 동시성, 오류율, 종료 시간을 나중에 함께 측정하자.

이제 남은 질문은 Node 엔진 세 개 중 무엇을 고를지가 아니다. 리스너 자체를 Bun이나 Deno에 맡기거나, 리스너를 만들 수 없는 Worker 안으로 이동하면 어떤 책임이 달라질까? 다음 장에서는 방금 고정한 글과 바이트 계약은 그대로 두고 `Request`와 `Response`를 중심으로 경계를 바꾼다.

## 근거와 재현 범위

- [Fastify README](../../packages/platform-fastify/README.ko.md), [공개 export](../../packages/platform-fastify/src/index.ts), [adapter 구현](../../packages/platform-fastify/src/adapter.ts), [라우팅·파싱·종료 회귀 테스트](../../packages/platform-fastify/src/adapter.test.ts).
- [Node.js README](../../packages/platform-nodejs/README.ko.md), [공개 별칭과 export](../../packages/platform-nodejs/src/index.ts), [Node 구현](../../packages/platform-nodejs/src/node/internal-node.ts), [lifecycle 통합 테스트](../../packages/platform-nodejs/src/lifecycle.integration.test.ts).
- [Express README](../../packages/platform-express/README.ko.md), [공개 export](../../packages/platform-express/src/index.ts), [adapter 구현](../../packages/platform-express/src/adapter.ts), [네이티브 middleware·fallback 테스트](../../packages/platform-express/src/adapter.test.ts).

이 장의 예상 결과는 위 공개 계약과 소스에서 도출했다. 본문 실험의 실행 로그나 성능 측정 결과를 새로 확보한 것으로 주장하지 않는다.

[이전: 요청이 끝나기 전에 연결이 끊긴다면](./ch12-cancellation-and-streaming.ko.md) · [목차](./toc.ko.md) · [다음: Fetch 기반 런타임으로 이동하기](./ch14-fetch-adapters.ko.md)
