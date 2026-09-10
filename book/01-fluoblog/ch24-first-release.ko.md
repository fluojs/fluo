# 첫 출시와 첫 운영 회고

<!-- book:volume=01-fluoblog;chapter=24 -->

[이전: 시작하고 종료하는 순간까지 설계하기](./ch23-lifecycle-and-readiness.ko.md) · [1권 목차](./toc.ko.md) · [다음 권: 기존 블로그에 상점을 붙이기](../02-fluoshop/ch01-grow-the-blog.ko.md)

운영자는 이제 “글 하나를 반환하는 서버”보다 훨씬 많은 것을 만들었다. 작성자는 계정으로 로그인해 초안을 고치고, 검토한 글을 발행하거나 시간을 예약한다. 독자는 공개된 글을 읽고 새 글 알림을 구독한다. 캐시는 인기 글의 읽기 부담을 줄이고, 지표와 요청 기록은 느린 응답의 범위를 알려 준다. 배포를 위해 인스턴스를 시작하고 종료하는 경계도 생겼다.

그렇다고 첫 출시는 모든 기능이 완벽해졌다는 선언이 아니다. 어떤 사용자 여정을 제공하고, 어떤 실패를 감지하며, 실패했을 때 어디까지 복구할 수 있는지 확인한 버전을 실제 독자에게 여는 결정이다. 이 장은 새로운 프레임워크 기능을 많이 추가하는 대신 앞 장의 약속을 하나의 출시 기준으로 묶는다. 특히 테스트가 증명한 사실과 아직 검증하지 않은 운영 가정을 같은 칸에 적지 않는다.

다음의 “첫 주” 사건은 회고 방법을 설명하기 위한 가상 상황이다. 이 원고를 집필하며 실제 서비스를 배포하거나 독자에게 메일을 보내지 않았다. 저장소에 24개 장의 모든 기능이 완성된 단일 앱이 이미 존재한다는 뜻도 아니다. 독자가 앞 장의 부분 구현을 자신의 `fluo-blog`에 합친 결과가 출시 대상이며, `examples/fluo-blog`는 그보다 작은 초기 HTTP·DI 확인 경로다.

## 출시 범위를 사용자 문장으로 고정하기

첫 출시의 중심은 게시글이다. 공개 목록과 상세 조회는 발행된 글만 보여 준다. 작성자는 자기 초안만 수정하며 발행된 본문은 불변이다. 게시글 ID는 양의 정수, 계정 ID와 `authorId`는 문자열이라는 계약을 유지한다. 수정 요청에 실린 `authorId`나 로그인 화면의 표시 이름으로 소유권을 판단하지 않는다. 검증된 JWT subject가 같은 계정 정체성을 다음 권까지 연결한다.

이 약속을 HTTP 상태만으로 검사하면 빈틈이 남는다. 다른 작성자의 초안 수정에 403을 반환하면서 내부적으로 내용을 바꿨다면 안전하지 않다. 발행본 수정에 409를 반환해도 `version`이나 `publishedAt`이 바뀌면 불변 계약을 깨뜨린다. 따라서 실패 응답의 검사에는 변경 전후 데이터 비교가 붙는다. 본문이 같다는 것뿐 아니라 버전, 예약 시각, 발행 기록 수가 보존되는지도 본다.

예약 발행의 성공도 “Cron callback이 실행됐다”가 아니다. 기한 전에는 초안이 공개되지 않고, 기한 뒤에는 유효한 버전 하나만 공개되며, 재실행과 재시작 후에도 발행 기록이 중복되지 않아야 한다. 캐시가 있다면 DB 공개 시각과 독자가 새 목록을 보는 시각의 차이를 제품의 지연 예산으로 설명한다. 구독 알림은 게시글 공개와 별개의 전달 상태를 가진다. 알림 실패 때문에 공개 상태를 취소하지도, 공개 성공을 이유로 모든 수신 성공을 선언하지도 않는다.

여기서 기능을 계속 추가하고 싶은 유혹이 생긴다. 추천 알고리즘, 모든 지역의 CDN, 실시간 협업 편집은 유용할 수 있지만 이번 약속을 증명하는 데 필요한 것은 아니다. 출시 범위를 좁힌다는 것은 실패를 무시한다는 뜻이 아니라, 실제로 제공하는 기능의 실패를 끝까지 확인할 시간을 확보한다는 뜻이다.

## 증거의 종류를 섞지 않는 테스트 구성

도메인 테스트는 초안에서 발행본으로 가는 규칙과 버전 충돌을 빠르게 확인한다. DB 통합 테스트는 조건부 업데이트와 트랜잭션 롤백을 실제 PostgreSQL에서 확인한다. 요청 테스트는 인증·인가·검증·응답 변환이 HTTP 파이프라인에서 함께 작동하는지 확인한다. 마지막으로 실제 Fastify listener 시험은 포트, header, 종료 signal, 응답 전송이라는 호스트 경계를 확인한다.

`@fluojs/testing`의 `createTestApp`는 세 번째 경계의 기본 도구다. `request(...).send()`가 runtime dispatch와 요청 범위 DI를 실행하므로 controller 메서드를 직접 부르는 것보다 강한 증거를 준다. 하지만 실제 TCP 연결이나 PostgreSQL을 자동으로 만들어 주지는 않는다. 대역을 주입한 경우 그 대역 밖의 시스템은 검증되지 않았다고 남긴다.

`createTestingModule`은 DI 가시성과 provider 교체가 주제일 때 선택한다. `.compile()` 전에 `overrideProvider`나 `overrideModule`로 외부 경계를 바꾸고, 실제로 쓰는 root module을 명시한다. Bootstrap과 lifecycle hook도 실행되므로 테스트 종료 시 컨테이너를 정리한다. 테스트의 cleanup을 선택 사항으로 두면 다음 테스트가 이전 연결이나 timer 때문에 통과하거나 실패할 수 있다.

중요한 것은 모든 레벨에서 같은 테스트를 복사하지 않는 일이다. 요청 테스트에서 수십 가지 날짜 문자열을 다시 나열할 필요는 없지만, 검증 실패가 400으로 매핑되고 서비스의 쓰기 경로에 도달하지 않는지는 확인해야 한다. DB 테스트를 메모리 배열의 업데이트로 바꾸고 “동시 발행에 안전하다”고 이름 붙이는 것도 피한다. 실제 동시성의 증거는 실제 저장소 경계에서 얻는다.

## 운영 경계를 한 요청 시험으로 묶기

이제 22장의 관측 모듈과 23장의 트래픽 gate를 함께 사용한다. 아래 `src/operations/release-boundary.spec.ts`는 **완전한 로컬 시험 파일**이다. 앞 장에서 작성한 `createObservabilityModule`, `TrafficGate`, `TrafficIndicator`, `TrafficMiddleware` 파일과 표준 데코레이터용 Vitest 설정이 필요하다.

이 시험은 전체 게시글 앱의 인수 테스트가 아니라 운영 구성의 좁은 통합 시험이다. `ReadProbeController`는 DB 대신 수동 신호로 완료 시점을 제어한다. Terminus의 선택적 진단은 메일 시스템을 실제로 호출하지 않는 상태 대역이다. 반면 gate, middleware, endpoint 등록, Registry와 요청 dispatch는 실제 코드를 사용한다. 그래서 트래픽 차단을 준비 상태와 연결하지 않았거나 내부 endpoint까지 차단해 버리는 회귀를 잡을 수 있다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { createTestApp } from '@fluojs/testing';
import { TerminusModule } from '@fluojs/terminus';
import { expect, it } from 'vitest';
import { createObservabilityModule } from '../observability/observability.module.js';
import {
  TrafficGate,
  TrafficIndicator,
  TrafficMiddleware,
} from './traffic.js';

it('keeps diagnostics available while admitted work drains', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const gate = new TrafficGate();
  const READ_POST = Symbol('release.read-post');
  let reads = 0;

  interface PublicPost {
    id: number;
    title: string;
    content: string;
    slug: string;
  }
  type ReadPost = () => Promise<PublicPost>;

  @Module({
    providers: [{ provide: TrafficGate, useValue: gate }],
    exports: [TrafficGate],
  })
  class TestTrafficModule {}

  @Controller('/posts')
  @Inject(READ_POST)
  class ReadProbeController {
    constructor(private readonly readPost: ReadPost) {}

    @Get('/:id/read')
    async read(): Promise<PublicPost> {
      return this.readPost();
    }
  }

  @Module({
    imports: [
      TestTrafficModule,
      createObservabilityModule('local-release-token'),
      TerminusModule.forRoot({
        path: '/internal',
        imports: [TestTrafficModule],
        indicatorProviders: [TrafficIndicator],
        indicators: [{
          key: 'notification-history',
          readiness: false,
          async check(key) {
            return { [key]: { status: 'down' } };
          },
        }],
      }),
    ],
    controllers: [ReadProbeController],
    providers: [
      TrafficMiddleware,
      {
        provide: READ_POST,
        useValue: async (): Promise<PublicPost> => {
          reads += 1;
          entered.resolve();
          await release.promise;
          return {
            id: 1,
            title: 'Hello, Fluo!',
            content: 'My first post.',
            slug: 'hello-fluo',
          };
        },
      },
    ],
  })
  class ReleaseProbeModule {}

  const app = await createTestApp({
    rootModule: ReleaseProbeModule,
    middleware: [TrafficMiddleware],
  });
  let first: ReturnType<ReturnType<typeof app.request>['send']> | undefined;
  try {
    expect((await app.request('GET', '/internal/health').send()).status).toBe(503);
    expect((await app.request('GET', '/internal/ready').send()).status).toBe(200);

    first = app.request('GET', '/posts/1/read').send();
    await Promise.race([
      entered.promise,
      first.then(() => { throw new Error('Read finished before reaching its handler.'); }),
    ]);
    gate.stopAccepting();

    const readiness = await app.request('GET', '/internal/ready').send();
    expect(readiness.status).toBe(503);
    expect(readiness.body).toEqual({ status: 'unavailable' });
    expect((await app.request('GET', '/posts/2/read').send()).status).toBe(503);
    expect(reads).toBe(1);

    release.resolve();
    expect((await first).status).toBe(200);
    await gate.waitForIdle();

    expect((await app.request('GET', '/internal/metrics').send()).status).toBe(403);
    const scrape = await app.request('GET', '/internal/metrics')
      .header('x-metrics-token', 'local-release-token')
      .send();
    expect(scrape.status).toBe(200);
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id/read",status="200"} 1',
    ));
  } finally {
    release.resolve();
    try {
      await first;
    } finally {
      await app.close();
    }
  }
}, 5_000);
```

처음의 `/health = 503`, `/ready = 200`은 모순이 아니다. 시험에 등록한 선택적 진단만 down이고 gate는 열려 있다. 실제 운영에서도 이 차이를 허용하려면 해당 의존성 없이 계속 제공할 기능이 명확해야 한다. 이 대역을 근거로 실제 구독 큐까지 선택 사항이라고 결론 내리지 않는다.

두 번째 구간은 종료 준비다. 첫 요청이 handler에 들어왔다는 신호를 받은 뒤 gate를 닫는다. 그래서 테스트 결과가 우연히 요청 실행 순서에 의존하지 않는다. 두 번째 요청은 503이어야 하고 저장소 대역의 호출 수도 늘지 않아야 한다. 첫 요청은 release 신호를 받은 뒤 정상 완료된다. readiness가 unavailable이라고 이미 수용한 요청까지 모두 실패시켜야 하는 것은 아니다.

마지막 scrape는 트래픽 차단 상태에서도 가능해야 한다. 지표를 운영자에게 보여 주는 경로까지 gate로 차단하면 바로 그 사건을 관측할 수 없어진다. 다만 접근 정책은 유지하므로 토큰 없는 요청은 403이다. 성공한 게시글 요청 하나가 template 라벨에 기록됐다는 assertion은 MetricsModule이 같은 HTTP 파이프라인에 연결됐다는 증거다. 지표 문자열 전체나 help 문구를 고정하지 않고 필요한 machine-consumed 시계열만 확인한다.

이 시험에서 앱을 닫는 시점은 진행 중 요청을 해제한 뒤다. assertions가 실패해도 `finally`가 release와 close를 수행한다. 운영에서 관찰할 종료 경계를 테스트 자원에도 적용하는 것이다. 단, 테스트의 5초 상한은 오류로 인한 무한 대기를 제한하는 값이지 5초 동안 기다리면 성공한다는 조건이 아니다.

## 실제 AppModule을 여는 인수 fixture

위의 ReadProbeController는 운영 경계만 검증한다. 다음 **`test/release-app.spec.ts` 전체**는 독자가 9~23장의 변경을 합친 실제 `src/app.ts`를 import하고 Fastify listener를 연다. 테스트 전용으로 AccountsModule이나 PostsModule을 다시 정의하지 않는다. 17장의 FormsAuthModule·FormsPagesModule, 18장의 업로드, 19장의 SubscriptionsModule, 20장의 읽기 캐시, 21장의 예약 API, 22~23장의 관측·운영 등록이 그 그래프에 모두 남아 있어야 한다.

실행 전 조건은 마이그레이션한 **빈 전용 PostgreSQL**, 로컬 `127.0.0.1:6379`의 **격리된 연습용 Redis**, 22장에서 유지한 RecordingEmailTransport다. 실제 SMTP transport로 바꾼 앱에서는 이 시험을 실행하지 않는다. 기존 `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_ORIGIN`, `PORT`를 9·14·17장의 검증 계약대로 설정하고, 선택적 `METRICS_TOKEN`, `HEALTH_TOKEN`도 비어 있지 않은 테스트 값으로 전달한다. `NODE_ENV=production`이면 파일 입력 대신 프로세스 입력으로 기존 필수 설정을 모두 준비한다. fixture는 계정·글·첨부·미확인 구독을 전용 DB에 남겨 검사하게 하며 운영 데이터를 지우지 않는다.

```typescript
import { FluoFactory } from '@fluojs/runtime';
import { createConsoleApplicationLogger } from '@fluojs/platform-nodejs';
import { randomUUID } from 'node:crypto';
import { ensureMetadataSymbol } from '@fluojs/core';
import { createCorrelationMiddleware } from '@fluojs/http';
import { FastifyHttpApplicationAdapter } from '@fluojs/platform-fastify';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('keeps auth, uploads, subscriptions and operations in the assembled app', async () => {
  ensureMetadataSymbol();
  const { AppModule } = await import('../src/app.js');
  const { blogConfig } = await import('../src/config/app-settings.module.js');
  const { operationsConfig } = await import('../src/config/operations-config.js');
  const { blogAccessObserver } = await import('../src/observability/access-log.js');
  const { TrafficGate, TrafficMiddleware } = await import('../src/operations/traffic.js');
  const { FORM_COOKIE_NAME } = await import('../src/auth/forms-auth.module.js');
  const metricsToken = operationsConfig.METRICS_TOKEN;
  const healthToken = operationsConfig.HEALTH_TOKEN;
  if (!metricsToken || !healthToken) throw new Error('Set both test operations tokens.');

  const listening = Promise.withResolvers<string>();
  const app = await FluoFactory.create(AppModule, {
    adapter: FastifyHttpApplicationAdapter.create({
      host: '127.0.0.1',
      port: 0,
      maxBodySize: 6 * 1024 * 1024,
      multipart: {
        maxFileSize: 5 * 1024 * 1024, maxFiles: 1, maxTotalSize: 6 * 1024 * 1024,
      },
      shutdownTimeoutMs: 5_000,
      configureFastify(server) {
        server.addHook('onListen', async () => {
          const address = server.server.address();
          if (!address || typeof address === 'string') {
            listening.reject(new Error('Expected a TCP listen address.'));
            return;
          }
          listening.resolve(`http://127.0.0.1:${address.port}`);
        });
      },
    }),
    middleware: [createCorrelationMiddleware(), TrafficMiddleware],
    observers: [blogAccessObserver],
    logger: createConsoleApplicationLogger(),
  });
  try {
    await app.listen();
    const base = await listening.promise;
    const prisma = await app.get<PrismaService<PrismaClient>>(PrismaService);
    const gate = await app.get(TrafficGate);
    async function request(path: string, init: RequestInit = {}) {
      const response = await fetch(new URL(path, base), {
        ...init, redirect: 'manual', signal: AbortSignal.timeout(5_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      const body: unknown = response.headers.get('content-type')?.includes('application/json')
        ? JSON.parse(text) : text;
      return { status: response.status, headers: response.headers, body, bytes };
    }
    function form(fields: Record<string, string>): FormData {
      const data = new FormData();
      for (const [key, value] of Object.entries(fields)) data.set(key, value);
      return data;
    }

    const suffix = randomUUID();
    const credentials = { email: `writer-${suffix}@example.test`, password: 'test-only-long-password' };
    const register = await request('/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...credentials, displayName: 'Release fixture' }),
    });
    expect(register.status).toBe(201);
    const login = await request('/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    expect(login.status).toBe(200);
    const session = z.object({
      accessToken: z.string().min(1), user: z.object({ id: z.string().min(1) }),
    }).parse(login.body);
    const apiHeaders = {
      'content-type': 'application/json', authorization: `Bearer ${session.accessToken}`,
    };
    const browserLogin = await request('/auth/forms/login', {
      method: 'POST', headers: { origin: blogConfig.PUBLIC_ORIGIN },
      body: form({ ...credentials, next: '/posts' }),
    });
    expect(browserLogin.status).toBe(303);
    const cookie = browserLogin.headers.getSetCookie()
      .find((value) => value.startsWith(`${FORM_COOKIE_NAME}=`))?.split(';')[0];
    if (!cookie) throw new Error('The form login did not issue its access cookie.');
    const formHeaders = { cookie, origin: blogConfig.PUBLIC_ORIGIN };

    const created = await request('/posts', {
      method: 'POST', headers: apiHeaders,
      body: JSON.stringify({ title: '', content: '', slug: '' }),
    });
    expect(created.status).toBe(201);
    const draft = z.object({ id: z.number().int().positive(), version: z.literal(1) }).parse(created.body);
    const postPath = `/posts/${draft.id}`;
    expect((await request(`${postPath}/read`)).status).toBe(404);
    expect((await request(`${postPath}/edit`)).status).toBe(401);
    expect((await request(`${postPath}/edit`, { headers: { cookie } })).status).toBe(200);

    const text = { title: 'Release fixture post', content: 'Preserve every registered feature.', slug: `release-${suffix}` };
    expect((await request(`${postPath}/edit`, {
      method: 'POST', headers: formHeaders, body: form({ ...text, version: '1' }),
    })).status).toBe(303);
    const upload = form({ kind: 'attachment', version: '2' });
    upload.set('file', new Blob([new Uint8Array([1, 2, 3])]), 'fixture.bin');
    expect((await request(`${postPath}/assets`, {
      method: 'POST', headers: formHeaders, body: upload,
    })).status).toBe(303);
    const asset = await prisma.current().postAsset.findFirstOrThrow({ where: { postId: draft.id } });
    expect(asset.size).toBe(3);
    const oversized = form({ kind: 'attachment', version: '3' });
    oversized.set('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), 'too-large.bin');
    expect((await request(`${postPath}/assets`, {
      method: 'POST', headers: formHeaders, body: oversized,
    })).status).toBe(413);
    expect((await prisma.current().post.findUniqueOrThrow({ where: { id: draft.id } })).version).toBe(3);

    expect((await request('/subscriptions', { headers: { cookie } })).status).toBe(200);
    expect((await request('/subscriptions/request', {
      method: 'POST', headers: formHeaders, body: form({ address: credentials.email }),
    })).status).toBe(303);
    const subscription = await prisma.current().subscription.findUniqueOrThrow({ where: { userId: session.user.id } });
    expect(subscription.active).toBe(false);
    expect(subscription.address).toBe(credentials.email);

    expect((await request(`${postPath}/publish`, {
      method: 'POST', headers: apiHeaders, body: JSON.stringify({ expectedVersion: 3 }),
    })).status).toBe(200);
    const published = await prisma.current().post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(published.version).toBe(4);
    const publication = await prisma.current().postPublication.findUniqueOrThrow({ where: { postId: draft.id } });
    expect(publication.actorId).toBe(session.user.id);
    expect(publication.version).toBe(4);
    expect((await request(`${postPath}/publish`, {
      method: 'POST', headers: apiHeaders, body: JSON.stringify({ expectedVersion: 4 }),
    })).status).toBe(409);
    expect(await prisma.current().postPublication.count({ where: { postId: draft.id } })).toBe(1);
    expect((await request(postPath)).status).toBe(200);
    const page = await request(`${postPath}/read`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.body).toEqual(expect.stringContaining(text.title));
    const download = await request(`${postPath}/assets/${asset.id}`);
    expect(download.status).toBe(200);
    expect([...download.bytes]).toEqual([1, 2, 3]);
    expect((await request(postPath, {
      method: 'PUT', headers: apiHeaders, body: JSON.stringify({ ...text, title: 'Changed', expectedVersion: 4 }),
    })).status).toBe(409);
    expect(await prisma.current().post.findUniqueOrThrow({ where: { id: draft.id } })).toEqual(published);

    expect((await request('/internal/health')).status).toBe(403);
    expect((await request('/internal/health', { headers: { 'x-health-token': healthToken } })).status).toBe(200);
    expect((await request('/internal/ready')).status).toBe(403);
    expect((await request('/internal/ready', { headers: { 'x-health-token': healthToken } })).status).toBe(200);
    gate.stopAccepting();
    expect((await request(postPath)).status).toBe(503);
    expect((await request('/internal/ready', { headers: { 'x-health-token': healthToken } })).status).toBe(503);
    expect((await request('/internal/metrics')).status).toBe(403);
    const scrape = await request('/internal/metrics', { headers: { 'x-metrics-token': metricsToken } });
    expect(scrape.status).toBe(200);
    expect(scrape.body).toEqual(expect.stringContaining(
      'http_requests_total{method="GET",path="/posts/:id/read",status="200"} 1',
    ));
    await gate.waitForIdle();
  } finally {
    await app.close('release-fixture');
  }
}, 30_000);
```

fixture의 포트 0은 병렬 개발 서버와 충돌하지 않도록 OS가 빈 포트를 고르는 테스트 설정이다. 23장 production 진입점의 host·`blogConfig.PORT`는 바꾸지 않는다. 테스트는 쿠키와 `Origin`을 직접 보내 서버 정책을 검증하며, 브라우저의 Secure·SameSite 전송을 증명하지 않는다. 모든 응답 바이트는 assertion 전에 읽으므로 이 fixture의 close를 “진행 중 SSR stream의 안전한 종료 시험”으로 부르지도 않는다. 그 종료 경계는 앞의 수동 신호 시험과 실제 signal 실험으로 따로 확인한다.

구독 request의 303과 미확인 행은 구독 라우트·서비스·기록 transport가 남았다는 증거다. 확인 코드·worker·SMTP 수락을 끝까지 검증했다는 뜻은 아니다. 이 fixture는 예약 후보나 활성 구독자를 만들지 않으므로 Cron이 우연히 tick한 시각에 결과가 달라져서는 안 된다. 별도의 예약·메일 시험은 21·22장의 명시적 시각과 callback seam을 사용한다. 빈 전용 DB 조건을 지키지 않으면 이전 실행의 pending 작업이 섞일 수 있다.

```bash
pnpm exec vitest run test/release-app.spec.ts --maxWorkers=1
```

## 인수 시험은 실제 데이터와 사용자로 완성한다

위 운영 시험이 통과해도 출시가 자동 승인되지는 않는다. 자신의 앱에서는 실제 AccountsModule과 PostsModule을 포함한 요청 시험을 별도로 실행한다. 계정 두 개와 초안 두 개를 만들고, 각 계정의 검증된 인증 경로로 요청한다. `.principal(...)`은 인가 경계의 좁은 시험에는 유용하지만 서명 검증을 실행한 증거는 아니다. 로그인과 JWT 검증을 통과하는 시험도 한 번은 있어야 한다.

발행된 글 수정 거절은 특히 중요한 교차 기능 검사다. 작성자 자신의 정상 인증으로 기존 수정 endpoint에 새 제목과 현재 버전을 보내고 409를 확인한다. 이어 DB와 공개 상세 조회에서 제목·본문·slug·`version`·`publishedAt`이 그대로인지 비교한다. 다른 작성자가 같은 요청을 하면 권한 경계의 403이 우선 적용되는지 자신의 API 계약에 맞게 확인한다. 존재하지 않는 글과 미인증 요청의 404·401도 그 계약에 맞춰 검사한다. 실패 status를 어떤 순서로 선택하는지 시험 이름과 API 문서에 남긴다.

예약된 초안을 편집하는 시험은 조금 다르다. 올바른 작성자와 버전으로 수정하면 아직 초안이므로 성공할 수 있지만, 같은 변경에서 예약이 취소돼야 한다. 그 다음 예약 시각 이후에 발행 작업을 실행해도 수정된 글이 자동으로 공개되면 안 된다. 작성자가 새 내용으로 다시 예약한 뒤에만 발행될 수 있다. 이 연결이 빠지면 인가와 Cron 각각의 테스트는 통과해도 제품의 승인 규칙은 깨진다.

중복 요청과 장애도 사용자 여정으로 연결한다. 같은 예약 후보를 두 인스턴스가 읽게 하고 발행 기록이 하나인지 검사한다. 발행 기록 삽입을 실패시키면 공개 상태가 롤백돼야 한다. 캐시가 오래된 목록을 반환하는 동안에도 비공개 초안의 상세 조회가 공개되어서는 안 된다. 구독 작업의 외부 전송은 대역으로 기록하고 동일한 전달 키의 중복 처리 정책을 확인한다. 테스트 단계에서 실제 독자 주소로 보내지 않는다.

이러한 시험에는 전용 PostgreSQL과, 해당 기능이 사용하는 경우 전용 Redis가 필요하다. 운영 연결 문자열을 복사해 테스트하지 않는다. 테스트 대역으로 실행한 결과와 실제 DB에서 얻은 결과를 각각 적는다. 아직 환경을 준비하지 못한 항목을 “코드상 문제없음”으로 통과 처리하지 않으며, 해당 기능을 이번 출시에서 제공하려면 그 증거를 채운 뒤 결정한다.

## 배포물을 만드는 과정도 제품의 일부다

소스가 아니라 동일한 빌드 산출물을 검증하고 배포한다. Node.js 24와 pnpm 10, lockfile, 실제 생성된 Prisma client, 시작 진입점을 함께 기록한다. 테스트 환경에서는 개발 서버가 내부적으로 변환해 주던 데코레이터가 운영 실행에서는 변환되지 않는 일이 없도록, 실제 production build의 `src/main.ts`에 대응하는 산출물을 실행한다. 지원 범위가 `>=24.0.0 <27`이라고 해서 이 책의 실행 기준을 매번 다른 Node 버전으로 바꾸지 않는다.

앱의 배포와 Fluo 패키지의 npm 출시는 별개의 작업이다. 이 장은 독자가 만든 앱을 운영할 준비를 다루며 `@fluojs/*`를 로컬에서 publish하는 절차가 아니다. 패키지 버전과 릴리스는 저장소의 Changesets·GitHub Actions 정책을 따른다. 앱 운영을 시작하기 위해 프레임워크 패키지를 다시 발행할 필요는 없다.

DB 변경은 새 앱 시작과 분리해서 생각한다. 이전 코드와 새 코드가 잠시 공존할 수 있다면 추가한 nullable 예약 필드와 발행 기록이 양쪽에서 어떤 의미를 갖는지 확인한다. 스키마를 확장하고 새 코드가 사용하도록 한 뒤 불필요한 구 구조를 나중에 제거하는 순서는 한 번에 열 이름을 바꾸는 것보다 되돌리기 쉽다. DB 마이그레이션을 되돌린다는 명령이 사용자 데이터를 복원해 준다고 가정하지 않는다.

백업도 파일이 존재하는 것만으로 충분하지 않다. 운영과 분리된 DB로 복원한 뒤 게시글·계정·발행 기록의 연결과 실제 조회를 확인해야 한다. 어느 시점까지 복구되는지, 복구 중 들어온 변경은 어디서 확인할지, 구독 전달 이력과 DB 상태가 어긋났을 때 무엇을 다시 처리할지 적는다. 복원 절차는 처음 장애가 난 날 처음 실행해 보는 명령이어서는 안 된다.

단일 인스턴스의 첫 출시라면 짧은 중단 시간을 공지하고 검증한 산출물로 교체하는 선택도 현실적이다. 여러 인스턴스를 운용한다면 새 인스턴스의 readiness를 확인한 뒤 트래픽을 옮기고, 이전 인스턴스는 23장의 gate와 종료 순서로 정리한다. 이 원고는 실제 트래픽 전환이나 인프라 변경을 실행하지 않는다. 어떤 방식을 선택하든 실제 listener에서 공개 조회, 인증 실패, 내부 endpoint 접근, 종료 중 요청을 확인해야 한다.

## 첫 주의 숫자를 해석하고 중단 기준을 정하기

출시 전에는 비교할 기준 구간을 남긴다. 같은 데이터 크기와 요청 형태에서 상세 조회 지연, 서버 오류 비율, 예약 작업 시간, 기한이 지난 예약 글의 수를 기록한다. 초기에는 표본이 적으므로 “p95가 얼마 이하면 영원히 안전하다”는 식의 목표보다 어떤 사용자 불편을 탐지할지 설명하는 것이 중요하다. 공개 읽기의 300밀리초 경계를 택했다면 그 값은 22장의 histogram 버킷과도 맞춰 둔다.

장애 대응 기준은 관측값을 행동으로 연결한다. 예를 들어 새 버전에서 같은 경로의 5xx가 계속 증가하고 이전 버전에서는 재현되지 않는다면 새 트래픽 확대를 멈추고 원인을 조사한다. 모든 인스턴스가 같은 DB 오류로 unavailable이면 무작정 앱을 반복 재시작하지 않는다. readiness가 내려간 이유와 DB 자체의 상태를 먼저 분리한다. 개별 버전의 문제인지 공유 의존성의 문제인지에 따라 롤백의 효과가 다르다.

역시 scrape 성공을 업무 성공으로 해석하지 않는다. `/internal/metrics`가 200이어도 예약 작업이 한 번도 실행되지 않았을 수 있다. 작업 counter가 증가해도 오래된 예약 후보 하나가 실패하며 남아 있을 수 있다. `/health`가 503이어도 명시적으로 선택 사항인 진단만 실패했다면 공개 조회는 정상일 수 있다. 지표, readiness, 영속 기록은 서로 다른 질문의 답이므로 운영 화면에서도 구분한다.

출시 기록에는 적어도 산출물 식별자, 적용한 스키마 변경, 실제로 실행한 테스트 명령과 결과, 실제 listener 확인 결과, 남은 제약, 되돌릴 대상 산출물을 담는다. 명령 목록만 적고 결과를 비워 두는 것은 증거가 아니다. 실패한 체크를 다시 실행했다면 무엇을 바꾸고 어떤 결과가 달라졌는지도 함께 남긴다. 설명 문구의 예쁨보다 다음 운영자가 같은 사실을 재확인할 수 있는지가 중요하다.

## 회고는 원인을 사람 이름 대신 경계에 붙인다

가상의 첫 주 월요일을 보자. 예약 글은 DB에 오전 9시 00분 18초에 공개됐지만 한 독자의 목록에는 잠시 보이지 않았다. 최초 대응에서는 Cron 장애라고 생각했다. 실제 발행 기록은 하나였고 예약 작업은 정상 완료됐다. 상세 조회는 새 글을 반환했지만, 목록은 앞 장의 TTL 동안 이전 캐시를 사용했다. 이 사건의 원인은 “운영자가 예약을 잘못했다”가 아니라 공개 시각과 목록 가시성의 약속을 분리해 알리지 않은 것이다.

회고에는 먼저 사용자가 본 현상과 시간 순서를 쓴다. 다음으로 확인된 사실을 적고, 확인되지 않은 가설을 별도로 둔다. 위 사건에서 확인된 사실은 발행 기록과 상세 응답, 캐시 잔여 시간이다. 캐시 무효화 실패를 직접 관측하지 않았다면 그것을 원인으로 단정하지 않는다. 단순한 TTL 동작인지 전달 작업 누락인지에 따라 바꿔야 할 코드가 다르다.

개선 작업도 구체적인 경계에 붙인다. 제품 문구에는 예약 처리와 가시성 지연을 구분하고, 운영 조회에는 가장 오래된 미처리 예약의 나이를 추가할 수 있다. 무효화 경로에 실제 결함이 있었다면 그 실패를 재현하는 테스트와 함께 수정한다. 모든 캐시를 제거하거나 모든 작업을 새 메시지 시스템으로 옮기는 결론은 이 한 사건에서 나오지 않는다.

다른 날 배포 종료 시간이 예산을 넘겼다면 “timeout을 더 크게”가 첫 결론이 되어서는 안 된다. HTTP gate 대기인지 Cron 작업인지 DB 트랜잭션 drain인지 adapter close인지 먼저 구간을 나눈다. 장기 실행 하나가 원인이면 배치를 줄이는 선택을 검토한다. 클라이언트가 응답을 못 받았더라도 발행은 커밋됐을 수 있으므로 재처리 전에 영속 기록을 확인한다. 실패의 원인 분석과 데이터 복구 판단을 같은 로그 한 줄에 맡기지 않는다.

회고의 끝에는 다음 출시에서 확인할 작은 변화가 남아야 한다. 담당자와 완료 조건, 검증 방법을 적는다. “관측 강화” 대신 “예약 시각을 넘긴 초안이 존재할 때 그 수와 가장 오래된 시각을 운영 조회에서 확인하고, 빈 결과와 한 건 적체를 시험한다”처럼 쓴다. 이렇게 축적한 설명 능력이 이후 상점 기능의 더 복잡한 실패를 다룰 기반이 된다.

## 블로그가 성공한 다음에 만드는 것

첫 권은 여기서 끝나지만 제품은 끝나지 않는다. 독자들은 글을 즐겨 읽기 시작했고, 댓글과 구독 답장에서 로고 티셔츠와 스티커를 요청한다. 이 요구 때문에 다음 권에서 상점이 생긴다. 실패한 블로그를 버리고 관계없는 쇼핑몰을 새로 만드는 이야기가 아니다.

계정 ID와 JWT subject, 작성자·독자의 정체성, PostgreSQL과 Prisma, 설정과 배포 진입점, 관측 모듈과 readiness 정책은 그대로 가져간다. AccountsModule과 PostsModule을 다시 만들지 않는다. 고객 정보는 기존 계정에 확장하고 상품·재고·장바구니·주문이라는 새 책임을 필요한 순서대로 추가한다. 처음에는 같은 프로세스 안의 모듈형 모놀리스로 시작한다.

예약 발행에서 익힌 “시간은 트리거이고 데이터가 원본”이라는 생각은 미완료 주문을 다시 맞추는 작업으로 이어진다. 발행 기록과 메일 전달을 분리한 경험은 결제·배송·알림의 부분 실패를 이해하는 데 쓰인다. 제한된 지표 라벨과 요청 ID, 준비 상태와 수명주기 경계는 판매 이벤트가 몰릴 때도 같은 기반이 된다. 다만 주문과 돈의 정합성은 게시글의 규칙보다 강한 요구를 만들며 다음 권에서 따로 설계한다.

첫 출시의 완료 조건은 미래의 상거래까지 미리 구현하는 것이 아니다. 지금 약속한 블로그의 사용자 여정이 확인되고, 그 확인의 범위가 기록되며, 운영 중 발견한 사실을 다음 변경으로 이어갈 수 있으면 된다. 성공한 같은 블로그에 작은 상품 목록을 붙이는 일부터 다음 권을 시작한다.

## 검증 범위와 구현 근거

원고 통합 검토에서는 코드·공개 API를 대조하고, 코드 블록을 메모리에서 변환해 기존 패키지 산출물과 연결한 좁은 요청·Cron·lifecycle 시험 6개를 통과했다. 전역 async Prisma 등록과 Terminus 접근 경계도 드라이버 대역으로 확인했다. 운영 코드와 좁은 시험의 TypeScript strict 검사에서는 외부 애플리케이션 연결부 4개를 선언용 대역으로 둔 17개 가상 파일에서 진단이 없었다. 이는 생성된 Prisma 모델을 포함한 전체 앱 typecheck가 아니다. 위 `test/release-app.spec.ts`, 실제 PostgreSQL·Redis·SMTP·브라우저·SIGTERM 시험은 실행하지 않았다. 한국어 book 구조 검사 `pnpm book:check:ko`는 72장 통과했으며 전체 governance·package build suite는 재실행하지 않았다. 독자 앱에서는 `pnpm exec vitest run src/operations/release-boundary.spec.ts test/release-app.spec.ts --maxWorkers=1`로 좁은 gate 시험과 실제 조립 앱 fixture를 모두 검증하고, 별도 브라우저·메일·signal 실험으로 보완한다. 본문의 가상 출시와 회고는 실행 결과가 아니다.

- [공식 테스트 도구와 request-level 시험 경계](../../packages/testing/README.ko.md)
- [createTestApp의 bootstrap·dispatch·close 구현](../../packages/testing/src/app.ts)
- [테스트 앱과 provider override의 공개 타입](../../packages/testing/src/types.ts)
- [테스트 계층과 lifecycle 정리 계약](../../docs/contracts/testing-guide.ko.md)
- [Metrics의 HTTP·Registry·platform telemetry 계약](../../packages/metrics/README.ko.md)
- [scrape와 접근 거절의 요청 테스트](../../packages/metrics/src/metrics-module.request.test.ts)
- [Terminus의 진단·readiness 참여 계약](../../packages/terminus/README.ko.md)
- [indicator 결과와 진단 집계 테스트](../../packages/terminus/src/health-check.test.ts)
- [시작·종료 순서와 호스트 소유권](../../docs/architecture/lifecycle-and-shutdown.md)
