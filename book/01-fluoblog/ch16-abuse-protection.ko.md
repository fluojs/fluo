# 정상 사용자와 서비스 보호하기

<!-- book:volume=01-fluoblog;chapter=16 -->

[이전: 누가 이 글을 수정할 수 있는가](./ch15-authorization.ko.md) · [1권 목차](./toc.ko.md) · [다음: 독자가 볼 페이지와 작성자가 쓸 화면 만들기](./ch17-react-reading-and-writing.ko.md)

## 모든 요청이 올바르게 실패해도 서비스는 느려진다

FluoBlog의 로그인 오류율이 갑자기 높아졌다. 운영자는 앞 장의 테스트를 다시 확인한다. 잘못된 비밀번호는 401이고, 다른 사람의 글 수정은 403이다. 데이터도 바뀌지 않는다. 그런데 정상 기고자는 로그인 화면에서 오래 기다리고, 글 저장도 늦어진다. 같은 클라이언트가 비밀번호 후보를 바꾸며 계속 요청하고 있었다. 실패 요청 하나마다 계정을 조회하고 비싼 비밀번호 해시를 계산하니, 올바른 거절을 반복하는 것만으로도 자원이 소모된다.

인가와 속도 제한은 다른 질문에 답한다. 인가는 “이 사람이 이 작업을 해도 되는가”를 묻고 속도 제한은 “지금 이 요청에 자원을 써도 되는가”를 묻는다. 정상 계정도 저장 버튼을 연타할 수 있고, 익명 사용자는 로그인 전에 제한되어야 한다. 13장의 해시 비용을 낮추는 방식으로 이 문제를 해결하면 유출된 해시를 추측하기도 쉬워진다. 비싼 작업 앞에 허용량을 두고, 거절당한 정상 사용자에게는 언제 다시 시도할 수 있는지 알려 주자.

이 장은 단일 Node.js 24 프로세스에서 명시적으로 동작하는 제한부터 추가한다. `@fluojs/throttler`는 라우트별 정책을 가드 단계에서 강제하고, `@fluojs/http`는 가드 실행과 429 응답을 연결한다. 뒤에서 여러 인스턴스로 늘릴 때 달라지는 저장소 계약을 설명하지만 지금 Redis를 설치하거나 운영 인프라를 변경하지 않는다. 같은 블로그의 인증·게시글 모듈을 보호하는 것이 목적이지 별도의 보안 서비스를 새로 만드는 것이 아니다.

## 먼저 제한의 단위를 정하기

로그인에는 한 클라이언트가 60초 창 안에서 5번, 가입에는 300초 창 안에서 3번, 글 수정에는 60초 창 안에서 20번을 허용한다. 이 값은 운영 데이터가 없는 초기 제품의 시작 정책이다. 로그인 다섯 번은 매분 정각에 일괄 초기화하는 달력 분이 아니라 첫 요청에서 시작하는 고정된 시간 창이다. 요청이 계속 들어온다고 만료 시각이 뒤로 밀리지는 않는다.

현재 기본 클라이언트 식별자는 신뢰할 수 있는 연결 주소다. 계정 이름으로만 로그인 횟수를 제한하면 공격자가 피해자의 이메일로 요청을 반복해 그 계정의 로그인 자체를 막을 수 있다. 반대로 IP만 제한하면 같은 학교나 회사의 NAT 뒤에 있는 여러 사람이 허용량을 공유한다. 어떤 키도 사람을 완벽하게 나타내지 못한다. 그래서 로그인·가입의 낮은 한도와 글 수정의 더 높은 한도를 분리하고, 운영 때 오탐과 요청 비용을 같이 관찰한다.

카운터에는 라우트 식별자도 들어간다. `/auth/login`의 예산을 사용했다고 `/auth/register` 예산이 똑같이 줄어들지는 않는다. 또한 `PUT /posts/:id`는 게시글 ID마다 별도 예산을 주는 것이 아니라 그 핸들러의 예산을 공유한다. 실제 요청 경로에 있는 숫자를 키로 써서 공격자가 글 ID를 바꾸며 새 버킷을 만들게 하지 않는다. 전체 API에 하나의 카운터를 두는 것과 각 라우트에 제한을 두는 것도 다른 선택이다.

현재 Fluo의 `Throttle` 정책은 하나의 `{ ttl, limit }`이다. `ttl`의 단위는 초이며 양의 유한 정수여야 한다. 다른 프레임워크의 밀리초 값을 그대로 옮겨 `ttl: 60_000`으로 쓰면 1분이 아니라 60,000초가 된다. 짧은 순간의 폭주 제한과 장기간 총량 제한을 동시에 선언하는 이름 있는 다중 창 API는 제공하지 않는다. 필요하다면 서로 다른 제한 계층을 명시적으로 조합해야 하며, 같은 메서드에 데코레이터를 반복해서 쓰면 창 두 개가 생긴다고 가정하지 않는다.

## 모듈 등록과 실제 실행을 구별하기

다음은 **완전한 파일 `src/protection/protection.module.ts`**이다. 저장소를 생략하면 가드 인스턴스가 메모리 카운터를 소유한다. 등록 옵션을 나중에 수정해 실시간으로 정책을 바꾸는 방식은 사용하지 않는다. 현재 계약은 등록 때 값을 검증하고 캡처하므로 정책 변경은 새 설정으로 애플리케이션을 구성하는 작업이다.

```ts
import { Module } from '@fluojs/core';
import { ThrottlerModule } from '@fluojs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 30,
      global: true,
      trustProxy: false,
    }),
  ],
})
export class ProtectionModule {}
```

`src/app.ts`에서 `ProtectionModule`을 import하고 기존 `AppModule.imports`에 한 번 추가한다. 기존 Prisma, `AuthModule`, `PostsModule`은 유지한다. `global: true`는 `ThrottlerGuard`를 다른 모듈에서도 주입 가능하게 하는 설정이다. 모든 라우트에 제한을 자동으로 설치한다는 뜻이 아니다. 모듈 등록 뒤 가드를 붙이지 않은 로그인 경로는 계속 제한 없이 실행된다.

다음은 **14장의 `src/auth/auth.controller.ts`에 적용하는 변경 조각**이다. 기존 `@Inject(AuthService, AccountsService)`와 생성자, 메서드 본문, DTO 선언은 유지한다. `ThrottlerGuard`는 `ProtectionModule`을 통해 등록된 실제 DI 토큰이며 `@UseGuards`가 이 토큰을 요청 컨테이너에서 해석한다. 로그인 성공뿐 아니라 틀린 비밀번호에도 같은 가드를 거치게 한다.

```diff
 import {
   BadRequestException,
   ConflictException,
   Controller,
   FromBody,
   Get,
   Header,
   HttpCode,
   Post,
   RequestDto,
   UnauthorizedException,
+  UseGuards,
   type RequestContext,
 } from '@fluojs/http';
+import { Throttle, ThrottlerGuard } from '@fluojs/throttler';

   @Post('/login')
+  @UseGuards(ThrottlerGuard)
+  @Throttle({ ttl: 60, limit: 5 })
   @HttpCode(200)
   @Header('Cache-Control', 'no-store')
   @RequestDto(LoginInput)

   @Post('/register')
+  @UseGuards(ThrottlerGuard)
+  @Throttle({ ttl: 300, limit: 3 })
   @HttpCode(201)
   @Header('Cache-Control', 'no-store')
   @RequestDto(RegisterInput)
```

성공 여부를 보고 나중에 차감하면 동시에 시작한 많은 비밀번호 검증이 모두 허용될 수 있다. 이 가드는 핸들러를 실행하기 전에 먼저 요청 한도를 소비한다. 따라서 다섯 번 모두 실패한 로그인도 예산을 다 쓴다. 여섯 번째 요청은 비밀번호가 정확하더라도 이 창에서는 429다. 이는 서버가 비밀번호를 확인한 뒤 잠깐 기다리라고 말하는 것이 아니라, 아직 그 작업에 자원을 배정하지 않았다는 뜻이다.

15장의 편집 경로에도 제한을 붙인다. 다음은 **`src/posts/post-editing.controller.ts`의 변경 조각**이다. 기존 class-level `@Inject(PostEditingService)`, `@UseAuth('blog-jwt')`, `@RequireScopes('posts:write')`를 유지한다. 제한은 소유권 판단이나 버전 충돌 처리를 대체하지 않는다.

```diff
  import {
   Controller, HttpCode, Put, RequestDto, UnauthorizedException,
-  UseInterceptors, type RequestContext,
+  UseGuards, UseInterceptors, type RequestContext,
 } from '@fluojs/http';
+import { Throttle, ThrottlerGuard } from '@fluojs/throttler';

   @Put('/:id')
   @HttpCode(200)
+  @UseGuards(ThrottlerGuard)
+  @Throttle({ ttl: 60, limit: 20 })
   @UseAuth('blog-jwt')
   @RequireScopes('posts:write')
   @ApiSecurity('bearer')
   @RequestDto(EditPostDto)
```

현재 기본 키는 principal을 읽지 않으므로 인증 가드와 제한 가드의 상대 순서에 키의 의미가 의존하지 않는다. 하지만 어떤 오류가 먼저 보이는지와 어떤 비용이 먼저 발생하는지는 순서에 영향을 받는다. 만료된 토큰 요청이 401로 먼저 끝나면 뒤의 제한 카운터를 소비하지 않을 수 있다. 여러 가드를 조합할 때 작성 순서만 보고 추측하지 말고 실제 HTTP 통합 테스트에서 비용이 큰 제공자의 호출 여부와 응답을 확인한다.

이름만 `AuthenticatedThrottleGuard`로 바꾸고 검증되지 않은 `Authorization` 문자열을 키로 쓰는 해결책은 피한다. 공격자가 임의 토큰 문자열을 계속 만들면 매번 새로운 버킷이 생기고 토큰 원문이 저장소 키에 남는다. 사용자 단위 제한이 필요하면 인증을 완료한 뒤 `requestContext.principal.subject`를 사용하도록 실행 순서가 보장된 애플리케이션 가드를 구성한다. 로그인 앞의 IP 제한은 그와 별도로 유지해야 비싼 인증 단계도 보호된다.

## 프록시 헤더는 클라이언트의 말일 수도 있다

개발 환경에서 모든 요청이 `127.0.0.1`로 보이는 것은 예상 가능한 일이다. 실제 배포에서는 서버가 역방향 프록시의 주소만 볼 수 있다. 그렇다고 `X-Forwarded-For`의 첫 값을 무조건 믿으면 외부 클라이언트가 헤더를 바꿀 때마다 새 예산을 얻는다. 네트워크 배치에 근거한 신뢰 경계를 선언해야 한다.

예를 들어 애플리케이션이 실제로 관찰하는 프록시 주소가 `192.0.2.10`이고 그 프록시가 외부 forwarding 헤더를 정리한다면, 앞의 `trustProxy: false`를 다음 **등록 옵션 조각**으로 바꿀 수 있다. 이 주소는 설명용 주소이지 복사해서 운영 설정으로 쓸 기본값이 아니다.

```ts
trustProxy: ['192.0.2.10/32']
```

`@fluojs/http`의 `resolveHttpConnection`으로 선택 결과를 관찰할 수도 있다. 다음은 **완전한 파일 `src/protection/client-address.ts`**이다. 제한 정책과 같은 신뢰 경계를 가진 진단 함수이며 로그에 전체 요청을 직렬화하지 않는다. 실제 배포에서는 두 곳의 주소 목록을 하나의 애플리케이션 설정 값으로 전달한다.

```ts
import { resolveHttpConnection, type RequestContext } from '@fluojs/http';

export function inspectClientAddress(context: RequestContext) {
  const connection = resolveHttpConnection(context.request, {
    trustProxy: ['192.0.2.10/32'],
  });
  return {
    clientAddress: connection.clientAddress,
    remoteAddress: connection.remoteAddress,
  };
}
```

신뢰하지 않는 peer의 forwarding 헤더는 직접 연결 주소를 대신하지 못한다. 형식이 잘못된 forwarding 정보도 임의의 신원으로 채택하지 않는다. 신뢰할 연결 식별자 자체가 없는 호스트에서는 기본 throttler가 예외를 던진다. 모든 사용자를 `unknown`이라는 하나의 버킷에 조용히 합치지 않는 계약이다. Fetch 요청에 URL이 있다고 그 URL의 호스트를 클라이언트 IP로 사용할 수는 없다.

프록시가 하나 더 추가되면 이 설정을 다시 검토해야 한다. 단순 hop 수는 네트워크 경로가 일정할 때 유용하지만 우회 경로가 열리면 신뢰하는 위치가 달라질 수 있다. 가능한 경우 실제 프록시 주소 범위를 명시하고 직접 접근 경로도 함께 점검한다. `trustProxyHeaders: true`는 넓게 헤더를 신뢰하는 호환 옵션이지 “내 프록시 하나만 신뢰”한다는 짧은 표현이 아니다.

## 시간 창을 기다리지 않고 실험하기

카운터의 시간 동작은 60초씩 기다리는 HTTP 테스트보다 작은 결정적 실험으로 먼저 확인할 수 있다. 다음은 **완전한 파일 `experiments/throttle-window.mjs`**다. 실제 공개 `createMemoryThrottlerStore`를 import하고 입력 시각을 명시한다. 이 실험은 저장소가 제한 초과를 거절하지 않고 증가한 카운터를 돌려준다는 점도 드러낸다. 429를 만드는 책임은 가드에 있다.

```js
import assert from 'node:assert/strict';
import { createMemoryThrottlerStore } from '@fluojs/throttler';

const store = createMemoryThrottlerStore();
const key = 'login:client-a';
const start = 1_800_000_000_000;
const first = await store.consume(key, { now: start, ttlSeconds: 60 });
const burst = await Promise.all(
  Array.from({ length: 5 }, () =>
    store.consume(key, { now: start + 1, ttlSeconds: 60 }),
  ),
);
assert.equal(first.count, 1);
assert.deepEqual(burst.map((entry) => entry.count), [2, 3, 4, 5, 6]);
assert.ok(burst.every((entry) => entry.resetAt === start + 60_000));

const beforeReset = await store.consume(key, {
  now: start + 59_999,
  ttlSeconds: 60,
});
assert.equal(beforeReset.count, 7);
assert.equal(beforeReset.resetAt, start + 60_000);

const atReset = await store.consume(key, {
  now: start + 60_000,
  ttlSeconds: 60,
});
assert.equal(atReset.count, 1);
assert.equal(atReset.resetAt, start + 120_000);

const anotherProcess = createMemoryThrottlerStore();
assert.equal((await anotherProcess.consume(key, {
  now: start + 1,
  ttlSeconds: 60,
})).count, 1);
console.log('fixed-window and process-isolation checks passed');
```

```bash
node experiments/throttle-window.mjs
```

첫 창에서 6번째 요청까지 카운터가 올라가는 것은 버그가 아니다. 제한이 5라면 가드는 `count > limit`인 요청을 거절한다. 거절 요청도 카운터는 증가하지만 `resetAt`은 그대로이므로 공격자가 계속 두드린다고 창이 끝없이 연장되지는 않는다. 이 알고리즘은 창 경계 직전에 5번, 직후에 5번이 들어오는 짧은 폭주를 허용할 수 있다. 엄밀한 순간 유량 제어가 필요하면 토큰 버킷이나 슬라이딩 창 같은 다른 정책을 선택해야 한다.

위 실험 마지막의 두 번째 저장소는 프로세스 격리의 모형이다. 실제 프로세스를 띄웠다는 뜻은 아니지만, 같은 키라도 저장소가 다르면 예산을 공유하지 않는 공개 동작을 확인한다. 서버가 두 대면 총 허용량이 대략 두 배가 될 수 있고 재시작하면 메모리 창이 사라진다. 로드밸런서의 세션 고정에 의존해서 이 문제를 해결했다고 보기 어렵다. 장애나 재배치 때 그 가정이 깨지기 때문이다.

## 여러 인스턴스와 저장소 장애에서 달라지는 것

요청 한도를 여러 인스턴스가 공유하려면 원자적인 저장소 연산이 필요하다. `ThrottlerStore.consume(key, { now, ttlSeconds })`는 현재 요청을 반영한 `count`와 `resetAt`을 반환한다. “현재 값 읽기 → 애플리케이션에서 증가 → 다시 쓰기”를 네트워크 왕복으로 나누면 동시 요청이 같은 이전 값을 읽고 일부 증가를 잃는다. 저장소를 Redis로 바꿨다는 이름만으로 원자성이 생기는 것이 아니다.

`RedisThrottlerStore`는 하나의 Lua 연산 안에서 카운터와 만료를 갱신한다. 창의 시간은 앱의 `now`가 아니라 Redis의 `TIME`을 사용하고, 남은 시간을 `retryAfterMs`로 반환한다. 앱 A의 시계가 B보다 빠르더라도 동일한 저장소 창과 재시도 간격을 사용할 수 있게 한 선택이다. 기본 가드는 이 값을 초 단위로 올림해 최소 1초의 `Retry-After`를 만든다.

다음은 **완전한 조합 함수 파일 `src/protection/distributed-protection.ts`**이다. 지금의 메모리 모듈과 동시에 import하는 코드가 아니라 다중 인스턴스 전환 때 사용할 대체 등록이다. 매개변수는 이미 준비된 연결의 공개 구조적 타입이며, 이 함수가 Redis 서버를 만들거나 연결의 종료를 소유하지 않는다. 호출자는 자신의 시작·종료 경계에서 클라이언트를 연결하고 정리해야 한다.

```ts
import {
  RedisThrottlerStore,
  ThrottlerModule,
  type RedisThrottlerClient,
} from '@fluojs/throttler';

export function createDistributedProtection(client: RedisThrottlerClient) {
  return ThrottlerModule.forRoot({
    global: true,
    ttl: 60,
    limit: 30,
    trustProxy: false,
    store: new RedisThrottlerStore(client),
  });
}
```

이 함수의 반환 모듈을 `AppModule.imports`에 넣을 때에는 앞의 `ProtectionModule` 등록을 제거한다. 같은 `ThrottlerGuard` 토큰에 두 기본 정책을 경쟁시키지 않는다. 비동기 클라이언트 준비는 이 동기 등록 전에 끝내야 한다. 현재 패키지에는 `ThrottlerModule.forRootAsync`가 없다. 예제에 편리한 메서드 이름을 상상해서 쓰는 대신 기존 앱의 조합 경계에서 준비된 자원을 넘긴다.

저장소가 실패하면 가드는 그 실패를 전파하며 `Retry-After`를 제한 초과처럼 만들지 않는다. 따라서 Redis 연결 장애를 429로 표시하면 안 된다. 이 책의 기본 정책은 제한을 확인할 수 없을 때 민감한 작업도 진행하지 않는 것이다. 로그인 가용성을 위해 장애 시 통과시키는 정책을 택할 수는 있지만 공격 상황에서 보호가 사라진다는 비용을 받아들여야 한다. 메모리로 조용히 대체하는 정책 또한 분산 한도를 로컬 한도로 바꾸므로 관측 없이 도입하지 않는다.

분산 키는 라우트의 모듈·컨트롤러·메서드·경로·버전과 컴파일된 핸들러 식별자를 포함한다. 동일한 빌드 구조를 가진 인스턴스는 같은 버킷을 공유하지만, 롤링 배포에서 컨트롤러를 옮기거나 산출물 구조를 바꾸면 창이 이어지는지 확인해야 한다. 내부 키 문자열을 소비자 코드에 하드코딩하는 것은 지원되는 마이그레이션 전략이 아니다. 엄격한 할당량이 필요하면 배포 사이의 연속성까지 애플리케이션 저장소 정책으로 정한다.

## 속도 제한이 닿지 않는 비용도 있다

가드는 요청의 라우트가 정해진 뒤 실행된다. 네트워크 연결 수, 매우 큰 JSON 본문, 천천히 전송하는 요청, 헤더 파싱 비용을 모두 보호하지는 못한다. 특히 15장의 `content` UTF-16 길이 검사는 본문을 읽은 후다. 호스트·프록시의 본문 크기와 연결 시간 제한을 함께 정하고, 18장의 파일 업로드에는 별도의 크기·형식 경계를 적용해야 한다. 가드 하나를 등록했다고 서비스 거부 공격 전체를 해결했다고 설명하지 않는다.

`@fluojs/http`에는 더 앞단에서 사용할 `createRateLimitMiddleware`도 있다. 그 옵션은 `windowMs`이고 저장소는 `get`, `set`, `increment`, `evict` 계약이다. `ThrottlerStore`의 원자적 `consume` 계약과 다르므로 두 저장소를 그대로 교환할 수 없다. 또한 미들웨어의 여러 저장소 호출을 각각 구현하는 것만으로 분산 원자성까지 보장된다고 일반화해서는 안 된다. 이 장의 민감한 라우트 제한은 계약이 명확한 throttler 경로를 사용한다.

계정 잠금도 요청 제한과 분리한다. 비밀번호 실패가 몇 번 쌓였다는 이유로 `User.status = disabled`를 자동으로 설정하면 공격자가 남의 계정을 정지시킬 수 있다. 이 제품의 `disabled`는 계정 수명주기 정책이고 속도 제한은 짧은 창의 자원 정책이다. 429가 한 번 나왔다고 `authVersion`을 올리거나 모든 기기를 로그아웃시키지 않는다.

## 정상 사용자 관점에서 거절을 검증하기

HTTP 검증에는 실제 연결 주소를 제공하는 개발 Node 서버를 사용한다. 요청 도구에 임의 IP 헤더를 붙였다고 기본 신원이 바뀐다고 기대하지 않는다. 같은 개발 클라이언트에서 `POST /auth/login`에 형식상 유효하지만 틀린 비밀번호를 다섯 번 보내면 401이고, 여섯 번째는 429와 양의 정수 `Retry-After`여야 한다. 앱 내부 해시 경계의 호출 수를 관찰하면 거절된 여섯 번째 요청은 해시 비교를 실행하지 않아야 한다.

동시성 테스트에서는 테스트 프로세스의 시계를 고정하고 실제 메모리 store·가드·HTTP 디스패치를 유지한 채 열 개 요청을 함께 시작한다. 자격 증명이 모두 틀리다면 기대 결과는 비밀번호 검증으로 간 다섯 요청과 제한에서 끝난 다섯 요청이다. 실제 데이터베이스나 해시 대신 관찰 가능한 경계 대역을 사용할 수 있지만, 가드가 반환할 결과를 미리 정한 가짜 limiter로 바꾸면 이 결함을 찾을 수 없다. HTTP 테스트가 끝나면 앱을 닫아 카운터와 연결을 다음 테스트에 남기지 않는다.

헤더 위조도 확인한다. 직접 연결에서 요청마다 다른 `X-Forwarded-For`를 넣어도 동일한 연결 주소의 예산을 사용해야 한다. 신뢰 프록시 실험에서는 테스트 요청의 실제 peer와 명시적인 forwarding 정보를 함께 구성하고, 신뢰한 peer에서는 분리되고 신뢰하지 않은 peer에서는 분리되지 않는 두 결과를 확인한다. 가짜 peer 정보와 실제 소켓 검증은 구분해서 기록한다.

편집 요청은 20회까지 모두 저장 성공이라고 고정해서는 안 된다. 그 안에서도 401·403·409가 발생할 수 있다. 각 실패의 데이터 불변 조건을 유지하면서, 한도가 소진된 뒤에는 더 이상 저장 서비스에 도달하지 않는지를 관찰한다. `@SkipThrottle`을 붙인 클래스에서는 메서드의 `@Throttle`로 다시 켤 수 없다는 점도 주의한다. 공개 조회를 예외로 만들려고 전체 인증 컨트롤러를 skip하면 로그인까지 빠진다. 여기서는 보호할 메서드만 명시적으로 선택했으므로 그런 전역 예외가 필요 없다.

이 원고 작성에서는 위 저장소 실험, HTTP 부하 실험, 실제 Redis 연결 실험을 실행하지 않았다. 제시한 명령과 결과는 재현 절차와 기대값이다. 패키지의 저장소·가드 소스와 기존 테스트가 어떤 동작을 검증하는지는 아래 근거에서 확인할 수 있으며, 독자 배포의 IP 전달·시계·클라이언트 수명주기는 별도 검증 대상이다.

사용자 화면은 429를 일반 로그인 실패로 표시하지 않아야 한다. `Retry-After` 동안 자동 재시도를 멈추고 입력한 내용을 보존하며, 401이면 재인증, 403이면 권한 안내, 409이면 최신 글과 비교하도록 구분한다. 운영 지표도 경로별 허용·거절·저장소 오류 수로 시작하고 이메일이나 토큰을 지표 라벨로 넣지 않는다. 높은 식별자 다양성은 메모리와 비용을 늘리고 개인정보를 불필요하게 퍼뜨린다.

이제 FluoBlog는 사용자, 로그인 상태, 글 소유권, 요청 예산을 서로 다른 경계에서 판단한다. 다음 장에서는 이 계약을 React 화면으로 가져간다. 화면이 해야 할 일은 서버의 판단을 대신하는 것이 아니라, 독자가 글을 읽고 작성자가 초안을 잃지 않으며 실패 뒤에도 다음 행동을 선택하게 만드는 것이다.

## 근거와 더 읽을 소스

- [Throttler 등록·단위·프록시·이전 한계 계약](../../packages/throttler/README.ko.md)
- [Throttler 공개 export](../../packages/throttler/src/index.ts), [저장소 입력·출력 타입](../../packages/throttler/src/types.ts)
- [가드의 키 구성·소비·429 처리](../../packages/throttler/src/guard.ts)
- [메모리 시간 창 구현](../../packages/throttler/src/store.ts), [Redis 원자적 소비 구현](../../packages/throttler/src/redis-store.ts)
- [HTTP 통합·가시성·저장소 장애 테스트](../../packages/throttler/src/module.test.ts), [Redis 시간 계약 테스트](../../packages/throttler/src/redis-store.test.ts)
- [HTTP 연결 신뢰와 가드 계약](../../packages/http/README.ko.md), [연결 신원 구현](../../packages/http/src/connection.ts)
- [HTTP 미들웨어의 별도 저장소 계약](../../packages/http/src/middleware/rate-limit.ts)

[이전 장](./ch15-authorization.ko.md) · [1권 목차](./toc.ko.md) · [다음 장](./ch17-react-reading-and-writing.ko.md)
