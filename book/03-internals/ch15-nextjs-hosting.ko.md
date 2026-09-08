# Next.js 안에서 Fluo 실행하기

<!-- book:volume=03-internals;chapter=15 -->

[이전: Fetch 기반 런타임으로 이동하기](./ch14-fetch-adapters.ko.md) · [목차](./toc.ko.md) · [다음: 직접 어댑터를 만들고 계약 검증하기](./ch16-custom-adapter.ko.md)

## 화면을 옮기는 날에도 주문 서비스는 같은 서비스다

FluoBlog에서 시작한 상점에 새 디자이너가 합류했다. 팀은 이미 운영 경험이 있는 Next.js로 블로그 소개와 상품 화면을 만들고 싶다. 하지만 주문의 `customerId`를 인증된 사용자에서 결정하는 코드, 재고 예약과 결제 경계를 Next Route Handler마다 다시 작성하고 싶지는 않다. 필요한 것은 두 번째 상점 백엔드가 아니라 기존 Fluo module graph를 Next가 소유한 HTTP 서버 뒤에 연결하는 방법이다.

앞 장의 Worker처럼 이번에도 호스트가 `Request`를 넘기고 Fluo가 `Response`를 만든다. 그러나 Next.js는 Worker가 아니다. 지원 조합은 Node.js `>=24.0.0 <27`, Next.js 16.x, runtime 3.x다. 본문은 Node24와 pnpm10을 기준으로 한다. Edge Runtime, webpack 통합, raw WebSocket upgrade는 이 adapter의 계약에 없다. Fetch API가 보인다는 사실만으로 그 기능까지 사용할 수 있다고 추론하지 않는다.

같은 제품을 유지한다는 말도 모듈을 무조건 같은 프로세스의 singleton으로 공유한다는 뜻은 아니다. 배포 인스턴스가 여럿이면 application도 여럿이다. Next의 App Router와 Pages Router catch-all을 함께 켜면 서로 다른 서버 route bundle에 lazy application이 생길 수 있다. 주문 멱등성을 메모리 `Set` 하나로 구현했다면 여기서 문제가 드러나겠지만, 원인은 adapter가 아니라 잘못된 영속성 경계다.

이 장에서는 13장의 `PostsModule`과 `PostsReader`를 재사용한다. 실제 상점의 단계별 완성 저장소가 있다는 전제는 두지 않는다. 14장의 Worker 실험을 삭제하고 Next로 완전 이주하라는 순차 배포 지시도 아니다. 같은 읽기 모델을 다른 호스트에 연결해 비교하는 갈래다. 인증과 결제 provider는 공개 글 실험에 필요하지 않으므로 가짜 인증으로 그 자리를 채우지 않는다.

## 파일 라우터와 Fluo 라우터 사이의 경계를 그린다

Next는 파일 하나를 발견하고 Fluo는 그 파일 뒤에서 자신의 route metadata를 해석한다. `/api/posts/1`이 들어오면 Next의 `app/api/[[...path]]/route.ts`가 요청을 받는다. 그 다음 Fluo의 `/api/posts/:id`가 선택된다. catch-all이 `/api`를 자동으로 잘라 주지는 않는다. 기존 `/posts` 컨트롤러를 그대로 넣고 `/api/posts/1`이 매칭될 것이라고 생각하면 404가 난다.

이 장의 `/api`는 Next 호스팅 실험의 명시적 접두사다. 기존 블로그 페이지 주소나 운영 API 주소를 조용히 변경하라는 뜻이 아니다. 실제 이전에서는 기존 외부 주소를 Next 페이지, reverse proxy 또는 명시적인 redirect 정책 중 누가 유지하는지 결정해야 한다. 여기서는 파일 라우팅과 dispatcher의 경계를 보이기 위해 Fluo route에도 전체 `/api` 경로를 적는다.

먼저 다음은 완전한 `next.config.ts`다. 기존 Next 설정이 있다면 그 객체를 helper에 전달하여 보존한다.

```typescript
import { withFluoNextBackend } from '@fluojs/platform-nextjs/next-config';

export default withFluoNextBackend({});
```

helper는 서버 애플리케이션의 `*.ts` 파일에 packaged Turbopack decorator loader를 추가한다. browser와 dependency 파일은 대상에서 제외한다. 같은 TC39 `2023-11` 변환 recipe를 사용하지만 Vite plugin을 Next에 꽂는 방식은 아니다. 별도의 Babel loader를 임의로 추가하거나 legacy decorator 플래그를 켜지 않는다. 기존 `*.ts` rule이 있으면 rule 구성을 보존하면서 Fluo rule을 추가하므로 설정 객체를 직접 파괴하지도 않는다.

decorated class는 `.ts`에 둔다. 화면용 JSX 파일인 `.tsx`를 변환해 줄 것이라고 기대하면 빌드 경계가 달라진다. 다음 예제에서 React 페이지를 `createElement()`로 작성하는 것은 바로 이 제약을 명시적으로 지키기 위해서다. 실제 화면 컴포넌트는 decorator가 없는 별도 `.tsx`로 옮기고 `.ts` router에서 호출해도 된다.

## API와 인쇄용 문서를 같은 provider에 연결한다

Next 화면과 `@fluojs/react`는 서로 다른 역할이다. Next의 `page.tsx`는 Next가 렌더링한다. `@fluojs/react`의 `@Router`와 `@Path`는 Fluo HTTP metadata 위에 있는 페이지 선언이다. 후자는 Next 파일 라우터를 대신하지 않으며 Next의 RSC·Server Actions 체계를 자동으로 가져오지도 않는다.

그렇다면 Next 안에서 Fluo React를 쓸 이유가 있을까? 기존 Fluo 페이지를 단계적으로 유지하거나, 동일한 서비스·guard·request scope를 사용하는 독립 HTML 문서를 제공할 때 유용하다. 여기서는 블로그 글의 인쇄용 문서를 만든다. 다음은 13장의 실험 루트 대신 사용하는 완전한 `src/app.ts`다. `src/posts/posts.module.ts`의 `PostsModule`, `PostsReader`, `PublicPost`는 그대로 필요하다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get, type RequestContext } from '@fluojs/http';
import {
  createReactServerEntry,
  Path,
  ReactModule,
  Router,
  type ReactPageRenderer,
} from '@fluojs/react';
import { createElement } from 'react';
import { PostsModule, PostsReader } from './posts/posts.module';

@Inject(PostsReader)
@Controller('/api/posts')
class ApiPostsController {
  constructor(private readonly posts: PostsReader) {}

  @Get('/:id')
  show(_input: undefined, context: RequestContext) {
    return this.posts.findPublished(context.request.params.id);
  }
}

@Inject(PostsReader)
@Router('/api/print/posts')
class PostPrintRouter {
  constructor(private readonly posts: PostsReader) {}

  @Path('/:id')
  show(_input: undefined, context: RequestContext) {
    const post = this.posts.findPublished(context.request.params.id);
    return createElement(
      'article',
      { 'data-post-id': String(post.id), 'data-version': String(post.version) },
      createElement('h1', null, post.title),
      createElement('p', null, post.content),
    );
  }
}

const renderPage: ReactPageRenderer = (page) =>
  createReactServerEntry(
    createElement(
      'html',
      { lang: 'en' },
      createElement(
        'head',
        null,
        createElement('meta', { charSet: 'utf-8' }),
        createElement('title', null, 'FluoBlog printable post'),
      ),
      createElement('body', null, page),
    ),
  );

@Module({
  imports: [
    PostsModule,
    ReactModule.forRoot({
      imports: [PostsModule],
      controllers: [PostPrintRouter],
      renderPage,
    }),
  ],
  controllers: [ApiPostsController],
})
export class AppModule {}
```

여기에는 두 종류의 명시적 등록이 있다. 루트의 API controller는 루트가 import한 `PostsModule`의 export를 보고, React router는 `ReactModule.forRoot()` 내부의 `imports`를 통해 같은 토큰을 본다. 부모 모듈에 provider가 있다는 이유만으로 자식 모듈의 가시성을 생략하지 않는다. `PostsReader`를 각 controller의 `providers`에 다시 등록해 두 개의 캐시를 만드는 것도 피한다.

`renderPage`는 application-owned renderer다. 단일 `ReactElement`를 받아 문서 shell을 만들고 `ReactServerEntry`를 반환한다. `ReactModule.forRoot()`가 이 renderer를 토큰으로 등록하여 기존 HTTP pipeline과 연결한다. JSON을 반환하는 API controller는 React 렌더링으로 들어가지 않는다. 반대로 React element를 반환하면서 renderer를 빼면 자동 HTML이 아니라 `react-ssr-missing-page-renderer` 진단이 발생한다.

이 문서는 의도적으로 hydration이 없는 인쇄용 SSR이다. React renderer에 가상의 `/assets/client.js`를 적어 넣지 않는다. 실제 상호작용을 유지하려면 존재하는 client bundle과 일치하는 document tree를 별도로 구성해야 한다. Next 페이지의 hydration 자산을 Fluo renderer가 알아서 찾아 주는 기능은 없다. 주문 버튼처럼 상태를 바꾸는 UI까지 이 예제에 얹기 전에 문서 소유자가 Next인지 Fluo인지 먼저 정해야 한다.

## lazy bootstrap이 완료된 adapter만 노출한다

다음은 완전한 `src/backend.ts`다. adapter는 application을 생성하지 않는다. runtime이 module graph와 DI를 구성하고 `app.listen()`을 통해 dispatcher를 adapter에 연결한다.

```typescript
import { createNextAdapter } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';

export const nextAdapter = createNextAdapter({
  maxBodySize: 1_048_576,
  rawBody: true,
});

export const app = await FluoFactory.create(AppModule, {
  adapter: nextAdapter,
});
await app.listen();
```

여기서 `listen()`은 포트를 열지 않는다. Next가 소켓을 소유하고 adapter는 bound Web handler를 제공한다. 13장의 `runFastifyApplication()`을 이 파일에 넣으면 필요하지 않은 두 번째 서버와 signal 소유자가 생긴다. 단순히 “기존 main 파일을 import”하는 접근이 실패하는 이유다.

다음 완전한 `app/api/[[...path]]/route.ts`는 첫 요청 때 backend를 동적으로 import한다. 경로의 `../../../src/backend`는 이 파일이 있는 디렉터리에서 프로젝트 루트로 세 단계 올라간 결과다.

```typescript
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

동적 import는 `backend.ts`의 top-level bootstrap과 listen까지 완료되어야 resolve된다. 따라서 facade가 아직 dispatcher와 연결되지 않은 adapter를 받는 창을 만들지 않는다. 여러 첫 요청은 하나의 loader promise를 공유한다. `next build`는 backend chunk를 컴파일하지만 이 lazy bootstrap을 실행하지 않으므로 빌드 성공은 데이터베이스 연결 성공이나 production 설정 검증 성공과 다르다.

현재 lazy resolver는 loader promise를 저장한다. 실패한 loader를 요청마다 새로 실행하는 재시도 루프라고 해석하지 않는다. 첫 bootstrap이 설정 오류로 실패했다면 해당 원인을 고치고 호스트의 재시작·재배포 경계를 사용한다. 모든 요청마다 `FluoFactory.create()`를 호출해 실패를 숨기려 하면 정상 요청에서도 모듈 초기화와 자원 생성이 반복된다.

새 Next 실험 앱이라면 다음 완전한 `app/layout.tsx`가 필요하다. 기존 Next 앱에서는 원래 layout을 유지한다.

```tsx
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```

아래 완전한 `app/page.tsx`는 두 경계를 브라우저에서 열어 보는 진입점이다.

```tsx
export default function Home() {
  return (
    <main>
      <h1>FluoBlog shop</h1>
      <ul>
        <li><a href="/api/posts/1">Read post JSON</a></li>
        <li><a href="/api/print/posts/1">Open printable post</a></li>
      </ul>
    </main>
  );
}
```

인쇄 링크는 Next layout 안에 HTML 문서를 끼워 넣는 컴포넌트 호출이 아니라 독립 HTTP 탐색이다. full-document 응답의 소유권을 분리했으므로 Next의 layout과 Fluo의 `<html>`이 중첩되지 않는다. 이 구분을 유지하면 기존 Fluo 페이지 일부를 남겨 놓는 점진적 이전도 설명할 수 있다.

## RSC와 인증 경로에도 같은 application이 필요하다면

앞의 facade별 lazy recipe는 그대로 유효하다. 소개 화면의 RSC와 인증 callback도
같은 process의 글 서비스를 호출해야 한다면 각 bundle에 전역 Promise를 직접
작성하는 대신 `defineNextApplication`을 선택할 수 있다. 다음은 앞에서 만든
`src/backend.ts`를 load하는 완전한 `src/application.ts`다. 공유할 모든 소비자는
직접 backend import 대신 이 함수를 사용한다.

```typescript
import { defineNextApplication } from '@fluojs/platform-nextjs';

export const getApplication = defineNextApplication({
  key: 'fluo-blog/application/v1',
  load: () => import('./backend'),
});
```

Route facade의 loader는
`() => getApplication().then(({ nextAdapter }) => nextAdapter)`로 연결한다.
RSC는 요청 처리 중 `await getApplication()`을 호출한다. 빌드 때 정적 렌더링으로
backend를 실행하고 싶지 않다면 해당 Next 페이지를 동적 렌더링 경계로 구성한다.
Definition 자체는 load하지 않지만 accessor 호출은 실제 bootstrap을 시작한다.

클래스는 bundle에서 다시 평가되면 이름이 같아도 다른 constructor다.
글 서비스의 공개 경계가 필요하면 별도 계약 파일에서
`publicToken<PostsReader>('fluo-blog/posts/v1')`를 선언한다. 이때 `PostsReader`는
type-only import로 사용하고, 실제 provider를 소유한 `PostsModule`에는
`{ provide: POSTS, useExisting: PostsReader }`와 `exports: [PostsReader, POSTS]`를
추가한다. 기존 class export를 유지하며 새 token만 추가하는 변경이다.
소비 module은 여전히 `PostsModule`을 import해야 한다.
RSC/auth용 작은 application 함수가
`(await getApplication()).app.container.resolve(POSTS)`를 반환하면
`Promise<PostsReader>` 추론을 유지하면서 반복 accessor 코드가 줄어든다.
정확한 파일별 예제는 [Next README](../../packages/platform-nextjs/README.ko.md#process-local-application-accessor)에 있다.

같은 key의 첫 호출이 loader를 소유하며 실패도 보존한다. HMR에서 코드를 바꾸어도
사용 중 graph를 교체하지 않는다. 소비자를 drain하고 `app.close()`를 호출할 책임은
application에 있고, 닫은 뒤 accessor를 호출해도 새 graph가 생기지 않는다.
변경된 bootstrap은 host 재시작으로 적용한다. 다른 key나 process, worker,
serverless instance까지 같은 singleton이라는 뜻은 아니다.
인증된 actor와 session은 매 호출의 인자나 요청별 scope로 전달하며 이 전역
Promise 안에 저장하지 않는다. 수동 `Symbol.for` + `useExisting` recipe도 유효하다.

패키지의 실제 Next E2E는 세 경로가 초기화 중에 합류하도록 HTTP gate를 열기 전에
구독하고, 별도 module 평가와 동일 instance, key/process 격리, 실패·close 보존을
확인한다. 이 application accessor는 Next의 인증 구현이나 Flight protocol을
제공하지 않는다.

## 동시에 들어온 첫 요청과 닫힌 뒤의 요청을 시험한다

아래 완전한 `src/next-adapter.test.ts`는 앞의 `AppModule`과 현재 Fluo 표준 데코레이터 Vitest 구성을 전제로 한다. 테스트는 Next 서버를 열지 않고 adapter와 lazy facade의 공개 접점을 검증한다. `@fluojs/testing/vitest`의 decorator plugin을 사용하는 기존 테스트 설정이 필요하며 Next용 config helper가 Vitest의 변환을 대신하지는 않는다.

```typescript
import { createNextAdapter, createNextAppRouterHandler } from '@fluojs/platform-nextjs';
import { FluoFactory } from '@fluojs/runtime';
import { expect, it } from 'vitest';
import { AppModule } from './app';

it('shares one loader and keeps explicit close terminal at the facade', async () => {
  const adapter = createNextAdapter();
  const app = await FluoFactory.create(AppModule, { adapter });
  let loads = 0;

  try {
    await app.listen();
    const handlers = createNextAppRouterHandler(async () => {
      loads += 1;
      return adapter;
    });
    const [left, right] = await Promise.all([
      handlers.GET(new Request('http://next.test/api/posts/1')),
      handlers.GET(new Request('http://next.test/api/posts/1')),
    ]);
    expect(loads).toBe(1);

    for (const response of [left, right]) {
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
    }

    const print = await handlers.GET(
      new Request('http://next.test/api/print/posts/1'),
    );
    expect(print.status).toBe(200);
    expect(print.headers.get('content-type')?.split(';')[0]).toBe('text/html');
    await print.text();

    await app.close('test shutdown');
    const closed = await handlers.GET(
      new Request('http://next.test/api/posts/1'),
    );
    expect(loads).toBe(1);
    expect(closed.status).toBe(503);
    expect(closed.headers.get('content-type')).toBe('application/problem+json');
    expect(await closed.json()).toEqual({
      code: 'next_backend_adapter_closed',
      status: 503,
      title: 'Next backend adapter is closed',
      type: 'https://fluo.dev/problems/next-backend-adapter-closed',
    });
  } finally {
    await app.close();
  }
});
```

이 테스트는 동시에 호출한 두 요청이 loader를 한 번만 실행하는지, 실제 JSON이 같은지, 명시적 close 뒤에는 503 problem JSON이 나오는지를 확인한다. 첫 요청의 “동시성”을 만들기 위해 sleep을 넣지 않는다. 두 promise를 먼저 시작한 다음 함께 기다리므로 loader 캐시의 공유 여부가 직접 관찰된다.

HTML 테스트는 이 코드에서 status와 media type, 본문 소비까지만 확인한다. 인쇄 문서의 실제 내용은 Next 개발 서버에서 `/api/print/posts/1`을 열어 `article[data-post-id="1"][data-version="2"]`, 제목, 본문을 DOM으로 확인한다. JSON API 테스트가 녹색이라는 이유로 HTML 구조와 React 렌더링까지 검증됐다고 쓰지 않는다. 없는 `/api/posts/999`와 `/api/print/posts/999`는 모두 404여야 하며, 후자가 특별한 HTML 오류 문서를 반환한다고 설정 없이 기대해서도 안 된다.

실제 호스트 확인은 Next 16의 Turbopack 개발·배포 경로에서 한다. 애플리케이션에서 `pnpm exec next dev`로 띄운 다음 다음 요청을 보낼 수 있다. 이미 실행한 결과가 아니라 재현 명령이다.

```bash
curl -i http://127.0.0.1:3000/api/posts/1
curl -i http://127.0.0.1:3000/api/print/posts/1
curl -i http://127.0.0.1:3000/api/posts/999
```

배포 승인에서는 `next build` 뒤 실제 서버에서도 반복한다. 패키지의 E2E는 배포 파일로 Next 앱을 빌드하고 source alias 없이 양쪽 router를 HTTP로 검증한다. 본문 무리스너 테스트는 그 증거를 대체하지 않는다. 특히 custom method가 adapter의 `fetch` 함수에서 처리된다고 Next 파일 라우터도 `QUERY`를 허용할 것이라고 결론 내리지 않는다. App Router export 목록은 위 일곱 메서드이며 호스트 제한을 adapter가 넓히지 않는다.

## Pages Router를 남길 때는 스트림 소유권을 보존한다

기존 상점 관리 화면이 Pages Router라면 App Router catch-all 대신 아래 완전한 `pages/api/[[...path]].ts`를 사용한다. 같은 이전 단계에서 두 catch-all을 동시에 활성화하지 않는다.

```typescript
import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from '@fluojs/platform-nextjs/pages-router';

export default createNextPagesRouterHandler(() =>
  import('../../src/backend').then(({ nextAdapter }) => nextAdapter),
);

export const config = {
  api: { bodyParser: false },
} satisfies NextPagesRouterConfig;
```

`bodyParser: false`는 성능 취향이 아니라 원본 스트림 소유권의 선언이다. Next가 먼저 JSON을 파싱하면 Fluo의 byte-exact raw-body capture와 제한된 읽기 경계가 달라진다. Pages bridge는 `IncomingMessage`를 Web request로 바꾸고 필요할 때 읽으며, Web response를 `ServerResponse`로 스트리밍한다. 너무 큰 업로드는 끝까지 읽기 전에 413을 보낼 수 있고, 남은 입력은 응답을 보낸 뒤 drain한다. bridge가 소켓 소유권을 빼앗는 것은 아니다.

13장의 웹훅 계측기를 이 경로에서 다시 쓰려면 route를 `/api/payments/webhooks`로 명시하고 같은 바이트 배열 영수증을 비교한다. 이 부분은 앞 장 컨트롤러를 prefix에 맞춰 연결하는 추가 실험이지 현재 `AppModule`에 이미 등록된 기능이라고 주장하지 않는다. `bodyParser: false`를 제거한 변형에서 원문 계약이 깨지는지를 확인하면 구성 한 줄의 필요성이 드러난다.

또 다른 실패는 lazy bootstrap 도중 브라우저가 요청을 취소하는 경우다. Pages bridge는 그 요청을 dispatch하지 않고 종료하지만 공유 backend startup까지 취소하지 않는다. 한 고객의 연결 종료가 동시에 기다리던 다른 고객의 초기화를 무너뜨리면 안 되기 때문이다. 활성 응답 스트림의 취소는 `context.request.signal`과 response reader cancellation으로 이어진다. 이 검증은 네이티브 Pages transport 테스트가 담당하며, 단순 `fetch` 호출의 JSON 일치만으로 입증되지 않는다.

## 배포와 렌더링 소유자를 더 늘리지 않는 선택

Next adapter는 process signal handler를 등록하지 않는다. `app.close()` 뒤 같은 facade는 새 application을 자동 생성하지 않고 503을 유지한다. 14장의 성공한 Worker lazy close 뒤 재시작과 다르다. 종료 정책을 공통 helper 한 줄로 일반화하지 말고 호스트가 무엇을 소유하는지 문서에 남겨야 한다.

App Router와 Pages Router bundle 사이의 singleton 공유도 기본으로 보장하지 않는다. 같은 JS global 안의 명시적 공유에는 앞의 accessor를 사용할 수 있지만, 여러 process를 아우르는 단일 instance는 아니다. 테스트에서 같은 파일을 import했더니 같은 인스턴스였다는 사실을 배포 모델의 근거로 삼지 않는다. deterministic한 단일 backend instance 소유권이나 raw WebSocket upgrade가 필요하면 Fastify·Node adapter로 별도 backend를 유지하는 편이 명확하다. Next를 사용한다는 이유만으로 이미 작동하는 주문 서버까지 안으로 밀어 넣을 필요는 없다.

`@fluojs/react`도 마찬가지다. Next가 화면을 모두 소유한다면 Fluo는 JSON API만 제공해도 된다. 기존 Fluo HTML 페이지를 유지할 구체적인 이유가 있을 때만 renderer를 함께 등록한다. 이 장의 인쇄 문서는 안정 SSR 경로이며 실험적 RSC subpath를 Next의 Flight 구현과 혼합하지 않는다. 같은 React라는 이름보다 응답·자산·탐색의 소유권이 중요하다.

이제 어댑터가 해야 할 일과 하면 안 되는 일이 충분히 드러났다. 다음 장에서는 새로운 웹 프레임워크를 만드는 대신, 이미 제공되는 Web factory를 재사용하는 작은 host-owned adapter를 직접 만든다. 그런 다음 “컴파일된다”와 “계약을 지킨다” 사이의 차이를 테스트로 확인한다.

## 근거와 재현 범위

- [Next.js README](../../packages/platform-nextjs/README.ko.md), [공개 export](../../packages/platform-nextjs/src/index.ts), [package subpath와 peer 범위](../../packages/platform-nextjs/package.json).
- [Next adapter 구현](../../packages/platform-nextjs/src/adapter.ts), [lazy loader 캐시](../../packages/platform-nextjs/src/lazy-adapter.ts), [config helper](../../packages/platform-nextjs/src/next-config.ts).
- [Pages bridge](../../packages/platform-nextjs/src/pages-bridge.ts), [Pages transport 테스트](../../packages/platform-nextjs/src/pages-bridge.test.ts), [Web portability 테스트](../../packages/platform-nextjs/src/portability.test.ts), [실제 Next E2E](../../packages/platform-nextjs/e2e/next.test.mjs).
- [React README](../../packages/react/README.ko.md), [공개 export](../../packages/react/src/index.ts), [ReactModule 등록](../../packages/react/src/module.ts), [dispatcher SSR 테스트](../../packages/react/src/dispatcher-ssr.test.ts).

본문의 테스트와 브라우저 절차는 예상 결과를 명시한 재현 자료다. 원고 작성 중 새 Next 앱의 build·브라우저·배포 검증을 실행해 통과했다고 주장하지 않는다.

[이전: Fetch 기반 런타임으로 이동하기](./ch14-fetch-adapters.ko.md) · [목차](./toc.ko.md) · [다음: 직접 어댑터를 만들고 계약 검증하기](./ch16-custom-adapter.ko.md)
