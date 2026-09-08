# 외부 입력을 내부 데이터로 바꾸기

<!-- book:volume=01-fluoblog;chapter=06 -->

[이전: 초안과 발행된 글은 무엇이 다른가](./ch05-post-domain.ko.md) · [1권 목차](./toc.ko.md) · [다음: 저장한 데이터와 공개할 데이터 구분하기](./ch07-response-models.ko.md)

## 타입을 붙였는데 숫자가 아닌 값이 들어왔다

운영자는 발행 규칙을 만든 뒤 작성 화면을 연결한다. 정상 요청에서는 모든 것이 맞는다. 그런데 브라우저 개발 도구로 요청을 조금 바꾸면 `expectedVersion`에 문자열 `"1"`을 보내거나, 본문에 `authorId`와 `status`를 추가할 수 있다. URL의 ID는 원래 문자열이다. 컨트롤러 인수에 `number`를 적는 것만으로 `"2"`가 숫자 2가 되지 않는다.

전 장의 서비스는 서버 안에서 호출할 수 있는 명령을 받는다. `createDraft()`에 문자열이 아닌 제목을 억지로 넣으면 `trim()` 호출부터 실패한다. 도메인 함수마다 HTTP 값의 모든 가능한 모양을 검사하는 것도 좋지 않다. 예약 작업과 테스트는 이미 타입이 정해진 값을 전달하는데 같은 검사를 반복하게 되기 때문이다. 외부 세계에서 내부로 들어오는 한 지점에서 출처, 표현, 유효성을 확정하자.

이번 장은 `@fluojs/http`의 DTO 바인딩과 `@fluojs/validation`의 검증을 연결한다. 바인딩은 어디서 읽는지, 변환은 표현을 어떻게 바꾸는지, 검증은 바뀐 값이 허용되는지 결정한다. 마지막에 컨트롤러가 필요한 필드만 골라 서비스의 명령으로 옮긴다. 이 순서를 지키면 요청에 숨어 들어온 값이 저장 모델의 권위 있는 값이 되는 일을 막을 수 있다.

본문의 작성 API는 인증 전 단계의 로컬 운영자 실습이다. `127.0.0.1`에서 실행하고 서버가 작성자를 `author-1`로 정한다. 이것을 공개 운영 환경의 인증 구현으로 설명하지 않는다. 뒤의 계정·인증·인가 장은 이 작성 경계를 유지하면서 서버가 확인한 사용자 ID를 연결한다. 2권의 상점에서도 그 계정을 그대로 이어 쓴다.

## 경계를 세 개의 질문으로 나눈다

`POST /posts`가 받는 본문은 `title`, `content`, `slug`뿐이다. 초안이므로 세 문자열은 비어 있어도 된다. `status`, `id`, `authorId`, `publishedAt`, `version`은 서버 소유다. 초기 구현처럼 본문 전체를 객체 전개로 저장하면 클라이언트가 이 값까지 고를 수 있게 된다. 허용 목록은 UI의 입력 폼이 아니라 서버의 명령 형태에서 결정한다.

`PUT /posts/:id`는 제목·본문·slug의 전체 교체다. 누락 필드는 그대로 둔다는 `PATCH` 계약을 이번에 함께 만들지 않는다. `expectedVersion`을 반드시 받으므로 전 장의 충돌 검사가 HTTP에도 연결된다. `POST /posts/:id/publish`는 글을 다시 생성하지 않고 기존 초안을 전이시키는 명령이다. 따라서 발행 성공은 `200`, 새 초안 생성은 `201`로 명시한다.

선택 필드가 필요해지면 두 종류의 “선택적” 의미를 구분해야 한다. HTTP의 `@Optional()`은 해당 요청 소스에 값이 없을 때 바인딩 실패를 생략한다. 검증의 `@IsOptional()`은 값이 `null` 또는 `undefined`일 때 다른 검증 규칙을 건너뛴다. 보통의 필드 검증기도 두 값을 건너뛰므로 필수 값에는 `@IsDefined()`가 필요하다. 누락과 명시적 `null`을 같은 의미로 쓸지부터 결정하지 않고 데코레이터를 여러 개 붙이면 빈 입력이 뜻밖에 통과한다.

### URL 숫자는 문법을 정해서 변환한다

`Number('')`는 0, `parseInt('2oops', 10)`은 2다. 이 편리함은 게시글 ID의 계약이 아니다. 이번 앱의 ID는 앞자리 0이 없는 양의 십진 정수 문자열이며 안전한 정수 범위 안에 있어야 한다. 다음은 **`src/posts/post-id.converter.ts` 전체**다.

```ts
import type { Converter } from '@fluojs/http';

export class PostIdConverter implements Converter {
  convert(value: unknown): number {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
      return Number.NaN;
    }
    const result = Number(value);
    return Number.isSafeInteger(result) ? result : Number.NaN;
  }
}
```

잘못된 변환 결과를 `NaN`으로 반환하면 이어지는 `@IsInt()`가 필드 검증 실패로 처리한다. 여기서 일반 `Error`를 던지면 요청 오류가 아니라 서버의 처리 실패로 분류될 수 있다. 사용자 입력 거부를 변환기에서 직접 끝내고 싶다면 명시적인 `BadRequestException`을 던지는 대안도 있다. 이 장은 검증기의 필드별 오류 상세를 재사용하려고 변환과 거부를 나누었다.

JSON 본문의 `expectedVersion`에는 이 변환기를 붙이지 않는다. JSON은 원래 숫자를 표현할 수 있으므로 문자열을 자동 수용할 이유가 없다. URL에는 문자열만 온다는 transport 사정과 JSON의 데이터 타입을 같은 관대함으로 처리하지 않는 것이다.

## HTTP가 조립할 DTO를 선언한다

다음은 **`src/posts/post-request.dto.ts` 전체**다. `@FromBody()`의 인수를 생략하면 프로퍼티 이름과 같은 본문 key를 읽는다. `@FromPath('id')`는 경로의 ID를 읽는다. 생성자 인수나 TypeScript 타입을 보고 출처를 추론하는 것은 아니다.

```ts
import { Convert, FromBody, FromPath } from '@fluojs/http';
import { IsDefined, IsInt, IsString, Max, MaxLength, Min } from '@fluojs/validation';
import { PostIdConverter } from './post-id.converter.js';

export class CreatePostDto {
  @FromBody()
  @IsDefined()
  @IsString()
  @MaxLength(120)
  title = '';

  @FromBody()
  @IsDefined()
  @IsString()
  @MaxLength(50_000)
  content = '';

  @FromBody()
  @IsDefined()
  @IsString()
  @MaxLength(80)
  slug = '';
}

export class GetPostDto {
  @FromPath('id')
  @Convert(PostIdConverter)
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id = 0;
}

export class ReplacePostDto extends CreatePostDto {
  @FromPath('id')
  @Convert(PostIdConverter)
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id = 0;

  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion = 0;
}

export class PublishPostDto extends GetPostDto {
  @FromBody()
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedVersion = 0;
}
```

데코레이터 필드를 `title!: string`처럼 선언하지 않았다. 현재 Fluo의 Babel 데코레이터 변환 경로에서는 이 definite assignment 형태가 거부될 수 있다. 초기값을 쓴다고 누락한 제목이 자동으로 빈 초안이 되는 것도 아니다. 바인더가 필수 `@FromBody()`의 누락을 먼저 감지하므로 클라이언트는 빈 문자열을 명시해서 보낸다. 이 차이는 작성 중인 빈 값과 필드를 보내지 않은 버그를 구별한다.

생성 DTO의 상속은 허용되는 입력 필드와 검증 메타데이터를 재사용한다. 하지만 저장 모델을 상속하지 않는다. 저장 모델에는 서버 소유 필드와 상태 전이 규칙이 있고, 요청 DTO에는 외부에서 받을 수 있는 값만 있다. 나중에 `PartialType()`을 사용하더라도 이 경계는 지킨다. mapped DTO가 편하다는 이유로 `PostSnapshot` 전체를 수정 API로 노출하지 않는다.

길이 제한이 도메인에도 있고 요청 DTO에도 있다는 점이 눈에 띌 수 있다. 두 검사는 다른 호출 경로를 보호한다. HTTP는 서버 로직을 실행하기 전에 지나치게 긴 원문을 거부하고, 도메인은 HTTP가 아닌 내부 호출에서도 상한을 유지한다. 제목의 앞뒤 공백은 도메인에서 정리하지만 DTO는 원문 길이를 먼저 검사하므로 공백만 잔뜩 붙인 121자 제목도 거부한다. 이 차이를 감추기보다 입력 계약에 적는 편이 낫다.

## 도메인 실패를 HTTP 실패로 번역한다

도메인 예외를 그대로 던지면 프레임워크가 업무 의미를 알아서 `409`로 바꾸지는 않는다. HTTP writer는 `HttpException`을 인식하고, 그 밖의 일반 오류는 내부 오류로 처리한다. 다음은 **`src/posts/post-http-error.ts` 전체**다. 전 장의 오류 코드 집합을 모두 매핑한다.

```ts
import { HttpException } from '@fluojs/http';
import { PostDomainError, type PostErrorCode } from './post.js';

const statusByCode = {
  POST_NOT_FOUND: 404,
  POST_INVALID_TEXT: 400,
  POST_VERSION_CONFLICT: 409,
  POST_NOT_DRAFT: 409,
  POST_NOT_PUBLISHABLE: 400,
  POST_SLUG_CONFLICT: 409,
} satisfies Record<PostErrorCode, number>;

export function runPostCommand<T>(action: () => T): T {
  try {
    return action();
  } catch (error: unknown) {
    if (error instanceof PostDomainError) {
      throw new HttpException(statusByCode[error.code], error.message, {
        code: error.code,
      });
    }
    throw error;
  }
}
```

이 helper는 현재의 동기 서비스 전용이다. 비동기 저장소로 바꾸면 `action()`이 반환한 Promise의 거부를 동기 `catch`가 잡지 못한다. 그때는 반환 타입을 Promise로 바꾸고 `try` 안에서 `await action()`하도록 이 경계도 바꾸어야 한다. 아직 없는 비동기 구현을 받기 위해 지금 모든 함수에 `async`를 붙이지는 않는다.

기본 `ConflictException`은 안정된 프레임워크 코드 `CONFLICT`를 제공한다. 여기서는 클라이언트가 버전 충돌과 slug 충돌에 서로 다른 행동을 해야 하므로 기반 `HttpException`의 `code` 옵션을 사용한다. 사용자 입력을 그대로 `meta`에 넣거나 오류의 `cause`를 응답 필드로 복사하지 않는다. 알려진 오류만 번역하고 나머지는 다시 던져 서버 결함을 정상적인 입력 거부로 숨기지 않는다.

다음은 **이번 장 단계의 `src/posts/posts.controller.ts` 전체**다. 반환 모델은 아직 내부 스냅샷이며 다음 장에서 교체한다. 따라서 이 단계는 로컬 작성 흐름을 확인하는 경계이지 최종 공개 응답 계약이 아니다.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, HttpCode, Post, Put, RequestDto } from '@fluojs/http';
import { runPostCommand } from './post-http-error.js';
import { CreatePostDto, GetPostDto, PublishPostDto, ReplacePostDto } from './post-request.dto.js';
import { PostsService } from './posts.service.js';

@Controller('/posts')
@Inject(PostsService)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get()
  list() {
    return this.posts.listPublished();
  }

  @Get('/:id')
  @RequestDto(GetPostDto)
  get(input: GetPostDto) {
    return runPostCommand(() => this.posts.getPublished(input.id));
  }

  @Post()
  @HttpCode(201)
  @RequestDto(CreatePostDto)
  create(input: CreatePostDto) {
    return runPostCommand(() => this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    }));
  }

  @Put('/:id')
  @HttpCode(200)
  @RequestDto(ReplacePostDto)
  replace(input: ReplacePostDto) {
    return runPostCommand(() => this.posts.revise(input.id, input.expectedVersion, {
      title: input.title, content: input.content, slug: input.slug,
    }));
  }

  @Post('/:id/publish')
  @HttpCode(200)
  @RequestDto(PublishPostDto)
  publish(input: PublishPostDto) {
    return runPostCommand(() => this.posts.publish(input.id, input.expectedVersion));
  }
}
```

`@RequestDto()`가 없으면 `input: CreatePostDto`라는 타입 표기만으로 바인딩이 켜지지 않는다. 타입은 컴파일 뒤 지워진다. 명시적인 DTO 등록이 있고 검증 메타데이터가 있으면 HTTP 파이프라인은 바인딩 뒤 검증을 실행한 후 핸들러를 호출한다. 애플리케이션이 별도의 가상 `ValidationModule`을 등록하거나 `DefaultValidator`를 무조건 전역 provider로 추가해야 하는 구조가 아니다.

## 등록하지 않은 타입은 실행 경로가 아니다

다음은 **`src/posts/posts.module.ts`의 교체 파일**과 **이 실습의 `src/app.ts` 전체**다. 앞 장의 시계 토큰과 서비스를 유지하고, 컨트롤러와 변환기를 실제 provider 그래프에 연결한다. 변환기에는 주입할 의존성이 없으므로 인수 없는 생성자를 사용한다.

```ts
// src/posts/posts.module.ts
import { Module } from '@fluojs/core';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { POST_CLOCK, PostsService, type PostClock } from './posts.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    PostsService,
    PostIdConverter,
    { provide: POST_CLOCK, useValue: { now: () => new Date() } satisfies PostClock },
  ],
  exports: [PostsService],
})
export class PostsModule {}
```

```ts
// src/app.ts
import { Module } from '@fluojs/core';
import { PostsModule } from './posts/posts.module.js';

@Module({ imports: [PostsModule] })
export class AppModule {}
```

기존 앱에 다른 기능 모듈이 있다면 그 `imports`는 보존하고 `PostsModule`을 한 번 연결한다. 컨트롤러를 루트와 기능 모듈 양쪽에 등록하지 않는다. 같은 `/posts` 라우트를 두 번 제공하는 방식으로 조합하면 시작 시 경로 충돌이 발생한다.

표준 데코레이터 메타데이터 사전 설치까지 명시하려면 **`src/main.ts`는 다음 전체 파일**로 둔다. 다음 장의 직렬화 클래스는 import 부작용으로 `Symbol.metadata`를 설치하지 않으므로 decorated module보다 먼저 준비하는 순서가 중요하다.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';

ensureMetadataSymbol();
const { AppModule } = await import('./app.js');
const { runFastifyApplication } = await import('@fluojs/platform-fastify');
await runFastifyApplication(AppModule, { host: '127.0.0.1', port: 3000 });
```

`runFastifyApplication()`은 resolve되기 전에 listen과 종료 처리 등록을 수행한다. 뒤에 `app.listen()`을 다시 호출하지 않는다. `main.ts`를 Node의 미변환 TypeScript 실행 기능에 바로 맡기는 대신 앞 장의 CLI/Vite 실행 경로로 시작한다. 데코레이터 빌드 설정을 legacy `experimentalDecorators`로 바꾸는 해결책은 사용하지 않는다.

## HTTP 바인더와 독립 검증은 같은 입구가 아니다

검증 패키지를 별도 가져오기 작업에서 사용하면 다음처럼 DTO를 실체화할 수 있다. 다음 블록은 **`src/posts/request-validation.test.ts`의 완전한 단위 테스트 파일**이다. HTTP 변환기까지 실행한 것처럼 오해하지 않도록 결과를 나눠 검사한다.

```ts
import { describe, expect, it } from 'vitest';
import { DefaultValidator } from '@fluojs/validation';
import { CreatePostDto, GetPostDto } from './post-request.dto.js';

describe('Standalone post input validation', () => {
  const validator = new DefaultValidator();
  const input = { title: '', content: '', slug: '', status: 'published' };

  it('requires an explicit undeclared-property policy outside HTTP', async () => {
    const loose = await validator.materialize(input, CreatePostDto);
    expect(Object.hasOwn(loose, 'status')).toBe(true);
    await expect(
      validator.materialize(input, CreatePostDto, { undeclaredProperties: 'reject' }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'UNDECLARED_PROPERTY', field: 'status' }),
      ]),
    });
  });

  it('does not execute HTTP scalar conversion during materialization', async () => {
    await expect(validator.materialize({ id: '2' }, GetPostDto)).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ field: 'id' })]),
    });
    await expect(validator.materialize({ id: 2 }, GetPostDto)).resolves.toMatchObject({ id: 2 });
  });
});
```

`materialize()`의 기본 정책은 안전한 추가 own enumerable 필드를 보존한다. 반면 HTTP 기본 바인더는 본문 key를 `@FromBody()`에 선언된 목록과 비교하여 알 수 없는 필드를 `UNKNOWN_FIELD`로 거부한다. 따라서 HTTP가 엄격했다는 이유로 파일 가져오기나 작업 큐의 입력도 자동으로 엄격하다고 주장해서는 안 된다. 독립 입력 경계에서는 `{ undeclaredProperties: 'reject' }`를 명시한다.

`materialize()`는 DTO를 만들고 검증하지만 URL 스칼라 변환을 대신하지 않는다. 첫 번째 ID 단언이 실패를 기대하는 이유다. HTTP 경로에서는 바인더가 `PostIdConverter`를 먼저 호출하므로 `/posts/2`를 정상 숫자로 읽는다. `validate()`는 이미 준비된 루트 객체를 검사하는 API다. 어느 함수를 호출했는지를 구별하지 않으면 단위 테스트는 통과하는데 실제 요청은 실패하는 설명 불가능한 틈이 생긴다.

## 실제 요청으로 서비스 호출 전 거부를 확인한다

다음은 **`scripts/request-boundary-check.mjs`의 완전한 로컬 확인 파일**이다. 새로 실행한 애플리케이션에 대해 `node scripts/request-boundary-check.mjs`로 한 번 실행한다. 매번 같은 slug를 사용하므로 재실행하려면 메모리 앱을 새로 시작한다. 별도의 sleep이나 준비 상태 polling 대신 개발 서버의 listen 완료를 확인한 뒤 실행한다.

```js
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:3000';
async function request(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  return { status: response.status, body: await response.json() };
}

const text = { title: 'Boundary test', content: 'Only declared input.', slug: 'boundary-test' };
const forged = await request('POST', '/posts', { ...text, authorId: 'other-author' });
assert.equal(forged.status, 400);
assert.ok(forged.body.error.details.some(
  (issue) => issue.code === 'UNKNOWN_FIELD' && issue.field === 'authorId',
));

const created = await request('POST', '/posts', text);
assert.equal(created.status, 201);
const id = created.body.id;
assert.equal(created.body.version, 1);
assert.equal((await request('GET', `/posts/${id}`)).status, 404);
assert.equal((await request('GET', '/posts/2oops')).status, 400);
assert.equal((await request('GET', '/posts/9007199254740992')).status, 400);
assert.equal((await request('GET', '/posts/999999')).status, 404);

const badVersion = await request('POST', `/posts/${id}/publish`, { expectedVersion: '1' });
assert.equal(badVersion.status, 400);
const published = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(published.status, 200);
assert.equal(published.body.version, 2);
const repeated = await request('POST', `/posts/${id}/publish`, { expectedVersion: 1 });
assert.equal(repeated.status, 409);
assert.equal(repeated.body.error.code, 'POST_VERSION_CONFLICT');
assert.equal((await request('GET', `/posts/${id}`)).status, 200);
console.log('Request boundary checks passed.');
```

이 원고에서는 위 단위 테스트나 HTTP 스크립트를 실행했다고 주장하지 않는다. 기대 결과는 단위 테스트 두 개의 성공과 스크립트 마지막 메시지다. 특히 잘못된 버전을 보낸 다음에도 정상 버전 1로 발행할 수 있어야 한다. 이 관찰은 거부한 요청이 상태를 먼저 바꾸지 않았다는 증거다. `GET`의 잘못된 형식은 `400`, 형식은 맞지만 없는 글은 `404`라는 차이도 실제 응답으로 확인한다.

본문을 배열로 보내면 기본 바인더는 객체 본문 계약 위반으로 거부한다. `title: null`은 `@IsDefined()`가 막는다. `title`이 빠지면 바인더의 `MISSING_FIELD`가 먼저 나온다. 같은 `400`이어도 상세 코드와 출처가 다르다. 클라이언트 테스트는 사람이 읽는 전체 문장 대신 상태·코드·필드처럼 기계가 소비할 부분을 단언한다. 문장의 표현을 바꿨다고 기능 테스트가 깨질 이유는 없다.

단, 문자열 길이 검증은 파싱 후의 값 제한이다. 수십 MB의 요청을 먼저 메모리에 읽는 비용까지 이 DTO가 막아 주지는 않는다. 그런 제한은 Fastify의 `maxBodySize` 같은 transport 경계에서 별도로 설정해야 한다. 파일 업로드와 과도한 요청을 다루는 장에서 바이트 제한과 사용 정책을 더한다. 지금의 상한을 전체 서비스 보호 기능으로 과장하지 않는다.

## 선택 실험: 원본을 보존하면서 입력을 투영한다

여기까지의 클래스 DTO 실습과 확인 스크립트는 그대로 유지한다. `/posts`는 계속 알 수 없는 본문 필드를 거부하고, 뒤의 OpenAPI 장도 이 클래스의 바인딩·검증 메타데이터를 사용한다. 다음은 기존 입력 schema가 있는 소비 앱을 위한 **선택적 비교 실험**이지 본문의 최종 구현을 교체하는 지시가 아니다.

### 거부와 제거는 서로 다른 앱 정책이다

추가 필드를 실수로 보내는 클라이언트와 호환해야 한다면 `@fluojs/http`의 `@InputPolicy({ unknownFields: 'strip' })`를 별도 DTO 클래스나 route method에 선언할 수 있다. 기본값은 여전히 `unknownFields: 'reject'`, `nonObjects: 'reject'`다. Route는 명시한 policy field만 DTO 설정보다 우선하며, 생략한 field는 DTO 설정을 유지한다. `@FromBody('post_title')`를 사용했다면 허용 목록의 key는 `title`이 아니라 transport alias `post_title`이다. 일반 클래스 DTO에 이 정책만 적용할 때는 schema binder가 필요하지 않다.

`strip`은 비객체 입력을 숨기는 옵션이 아니다. 배열·원시 값을 빈 binding body로 취급하려는 소비자만 `nonObjects: 'empty'`를 별도로 선택한다. 그 경우에도 필수 클래스 field는 `MISSING_FIELD`로 실패할 수 있다. `null`과 body 부재의 기존 누락 동작은 바뀌지 않는다. 위험한 own enumerable key인 `__proto__`, `constructor`, `prototype`은 `strip`과 `empty`에서도 차단된다. 이는 최상위 입력 경계이며 재귀 sanitizer가 아니다.

본문 전체를 교체하는 projection interceptor와도 구별해야 한다. Framework projection은 binding-local request view만 만들고 `RequestContext.request.body`를 교체하지 않는다. Transport parsing과 middleware 이후, 요청을 계속 처리하는 경로의 순서는 다음과 같다.

```text
guard: original parsed input
  -> interceptor-before: original parsed input
  -> binding / projection
  -> schema parsing OR converters + class validation
  -> handler / service
  -> interceptor-after
```

설정된 conditional request는 guard 이후, interceptor 이전에 완료될 수 있다. Parser 실패와 byte limit은 여전히 guard보다 먼저 적용된다. 이 기능은 native parser나 HEAD 정책을 바꾸지 않는다. 인증 guard가 확인할 원본과 서비스에 전달할 검증된 인수는 다른 값이며, 이후 context reader도 원래 body를 본다. `strip`은 인증이나 소유자 확인을 대신하지 않는다. 아래 실험도 작성자를 `author-1`로 고정하는 로컬 실습일 뿐이다.

### 기존 schema의 성공 값을 서비스 인수로 받는다

Zod 4를 선택한다면 실습 앱에서 `pnpm add zod@^4`로 설치한다. 다른 Standard Schema v1 vendor도 사용할 수 있다. 다음은 별도로 추가하는 **`src/schema-boundary-app.ts` 전체**다. 기존 `PostsModule`과 서비스를 재사용하지만 새 route는 `/schema-drafts`에만 등록한다.

```ts
import { Inject, Module } from '@fluojs/core';
import { Controller, createSchemaDto, HttpCode, Post, RequestDto } from '@fluojs/http';
import { z } from 'zod';
import { runPostCommand } from './posts/post-http-error.js';
import { PostsModule } from './posts/posts.module.js';
import { PostsService } from './posts/posts.service.js';

const SchemaDraftRequest = createSchemaDto(z.object({
  title: z.string().max(120).trim(),
  content: z.string().max(50_000).default(''),
  slug: z.string().max(80).trim().default(''),
}), {
  fields: {
    title: { source: 'body', key: 'post_title' },
    content: { source: 'body' },
    slug: { source: 'body' },
  },
  policy: { unknownFields: 'strip' },
});

@Controller('/schema-drafts')
@Inject(PostsService)
class SchemaDraftController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @HttpCode(201)
  @RequestDto(SchemaDraftRequest)
  create(input: InstanceType<typeof SchemaDraftRequest>) {
    return runPostCommand(() => this.posts.create('author-1', {
      title: input.title, content: input.content, slug: input.slug,
    }));
  }
}

@Module({
  imports: [PostsModule],
  controllers: [SchemaDraftController],
})
export class SchemaBoundaryModule {}
```

Title은 기존 실습처럼 원문 길이를 먼저 제한하고 그다음 trim한다. 반면 `content`, `slug` 누락에 빈 문자열을 주는 것은 이 실험에서 선택한 별도 앱 계약이다. Binder가 누락된 mapping을 schema input에서 생략하므로 schema default가 동작한다. 명시적 `null`은 누락으로 바꾸지 않고 schema에 전달하므로 위 문자열 schema에서는 실패한다.

다음은 선택 실험용 **`src/schema-boundary-main.ts` 전체**다. 기존 CLI/Vite 실행 설정의 entry를 이 파일로 선택하고 기존 서버와 동시에 같은 port에서 실행하지 않는다. 본문의 `src/main.ts`는 수정하지 않는다.

```ts
import { ensureMetadataSymbol } from '@fluojs/core';
import { StandardSchemaBinder } from '@fluojs/http';
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { bootstrapApplication } from '@fluojs/runtime';

ensureMetadataSymbol();
const { SchemaBoundaryModule } = await import('./schema-boundary-app.js');
const app = await bootstrapApplication({
  rootModule: SchemaBoundaryModule,
  adapter: createFastifyAdapter({ host: '127.0.0.1', port: 3000 }),
  binder: (defaultBinder) => new StandardSchemaBinder(defaultBinder),
});
await app.listen();
```

이 adapter-first 예제는 종료 signal을 자동 등록하지 않는다. 실행 host가 종료 시 `await app.close()`를 호출하거나 Node shutdown registration을 연결해야 한다. `FluoFactory.create(SchemaBoundaryModule, options)`도 같은 `binder` option을 받는다. Factory는 bootstrap마다 한 번 조합되며, 제공받은 default binder에는 설정된 global converter가 포함된다. 일반 DTO는 이 fallback으로 위임되므로 기존 `/posts/:id`의 `PostIdConverter`와 클래스 검증은 유지된다. 순수 application context에는 이 HTTP option이 없다.

Listen 완료 후 `POST /schema-drafts`에 `{ "post_title": "  Draft  ", "authorId": "other-author" }`를 보내면 예상 결과는 `201`이다. Service는 `{ title: 'Draft', content: '', slug: '' }`를 받고 작성자는 계속 서버의 `author-1`이다. 별도 projection interceptor, `safeParse` guard, context 저장/getter 없이 handler 인수가 성공한 schema output이 된다. 동일한 추가 필드를 기존 `/posts`에 보내면 여전히 `UNKNOWN_FIELD`로 실패한다. 새 route에 배열 body를 보내면 `INVALID_BODY`, 제목을 생략하면 schema 검증 실패로 `400`이 된다. 이 원고는 이 선택 실험을 실행했다고 주장하지 않는다.

`InstanceType<typeof SchemaDraftRequest>`는 schema input이 아니라 **output** 타입이다. Token을 `new`로 호출하면 `InvariantError`가 발생한다. 상속하거나 `PickType`, `OmitType`, `PartialType`, `IntersectionType`에 넘기지 않는다. Token은 reflected class-field metadata나 자동 OpenAPI schema conversion이 아니므로, 이 실험을 공개 API로 채택할 때는 요청 schema도 별도로 문서화해야 한다. 본문의 클래스 DTO를 유지하는 이유다.

`@ValidateClass(schema)`는 계속 검증 전용이며 trim/default 결과로 기존 DTO를 교체하지 않는다. HTTP 밖에서 성공 값을 얻으려면 `@fluojs/validation`의 `parseStandardSchema(schema, value)`를 await한다. Schema binder도 이 parser로 async validator를 기다린 뒤 handler를 호출한다. `issues: []`를 포함한 schema failure는 `DtoValidationError`이고 HTTP에서는 `400`으로 바뀐다. 기존 `ValidateClass`의 empty-issues 성공 동작은 유지된다. Malformed schema result는 `TypeError`, schema 구현이 던진 예외는 그대로 전파되므로 서버 결함을 정상적인 입력 거부로 숨기지 않는다.

## 명령을 작게 만들면 다음 경계가 보인다

완성된 입력 경계는 클라이언트에게 서버 상태를 고를 권한을 주지 않는다. 변환기는 URL 표기를 정규화하고, DTO는 필요한 데이터의 모양을 검증하며, 서비스는 초안·발행 규칙을 지킨다. 각 계층의 오류를 한곳에서 HTTP로 번역하므로 프레임워크를 바꿔도 도메인의 의미를 유지할 수 있다.

작은 내부 스크립트까지 반드시 HTTP DTO를 거쳐야 하는 것은 아니다. 타입이 확보된 코드라면 서비스 명령을 직접 호출하고 도메인 규칙을 적용하면 된다. 반대로 외부 CSV나 큐 메시지는 HTTP가 아니라도 새 입력 경계다. 같은 검증 정책을 재사용할 수 있지만 HTTP가 수행했던 변환과 undeclared-property 정책을 스스로 선택해야 한다.

이제 요청의 `authorId`는 저장되지 않지만, 컨트롤러가 반환하는 객체에는 서버가 저장한 `authorId`가 그대로 있다. 입력을 통제하는 것으로 출력 정책까지 해결되지는 않았다. 다음 장에서는 “저장하기 위해 알아야 할 정보”와 “독자에게 보여 주기로 약속한 정보”를 다른 모델로 만든다.

## 근거와 이어 읽기

- [HTTP 입력 정책과 schema binding 계약](../../packages/http/README.ko.md#명시적-입력-정책), [schema output parser 계약](../../packages/validation/README.ko.md#standard-schema-output-parsing), [runtime binder 조합 계약](../../packages/runtime/README.ko.md#http-binder-composition): 선택 실험의 API owner다.
- [입력 정책·mapping 테스트](../../packages/http/src/input-materialization.test.ts), [schema output 테스트](../../packages/validation/src/standard-schema-output.test.ts), [application 경계 테스트](../../packages/testing/src/input-materialization.e2e.test.ts): projection, 원본 guard, 변환 결과, fallback의 회귀 확인 위치다.
- [Next App Router native 요청 테스트](../../packages/platform-nextjs/src/schema-input-materialization.test.ts), [cold public declaration 테스트](../../packages/runtime/src/input-materialization-public-types.test.ts): 실제 adapter와 공개 타입의 근거 위치이며, 위 Book 실습을 실행했다는 뜻은 아니다.
- [`@fluojs/http` README](../../packages/http/README.ko.md), [공개 export](../../packages/http/src/index.portable.ts): `RequestDto`, `FromBody`, `FromPath`, `Convert`, `HttpCode`의 공개 경로다.
- [기본 바인더](../../packages/http/src/adapters/binding.ts)와 [바인딩 테스트](../../packages/http/src/adapters/binding.test.ts): 알 수 없는 본문 key, 필수 출처, 변환기 해석의 근거다.
- [핸들러 호출 정책](../../packages/http/src/dispatch/dispatch-handler-policy.ts), [HTTP 검증 어댑터](../../packages/http/src/adapters/dto-validation-adapter.ts): 바인딩 뒤 검증과 `400` 번역을 확인할 수 있다.
- [`@fluojs/validation` README](../../packages/validation/README.ko.md), [공개 export](../../packages/validation/src/index.ts), [검증 테스트](../../packages/validation/src/validation.test.ts): 누락 값, 엄격한 실체화 옵션, scalar coercion의 경계다.
- [`@fluojs/core` README](../../packages/core/README.ko.md), [`@fluojs/platform-fastify` README](../../packages/platform-fastify/README.ko.md): 명시적 DI, 메타데이터 사전 설치, 실행 helper의 근거다.

[이전: 초안과 발행된 글은 무엇이 다른가](./ch05-post-domain.ko.md) · [1권 목차](./toc.ko.md) · [다음: 저장한 데이터와 공개할 데이터 구분하기](./ch07-response-models.ko.md)
