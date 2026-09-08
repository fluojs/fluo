# @fluojs/platform-nextjs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

기존 Fluo decorator, module, factory, dependency injection을 바꾸지 않고
Fluo backend를 Next.js App Router Route Handlers와 Pages Router API Routes에
연결합니다.

## 목차

- [설치](#설치)
- [공통 설정](#공통-설정)
- [App Router](#app-router)
- [HEAD Routing](#head-routing)
- [Pages Router](#pages-router)
- [FluoFactory 연결](#fluofactory-연결)
- [Pipeline compatibility](#pipeline-compatibility)
- [Decorator compiler 연결](#decorator-compiler-연결)
- [Lifecycle](#lifecycle)
- [Options](#options)
- [Runtime contract](#runtime-contract)
- [Public API](#public-api)

## 설치

지원 host는 Node.js `>=24.0.0 <27`에서 실행하는 Next.js **16.x**
(peer `>=16.0.0 <17`)이며 `@fluojs/runtime` `>=3.0.0 <4`가 필요합니다.
Next.js Edge Runtime은 지원하지 않습니다.
[Node.js 지원 계약](../../docs/reference/node-support.ko.md)을 참조하세요.

Application이 이미 Fluo를 사용한다면 adapter 하나만 추가합니다.

```bash
pnpm add @fluojs/platform-nextjs
```

기존 Next.js application에서 Fluo backend를 새로 시작한다면 application
source가 직접 import하는 Fluo packages도 direct dependencies로 추가합니다.

```bash
pnpm add \
  @fluojs/core \
  @fluojs/http \
  @fluojs/runtime \
  @fluojs/platform-nextjs
```

별도의 Babel package, loader package, decorator options 작성은 필요하지
않습니다. Next 전용 decorator loader는 adapter에 포함됩니다.

## 공통 설정

기존 Next configuration을 보존하면서 packaged decorator transform을
활성화합니다.

```typescript
// next.config.ts
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';

export default withFluoNextBackend({});
```

기존 decorated Fluo module을 변경하지 않습니다.

```typescript
// src/app.module.ts
import { Module } from '@fluojs/core';
import {
  Controller,
  Get,
  HttpCode,
  Post,
  type RequestContext,
} from '@fluojs/http';

@Controller('/api')
class ApiController {
  @Get('/health')
  health() {
    return { status: 'ok' };
  }

  @Post('/echo')
  @HttpCode(201)
  echo(_input: undefined, context: RequestContext) {
    return { body: context.request.body };
  }
}

@Module({ controllers: [ApiController] })
export class AppModule {}
```

다른 모든 Fluo HTTP platform과 똑같이 adapter를 만들고 `FluoFactory`에
전달한 뒤 application을 시작합니다.

```typescript
// src/backend.ts
import { createNextAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';

import { AppModule } from './app.module';

export const nextAdapter = createNextAdapter();
export const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
});
await app.listen();
```

## App Router

Optional catch-all Route Handler 하나를 추가합니다.

```typescript
// app/api/[[...path]]/route.ts
import { createNextAppRouterHandler } from '@fluojs/platform-nextjs/app-router';

export const {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  HEAD,
  OPTIONS,
} = createNextAppRouterHandler(() =>
  import('../../../src/backend').then(({ nextAdapter }) => nextAdapter),
);
```

Next.js는 filesystem route 하나를 계속 발견합니다. 이 facade 뒤에서는
Fluo가 decorator metadata, route matching, module bootstrap, dependency
injection, request scope, body parsing, error, controller dispatch를
담당합니다. Route Handler는 Fluo backend가 요구하는 Node.js runtime을
기본으로 사용하므로 `runtime` override는 필요하지 않습니다.

## HEAD Routing

GET-only Fluo route가 Next의 자동 HEAD와 명시적인 `HEAD` export 모두에
응답해야 한다면 adapter 생성 시 opt-in합니다.

```typescript
import { createNextAdapter } from '@fluojs/platform-nextjs';

export const nextAdapter = createNextAdapter({
  headRouting: 'explicit-or-get',
});
```

생략하면 기존 method matching을 유지하므로 GET-only Fluo route는 HEAD에
암묵적으로 매칭되지 않습니다. 이 option에서는 공통 HTTP matcher가 유효한
명시적 `@Head`, 없으면 `@All`, 없으면 `@Get` route 하나를 선택합니다.
그룹 간에는 method 우선순위가 path specificity보다 앞서고, 각 그룹 안에서는
기존 static/parameter 및 version 규칙을 적용합니다. `ALL`은 method wildcard이지
path wildcard가 아니므로 Fluo catch-all path grammar는 계속 지원하지 않습니다.

선택은 module middleware, guard, controller 이전에 한 번 결정합니다.
Route miss는 404를 반환합니다. 선택한 handler가 반환한 404는 최종 결과이며
다시 dispatch하지 않습니다. 기존 short-circuit 동작에 따라 application middleware,
module middleware, guard, controller는 각각 최대 한 번 실행합니다.

정규화된 request와 native `Request`는 middleware, guard, version extractor,
conditional resolver, handler 안에서도 원래 **HEAD**를 유지합니다. 선택한
descriptor에는 GET 등 선언한 method가 그대로 남습니다. 따라서 기존
conditional-request 및 byte-range status/header 규칙을 유지합니다.
Adapter는 direct send, route miss, error, 미준비/종료 후 503을 포함한
모든 opted-in HEAD 응답을 null body로 반환하면서 status, status text,
representation header, 독립적인 cookie를 보존합니다. 선택된 응답에 없는
content length를 임의로 만들지는 않습니다.

활성 response stream을 취소한 뒤 dispatch lifecycle, iterator cleanup,
request-scope disposal 완료를 기다립니다. Stream source는 cancellation에 협력하고
iterator `return()`을 완료해야 합니다. Cleanup failure는 기존 dispatcher의
observer/logging 정책으로 처리하며 GET 재시도나 이미 commit한 metadata 교체를
하지 않습니다. Response stream에 들어오지 않은 application-owned resource는
계속 application이 소유합니다. HEAD에서 byte source 자체를 열지 않으려면
`createByteRangeResponse`에 stream factory를 전달하세요.

**Migration:** HEAD request를 GET으로 재구성하고 body를 버리는 application
wrapper를 제거하고 표준 `createNextAppRouterHandler(loadAdapter)` facade를
사용합니다. `GET`만 export하여 Next가 auto-HEAD로 호출하게 하거나 `GET`과
`HEAD`를 함께 export해도 같은 정책을 적용합니다. Pages Router도 같은 adapter
option을 사용합니다. 기존 wrapper 때문에 GET을 관찰하던 method 기반 application
분기는 원래 HEAD를 인식하도록 수정하세요. Option을 생략하는 기존 소비자는
configuration이나 동작을 변경할 필요가 없습니다.

검증 근거: [`head-routing.test.ts`](./src/head-routing.test.ts),
[`head-routing-public-types.test.ts`](./src/head-routing-public-types.test.ts),
실제 HTTP로 auto-HEAD, 직접 App Router HEAD, Pages Router HEAD를 비교하는
packaged [Next 16 production E2E](./e2e/next.test.mjs).

## Pages Router

Optional catch-all API Route 하나를 만듭니다. Export한 config는 Next built-in
body parser를 꺼서 Fluo가 원본 request stream을 받게 합니다.

```typescript
// pages/api/[[...path]].ts
import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from '@fluojs/platform-nextjs/pages-router';

export default createNextPagesRouterHandler(() =>
  import('../../src/backend').then(({ nextAdapter }) => nextAdapter),
);
export const config = {
  api: {
    bodyParser: false,
  },
} satisfies NextPagesRouterConfig;
```

Pages bridge는 raw `IncomingMessage`를 Web request로 변환하고 Fluo body
parsing과 size limit을 그대로 사용하며 Web response를 `ServerResponse`로
streaming합니다.

입력은 Fluo parser보다 앞서 큐에 쌓지 않고 필요할 때 읽습니다. 크기를 초과한
업로드에는 전송이 끝나기 전에도 HTTP 413을 보낼 수 있습니다. Bridge는 응답을
보낸 뒤에만 남은 입력을 버려 drain하며 socket 소유권은 가져오지 않습니다.
Raw-body capture는 원본 byte를 보존합니다.

Client 연결 종료는 `context.request.signal`로 전파되고 response stream의
읽기를 취소합니다. Lazy bootstrap 중 연결이 끊기면 그 요청을 dispatch하지 않고
종료하며 공유 backend startup은 취소하지 않습니다.

## FluoFactory 연결

Next adapter는 Fastify를 비롯한 다른 Fluo HTTP adapters와 같은 platform
contract를 따릅니다. Application code가 adapter를 만들고
`FluoFactory.create()`에 전달한 뒤 `app.listen()`을 호출합니다. Runtime이
application과 dispatcher를 만들고
`NextHttpApplicationAdapter.listen()`으로 dispatcher를 연결합니다.

Next adapter는 application을 만들지 않고 socket도 열지 않습니다.
Dispatcher 연결 후 bound Web handlers만 제공하며 HTTP server는 계속
Next.js가 소유합니다.

Route facade는 첫 request에서 `src/backend.ts`를 dynamic import합니다.
Import 완료에는 top-level `FluoFactory.create()`와 `app.listen()`이
포함되므로 handler가 binding되지 않은 adapter를 볼 수 없습니다.
`next build`는 backend chunk를 compile하지만 이 bootstrap을 실행하지
않습니다.

## Pipeline compatibility

두 router bridge 모두 다른 HTTP platform과 같은 Fluo dispatcher로 request를
정규화합니다. 따라서 application pipeline 전체가 그대로 동작합니다.

- request `Cookie` header와 DTO `@FromCookie` binding
- response header와 서로 독립적인 여러 `Set-Cookie` 값
- application/module middleware
- guard, interceptor, exception filter, request observer
- `RequestDto` binding, global converter, field-level `@Convert`
- request scope, body parsing, multipart handling, raw body 보존

Fluo는 Nest의 `Pipe`라는 이름의 abstraction을 제공하지 않습니다. 대응되는
input transformation contract는 `FluoFactory.create()`에 전달하는 global
`Converter` 또는 `RequestDto` field의 `@Convert`입니다.

Next middleware가 Route Handler 전후에서 request/response header를 변경할 수
있습니다. Fluo controller는 Next component용 `cookies()` helper 대신 실제
handler에 도달한 cookie header를 `@FromCookie` 또는 `RequestContext`로
읽습니다.

App Router와 Pages Router를 하나의 hybrid Next application에서 함께 사용할
수도 있습니다. 다만 Next는 두 router를 별도 server route bundles로
만들기 때문에 catch-all을 동시에 활성화하면 bundle마다 lazy Fluo
application이 하나씩 생성됩니다. Process-wide singleton state가 필요하면
migration 중에는 catch-all 하나만 사용하고, deterministic single-instance
ownership이 필요하면 Fluo를 별도 backend로 host하세요.

## Decorator compiler 연결

`withFluoNextBackend()`는 adapter에 포함된 loader를 server-side Turbopack
application `*.ts` rule에 추가하며 browser와 dependency 파일은 제외합니다.
Loader는 `@fluojs/vite`와 동일한 Babel TC39
decorators `2023-11` transform을 적용하고 JavaScript를 Turbopack에
반환합니다.

Packaged compiler integration은 Turbopack만 지원하며 webpack은 지원하지
않습니다. Decorated backend 선언은 `.ts` 파일에 두세요. Helper는 `.tsx`
rule을 추가하지 않습니다.
[Compiler tooling 표](../../docs/reference/toolchain-contract-matrix.ko.md#빌드-구성)를 참조하세요.

Vite와 Turbopack의 plugin contract가 다르므로 Vite plugin 자체를 Next.js에
넣을 수는 없습니다. 재사용하는 부분은 compiler recipe이고, adapter는
Next 전용 loader와 config object를 제공합니다.

기존 `turbopack` options, aliases, rules는 보존됩니다. Application에
`*.ts` rule이 이미 있다면 Fluo decorator rule을 뒤에 추가합니다. Helper는
새 configuration object를 반환하며 input을 변경하지 않습니다.

## Lifecycle

Backend module은 첫 route request가 import할 때 일반 Fluo bootstrap을 한
번 수행합니다.

```typescript
const nextAdapter = createNextAdapter();
const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
});
await app.listen();
```

Route handler는 하나의 loader promise를 cache하므로 동시에 들어온 첫
requests는 같은 backend import와 startup을 공유합니다. Application code가
일반 Fluo `Application`을 소유합니다.
`Application.close()`를 호출하면 standard shutdown lifecycle이 adapter를
닫습니다. 그 뒤의 요청은 HTTP 503 problem JSON을 받습니다.

```typescript
await app.close('manual shutdown');
```

Process startup과 shutdown은 Next.js가 소유합니다. 이 package는 process
signal handler를 등록하거나 명시적 close 후 두 번째 application을
자동으로 만들지 않습니다.

## Options

```typescript
const nextAdapter = createNextAdapter({
  maxBodySize: 1_048_576,
  rawBody: true,
});
const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
  // Ordinary Fluo CreateApplicationOptions stay here.
});
await app.listen();
```

- `maxBodySize`: bytes 단위의 non-negative maximum request body size
- `rawBody`: parsed request bytes를 `context.request.rawBody`에 보존
- `headRouting`: 선택적인 `'explicit-or-get'` 라우팅과 body 없는 HEAD lifecycle; [HEAD Routing](#head-routing) 참조
- Fluo runtime options는 일반 `FluoFactory.create()` options에 유지

## Runtime contract

- App Router Route Handlers와 Pages Router API Routes
- Next.js 16.x (peer `>=16.0.0 <17`)
- Node.js `>=24.0.0 <27` hosting 전용; Edge Runtime 미지원
- `@fluojs/runtime` peer `>=3.0.0 <4`
- Turbopack 전용 `next.config.ts`의 `withFluoNextBackend()`
- request-lazy dynamic backend module import
- App Router exports: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`
- Pages Router default `NextApiHandler` export와 `bodyParser: false`
- HTTP method 지원 범위는 Next.js routing으로 제한됩니다. Adapter는 이 host
  boundary를 넘어 `QUERY`나 다른 custom method 지원을 추가하지 않습니다
- Web-standard `Request`와 `Response`
- Raw WebSocket upgrade seam 없음
- Custom server 또는 process signal ownership 없음
- Catch-all bundle마다 하나의 lazy application을 사용하며 App Router와
  Pages Router server bundle 사이에 singleton을 공유하지 않음

Application이 raw Node.js transport ownership, WebSocket upgrades, independently hosted backend를 요구하면 Fluo Node 또는 Fastify platform adapter를 사용하세요.

## Public API

- `createNextAdapter(options)`: `FluoFactory.create()`에 전달할 HTTP adapter 생성
- `NextAdapterOptions`: adapter가 소유하는 request parsing 및 opt-in HEAD routing options
- `NextAdapterLoader`: dynamic canonical backend adapter loader
- `createNextAppRouterHandler(loadAdapter)`: 구조분해 export 가능한 method-keyed App Router handler export record 생성 (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`)
- `NextHttpApplicationAdapter`: bound `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` handlers를 가진 `HttpApplicationAdapter`
- `NextAppRouteHandler`: bound methods가 사용하는 Web request handler type
- `NextAppRouterMethodHandlers`: route module에서 구조분해 export하는 method-keyed App Router record (`createNextAppRouterHandler()` 반환)
- `createNextPagesRouterHandler(loadAdapter)`: request-lazy streaming Pages Router API handler 생성
- `NextPagesRouterConfig`: 필수 static `bodyParser: false` literal type-check
- `withFluoNextBackend(config)`: `@fluojs/platform-nextjs/next-config` export; packaged Turbopack decorator loader 추가
- `decorators-loader`: config helper가 사용하는 packaged loader subpath

## 개발 검증

저장소 root에서 실행합니다.

```bash
pnpm --filter '@fluojs/platform-nextjs...' build
pnpm --filter @fluojs/platform-nextjs typecheck
pnpm --filter @fluojs/platform-nextjs test
pnpm --filter @fluojs/platform-nextjs test:e2e
```

Unit suite에는 공통 Web portability 검사와 native Pages transport 회귀
테스트가 포함됩니다. E2E suite는 package 배포 파일로 실제 Next.js application을
빌드하고 source alias 없이 두 router를 HTTP로 검증합니다.
