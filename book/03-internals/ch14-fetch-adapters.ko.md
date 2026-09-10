# Fetch 기반 런타임으로 이동하기

<!-- book:volume=03-internals;chapter=14 -->

[이전: Node.js 어댑터 비교하기](./ch13-node-adapters.ko.md) · [목차](./toc.ko.md) · [다음: Next.js 안에서 Fluo 실행하기](./ch15-nextjs-hosting.ko.md)

## 공개 상품을 가까이 보내도 주문의 권위는 옮겨지지 않는다

해외 독자가 FluoBlog 글 끝의 티셔츠 링크를 연다. 상품 설명은 거의 바뀌지 않는데 첫 화면을 기다리는 시간이 길다. 운영자는 공개 글과 상품 조회를 다른 런타임에서도 제공할 수 있는지 알아보고 싶다. 그렇다고 `AccountsModule`을 다시 만들거나 `OrdersModule`의 재고·가격 판단을 엣지 캐시로 옮기지는 않는다. 2권의 같은 사용자 ID, KRW 정수 금액, 주문 시점 스냅샷은 그대로다. 이번 실험이 성공해도 곧바로 전체 애플리케이션을 분리 배포해야 한다는 결론은 나오지 않는다.

앞 장에서는 같은 모듈을 Node 리스너 셋에 연결했다. 이번에는 네이티브 요청의 모양이 `IncomingMessage`에서 Web `Request`로 바뀐다. 응답도 `ServerResponse`에 쓰는 대신 `Response`를 반환한다. Bun과 Deno는 이 함수를 네트워크 리스너에 연결할 수 있고, Cloudflare Workers에서는 호스트가 이미 리스너를 소유한다. 공통 Web API는 입력·출력의 공통 언어이지 프로세스와 종료의 공통 모델은 아니다.

코드는 13장에서 정의한 실험용 `src/app.ts`의 `AppModule`과 `src/posts/posts.module.ts`를 사용한다. `/posts/1`과 원본 바이트만 반환하는 `/payments/webhooks`를 그대로 유지한다. 실제 결제 처리는 하지 않는다. 이 읽기·파싱 실험과 PostgreSQL·Prisma 연결의 런타임 호환성은 별도 문제다. Node filesystem, TCP 클라이언트, 프로세스 신호를 사용하는 provider가 있다면 그 의존성부터 조사해야 하며 어댑터 변경만으로 이식된 것으로 취급하지 않는다.

## 먼저 바디 소비자를 하나로 만든다

이식 중 가장 이해하기 쉬운 실패는 바디가 사라지는 것이다. 호스트에서 로그를 남긴다고 `await request.json()`을 호출한 뒤 같은 `Request`를 Fluo에 넘기면 파서가 읽어야 할 스트림을 앞에서 소비한다. 다시 JSON으로 인코딩해 넘겨도 원래 공백·줄바꿈·바이트열은 복구되지 않는다. 블로그 JSON에는 문제가 없어 보여도 2권의 웹훅 서명 경계에서는 다른 요청이다.

`@fluojs/runtime/web`의 request/response factory는 parsing 설정을 가진다. 실제 dispatcher에 전달할 framework request를 만들고 필요한 시점에 제한된 바디 읽기를 수행한다. Bun의 `createBunFetchHandler()`는 이 factory를 `consumeOriginalBody: true`로 만들고, Deno의 `createDenoFetchHandler()`도 공유 factory와 `dispatchWebRequest()`에 위임한다. 애플리케이션이 이 내부 차이를 덮으려고 두 번 파싱할 필요는 없다.

공개 `Application`에서 dispatcher를 얻는 필드는 `app.dispatcher`다. 아래 코드는 완전한 `src/fetch-probe.ts`이며 서버를 열지 않고 Bun·Deno의 공개 Fetch 접점을 비교한다. Node24의 Web API를 사용하는 계약 실험이므로 Bun이나 Deno의 네이티브 서버를 실행한 증거는 아니다. `createNoopHttpApplicationAdapter()`는 오직 이 무리스너 실험의 명시적 선택이다.

```typescript
import assert from 'node:assert/strict';
import { createNoopHttpApplicationAdapter } from '@fluojs/http';
import { createBunFetchHandler } from '@fluojs/platform-bun';
import { createDenoFetchHandler } from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

const app = await FluoFactory.create(AppModule, {
  adapter: createNoopHttpApplicationAdapter(),
});

try {
  const options = {
    dispatcher: app.dispatcher,
    maxBodySize: 256,
    rawBody: true,
  };
  const handlers = [
    ['bun', createBunFetchHandler(options)],
    ['deno', createDenoFetchHandler(options)],
  ] as const;

  for (const [name, handle] of handlers) {
    const post = await handle(new Request('https://probe.test/posts/1'));
    assert.equal(post.status, 200);
    assert.equal(
      post.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    assert.deepEqual(await post.json(), {
      id: 1,
      title: 'Hello, Fluo!',
      content: 'My first post.',
      slug: 'hello-fluo',
      version: 2,
      publishedAt: '2026-09-01T00:00:00.000Z',
    });

    const bytes = new TextEncoder().encode('{ "id": "evt-1" }\r\n');
    const receipt = await handle(new Request('https://probe.test/payments/webhooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bytes,
    }));
    assert.equal(receipt.status, 200);
    assert.equal(
      receipt.headers.get('content-type')?.split(';')[0],
      'application/json',
    );
    assert.deepEqual(await receipt.json(), {
      mode: 'dry-run',
      byteLength: bytes.byteLength,
      bytes: Array.from(bytes),
    });
    console.log(`${name}: fetch boundary assertions passed`);
  }
} finally {
  await app.close();
}
```

각 handler에 새 `Request`를 만드는 이유는 같은 입력 스트림의 두 번째 소비를 테스트와 혼동하지 않기 위해서다. 응답이 JSON처럼 보이는지만 확인하지 않고 status, Content-Type, 파싱한 전체 영수증을 비교한다. 바이트 수만 같아도 다른 바이트일 수 있으므로 배열까지 비교한다. 실패했을 때는 파서와 호스트 변환의 경계를 조사할 수 있지만 이 결과만으로 TLS, listener backlog, 운영체제 신호까지 확인한 것으로 말할 수는 없다.

## Bun과 Deno가 서버를 소유하도록 연결한다

무리스너 실험 다음에는 실제 런타임을 선택한다. 다음 두 파일은 서로 대체하는 완전한 `src/main.ts`다. 하나의 프로세스에서 둘을 함께 실행하지 않는다. 앞 장의 `AppModule`과 표준 데코레이터 변환을 거친 JavaScript 출력물을 사용하며, 런타임이 TypeScript를 읽는다는 이유로 데코레이터 변환 단계를 삭제하지 않는다.

Bun을 선택한 경우에는 concrete static adapter를 만들고 Factory에 전달한다. 이전 managed helper가 사용하던 30초 application shutdown bound는 adapter에 명시하고, 30초 host force-exit bound를 유지할 signal callback도 package root에서 선택한다.

```typescript
import {
  BunHttpApplicationAdapter,
  createBunShutdownSignalRegistration,
} from '@fluojs/platform-bun';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

export const app = await FluoFactory.create(AppModule, {
  adapter: BunHttpApplicationAdapter.create({
    hostname: '127.0.0.1',
    port: 3000,
    rawBody: true,
    maxBodySize: 256,
    shutdownTimeoutMs: 30_000,
  }),
  shutdownRegistration: createBunShutdownSignalRegistration(),
});
await app.listen();
```

Deno를 선택한 경우에도 같은 Factory path를 쓴다. callback은 signal close 오류를 logger에 기록하고 swallow하며 exit status를 정하지 않는다. signal lifecycle을 전적으로 host가 소유하면 이 callback을 생략한다.

```typescript
import {
  DenoHttpApplicationAdapter,
  createDenoShutdownSignalRegistration,
} from '@fluojs/platform-deno';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app.js';

export const app = await FluoFactory.create(AppModule, {
  adapter: DenoHttpApplicationAdapter.create({
    hostname: '127.0.0.1',
    port: 3000,
    rawBody: true,
    maxBodySize: 256,
  }),
  shutdownRegistration: createDenoShutdownSignalRegistration(),
});
await app.listen();
```

빌드 출력이 `dist/main.js`인 애플리케이션의 실행 명령은 각각 아래와 같다. Deno 쪽은 프로젝트의 npm 의존성이 Deno에서 해석되도록 구성되어 있어야 한다. 이는 Node용 테스트 파일을 Worker 번들에 넣으라는 명령이 아니다.

```bash
bun dist/main.js
```

```bash
deno run --allow-net dist/main.js
```

Deno의 네트워크 권한은 실제 서버를 열기 위해 필요하다. adapter가 환경 변수를 읽는 것은 아니다. 애플리케이션에서 `PORT`를 읽기로 결정했다면 그때 해당 환경 변수 권한과 값 검증을 추가한다. Deno의 `hostname`과 이식성 별칭 `host`를 함께 주면 `hostname`이 우선한다. TLS 옵션도 Bun은 `tls`, Deno는 `https: { cert, key }`를 사용하므로 모든 런타임에 같은 옵션 객체를 무조건 넘기지 않는다.

반대로 이미 `Bun.serve()`나 `Deno.serve()`를 관리하는 호스트가 있으면 앞의 Fetch handler를 그 호스트에 연결할 수 있다. 이때 bridge는 요청 변환과 dispatch만 맡는다. 서버 중지, signal 처리, WebSocket upgrade와 Bun의 네이티브 `routes` 가속은 자동으로 따라오지 않는다. adapter의 `listen()`과 별도의 `serve()`를 둘 다 호출하면 같은 애플리케이션을 위한 리스너 소유자가 둘이 된다. 어느 한쪽을 고르고 종료 테스트도 그 소유자를 대상으로 작성한다.

## Worker에서는 환경의 수명과 요청의 수명을 나눈다

Worker에 처음 올린 공개 상품 조회에서 이상한 일이 생겼다고 하자. 첫 요청은 `region-a` 설정으로 시작했고 다음 요청에는 `region-b` 환경 객체를 넘겼는데 상품 provider가 여전히 첫 값을 사용한다. singleton provider를 요청마다 다시 구성할 것이라고 기대했다면 버그처럼 보인다. 그러나 env-aware entrypoint의 계약은 첫 환경으로 루트 모듈과 bootstrap 옵션을 선택하고 isolate 안에 그 구성을 보존하는 것이다.

이를 관찰하기 위해 상품 한 개의 읽기 모델을 추가한다. 아래는 완전한 `src/worker-app.ts`다. `CATALOG_REGION`은 이 실험이 소유하는 실제 DI 토큰이다. `CatalogReader`의 상품 가격은 KRW 최소 단위 정수이며 재고를 판단하거나 주문 가격을 확정하는 권위 있는 저장소가 아니다. 기존 상점을 이 데이터로 대체하지 않는다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import { AppModule } from './app.js';

const CATALOG_REGION = Symbol('catalog.region');

@Inject(CATALOG_REGION)
export class CatalogReader {
  constructor(readonly region: string) {}

  list() {
    return [{
      sku: 'T-SHIRT-BLOG',
      title: 'FluoBlog Logo T-Shirt',
      currency: 'KRW',
      unitPriceMinor: 25000,
      version: 1,
    }];
  }
}

@Inject(CatalogReader)
@Controller('/products')
class CatalogController {
  constructor(private readonly catalog: CatalogReader) {}

  @Get('/')
  list(_input: undefined, context: RequestContext) {
    context.response.setHeader('x-catalog-region', this.catalog.region);
    return this.catalog.list();
  }
}

export function createWorkerModule(region: string) {
  @Module({
    providers: [
      { provide: CATALOG_REGION, useValue: region },
      CatalogReader,
    ],
    controllers: [CatalogController],
    exports: [CatalogReader],
  })
  class CatalogModule {}

  @Module({ imports: [AppModule, CatalogModule] })
  class WorkerAppModule {}

  return WorkerAppModule;
}
```

다음 완전한 `src/worker.ts`는 환경 값에서 모듈을 선택한다. 함수 안에서 값의 범위를 검사하는 이유는 이 값이 요청 입력이 아니라 애플리케이션 세대를 구성하는 외부 설정이기 때문이다. 이 검증 실패는 고객의 상품 조회 DTO 오류와 같은 400 응답 계약이 아니다.

```typescript
import { createCloudflareWorkerEnvEntrypoint } from '@fluojs/platform-cloudflare-workers';
import { createWorkerModule } from './worker-app.js';

export interface WorkerEnv {
  CATALOG_REGION: string;
}

export const worker = createCloudflareWorkerEnvEntrypoint<WorkerEnv>((env) => {
  if (
    typeof env.CATALOG_REGION !== 'string' ||
    !/^[a-z0-9-]{1,32}$/.test(env.CATALOG_REGION)
  ) {
    throw new TypeError('CATALOG_REGION must be a short region identifier');
  }
  return {
    rootModule: createWorkerModule(env.CATALOG_REGION),
    options: { rawBody: true, maxBodySize: 256 },
  };
});

export default { fetch: worker.fetch };
```

fetch마다 전달된 환경은 계속 `request.cloudflare.env`에 붙지만 이미 구성된 singleton을 다시 만들지는 않는다. 따라서 요청별 고객이나 권한 정보를 첫 환경의 provider에 넣으면 안 된다. 요청에 필요한 바인딩은 해당 요청에서 검증하고 좁혀 서비스 메서드의 인자로 넘긴다. 반대로 모듈 등록 전에 반드시 필요한 설정만 env-aware factory에서 선택한다. `ready(env)`가 환경을 명시적으로 요구하는 것도 이 경계를 숨기지 않기 위해서다.

## 재시작 실험에서 같은 것과 달라지는 것을 구분한다

아래 완전한 `src/worker-probe.ts`는 Worker entrypoint를 호스트 밖에서 호출하는 Node24 계약 실험이다. 실제 Cloudflare 배포도, 인프라 변경도 하지 않는다. 표준 데코레이터 빌드 뒤 별도 Node 프로그램으로 실행하고 Worker 번들에서는 제외한다.

```typescript
import assert from 'node:assert/strict';
import type { CloudflareWorkerExecutionContext } from '@fluojs/platform-cloudflare-workers';
import { worker } from './worker.js';
import { CatalogReader } from './worker-app.js';

const pending: Promise<unknown>[] = [];
const context: CloudflareWorkerExecutionContext = {
  waitUntil(promise) {
    pending.push(promise);
  },
};
const firstEnv = { CATALOG_REGION: 'region-a' };
const laterEnv = { CATALOG_REGION: 'region-b' };

try {
  const [first, concurrent] = await Promise.all([
    worker.ready(firstEnv),
    worker.ready(firstEnv),
  ]);
  assert.strictEqual(first, concurrent);
  const firstReader = await first.app.get(CatalogReader);

  const response = await worker.fetch(
    new Request('https://probe.test/products'),
    laterEnv,
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type')?.split(';')[0],
    'application/json',
  );
  assert.equal(response.headers.get('x-catalog-region'), 'region-a');
  assert.deepEqual(await response.json(), [{
    sku: 'T-SHIRT-BLOG',
    title: 'FluoBlog Logo T-Shirt',
    currency: 'KRW',
    unitPriceMinor: 25000,
    version: 1,
  }]);
  assert.ok(pending.length > 0);
  await Promise.all(pending);

  await worker.close();
  const restarted = await worker.ready(laterEnv);
  const restartedReader = await restarted.app.get(CatalogReader);
  assert.notStrictEqual(restarted.app, first.app);
  assert.notStrictEqual(restartedReader, firstReader);
  assert.equal(restartedReader.region, 'region-a');
  console.log('worker: generation and configuration assertions passed');
} finally {
  await worker.close();
}
```

동시에 시작한 readiness 호출은 같은 application wrapper를 받는다. 성공한 close 뒤에는 새 application과 새 singleton이 생기지만 설정은 첫 환경의 `region-a`다. 이 차이를 객체 identity와 실제 응답 헤더로 각각 검사한다. “요청 두 번이면 factory 두 번”이라는 기대는 이 실험에서 틀려야 한다. 성공한 close를 영구 종료로 쓰려는 애플리케이션은 별도의 terminal 상태를 소유해야 한다.

`waitUntil()`을 빈 함수로 만들지 않은 점도 중요하다. fake가 받은 promise를 모아 기다려야 요청 수명주기 등록을 관찰할 수 있다. 이 fake는 Cloudflare의 CPU 제한, isolate eviction, 배포 네트워크를 재현하지 않으며 그런 보장을 주장하지 않는다. 무작정 잠시 기다리는 대신 실제 등록된 작업의 완료를 기다리는 것이 여기서 필요한 검증이다.

## 응답 반환, 스트림 종료, 애플리케이션 close는 서로 다르다

Workers의 `adapter.fetch(request, env, executionContext)`에는 세 번째 인자가 필요하다. dispatcher가 연결된 뒤 수락한 작업이 `waitUntil()`에 등록되기 때문이다. 일반 HTTP dispatch뿐 아니라 SSE 응답 본문의 종료·취소, upgrade된 서버 WebSocket의 terminal close도 관련 수명주기에 들어간다. `Response` 객체가 반환되었다고 판매 상태 SSE 구독이 끝난 것은 아니다.

관리 경로 안에서 `await worker.close()`를 호출하는 구현은 특히 위험하다. close는 활성 요청이 끝나기를 기다리는데 활성 요청 자신이 close를 기다리게 된다. 관리 요청을 설계한다면 현재 요청을 기다리는 형태를 피하고 `executionContext.waitUntil(worker.close())` 같은 비동기 관찰 경로를 사용해야 한다. 이 장의 probe는 fetch 호출 밖에서 close하므로 직접 await할 수 있다. 이런 차이를 숨긴 범용 “모든 호스트에서 같은 shutdown hook”은 오히려 장애를 만든다.

Worker close는 새 유입을 503으로 막고 활성 작업을 최대 10초 기다린다. timeout은 underlying drain이 끝났다는 뜻이 아니다. 아직 drain 중인 adapter의 `listen()`은 재개를 거절하며, lazy entrypoint는 이 시간 동안 새 application으로 우회하지 않는다. 이후 underlying drain이 실제로 끝나면 lazy 경로는 복구할 수 있다. 성공한 lazy close 뒤 다음 fetch가 새 application을 만드는 동작과, raw adapter가 명시적 listen 전까지 503을 유지하는 동작을 구분해야 한다.

Bun도 종료 시작 시 새 유입을 막고 `server.stop(stopActiveConnections)`를 시작한다. bounded timeout은 호출자의 close 대기를 실패시킬 뿐, 진행 중인 작업을 버리고 adapter 상태를 즉시 비우는 신호가 아니다. Deno는 새 유입을 중단하고 active handler를 drain하며 필요하면 serve signal을 abort한다. 명시적으로 전달한 Deno shutdown callback의 signal-driven close 실패는 로그에 남지만 exit status를 설정하지 않는다. 실패 상태 전파를 직접 소유하는 호스트는 `shutdownRegistration`을 생략하고 signal을 별도로 조율한다.

## 이식성은 최소 공약수와 선택 기능을 함께 기록한다

Fetch 기반 세 어댑터에는 Fluo의 `earlyHints` capability가 없다. Node에서 쓰던 103을 최종 응답 헤더에 복사하는 것은 같은 동작이 아니다. 기능이 선택적이라면 capability 존재를 확인하고, 제품 요구가 실제 informational response 전송이라면 이를 지원하는 호스트를 선택한다.

멀티파트도 JSON raw-body 실험의 연장이 아니다. multipart에서는 `rawBody`를 보존하지 않는다. streaming 전략을 선택하면 파일 part의 `ReadableStream`은 단일 소비자이며 다음 part로 넘어가기 전에 현재 스트림을 끝까지 읽거나 취소해야 한다. runtime이 route iterator를 정리하는 책임과, 직접 `parseMultipartStream()`을 호출한 소비자가 `return()`을 호출해야 하는 책임도 나뉜다. 업로드 취소를 시험할 때는 “JSON receipt를 받았다”보다 소스가 cancel되고 자원이 반환되었는지를 관찰해야 한다.

Bun의 네이티브 `routes` 가속 역시 semantic을 보존할 수 있을 때만 사용한다. 모호한 경로나 확장 메서드를 fetch fallback으로 보냈다고 이식성이 깨진 것은 아니다. 반대로 어댑터에 WebSocket capability가 보여도 protocol binding을 module graph에 등록하기 전에는 자동 upgrade를 기대하지 않는다. Workers의 binding identity는 listen 경계를 지난 뒤 close 이후에도 바꿀 수 없으므로 다른 binding이 필요하면 새 adapter가 필요하다.

실제 이전의 승인 기준은 공개 글·상품·원본 바이트 계약, 바디 제한, 쿠키, 스트림 취소와 종료 소유권이 함께 설명되는 것이다. 네이티브 Bun·Deno·Worker 환경의 별도 smoke 결과 없이 이 장의 무리스너 실험을 배포 검증으로 부르지 않는다. 상품 읽기 모델을 가까이 둘 수 있다는 판단과 주문 권위를 어디에 둘 것인지는 여전히 별도 설계다.

다음 장은 다른 방향의 호스팅을 다룬다. 런타임을 바꾸지 않고 Node24를 유지하되, 서버와 파일 라우팅을 Next.js에 맡긴다. Web `Request`를 공유한다는 이유만으로 Workers와 Next의 재시작·메서드·렌더링 계약까지 같다고 생각하지 않는 것이 출발점이다.

## 근거와 재현 범위

- [Bun README](../../packages/platform-bun/README.ko.md), [공개 export](../../packages/platform-bun/src/index.ts), [Fetch handler·managed adapter 구현](../../packages/platform-bun/src/adapter.ts), [adapter 테스트](../../packages/platform-bun/src/adapter.test.ts).
- [Deno README](../../packages/platform-deno/README.ko.md), [공개 export](../../packages/platform-deno/src/index.ts), [host-owned Fetch handler](../../packages/platform-deno/src/fetch-handler.ts), [handler 테스트](../../packages/platform-deno/src/fetch-handler.test.ts), [managed lifecycle 테스트](../../packages/platform-deno/src/adapter.test.ts).
- [Workers README](../../packages/platform-cloudflare-workers/README.ko.md), [공개 export](../../packages/platform-cloudflare-workers/src/index.ts), [env-aware factory·lifecycle 구현](../../packages/platform-cloudflare-workers/src/adapter.ts), [종료 회귀 테스트](../../packages/platform-cloudflare-workers/src/adapter-lifecycle.test.ts).
- [공유 Web 요청·응답 구현](../../packages/runtime/src/web.ts), [세 Web 런타임의 이식성 테스트](../../packages/testing/src/portability/web-runtime-adapter-portability.test.ts).

이 장은 공개 API와 소스를 근거로 재현 프로그램과 예상 결과를 제시한다. 원고 작성 중 네이티브 Bun·Deno 서버나 Cloudflare 배포를 실행해 통과했다는 주장은 하지 않는다.

[이전: Node.js 어댑터 비교하기](./ch13-node-adapters.ko.md) · [목차](./toc.ko.md) · [다음: Next.js 안에서 Fluo 실행하기](./ch15-nextjs-hosting.ko.md)
