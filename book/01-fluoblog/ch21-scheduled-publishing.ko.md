# 예약 발행과 정기 작업 만들기

<!-- book:volume=01-fluoblog;chapter=21 -->

[이전: 인기 글을 빠르게 제공하기](./ch20-caching.ko.md) · [1권 목차](./toc.ko.md) · [다음: 느린 요청과 실패를 설명할 수 있게 하기](./ch22-observability.ko.md)

월요일 아침에 공개할 글을 일요일 밤에 완성했다. 운영자는 오전 9시에 다시 접속하는 대신 발행 시각을 지정하고 싶다. FluoBlog에는 이미 초안과 발행 상태, 작성자 권한, PostgreSQL 저장소, 구독 알림과 공개 조회 캐시가 있다. 예약 발행은 이 기능들을 우회하는 두 번째 발행기가 되어서는 안 된다. 달라지는 것은 발행 버튼을 누르는 주체가 사용자에서 시간 기반 작업으로 바뀐다는 점이다.

그런데 시각을 저장하고 타이머를 거는 것만으로는 충분하지 않다. 오전 8시 59분에 배포로 프로세스가 재시작할 수 있다. 두 인스턴스가 같은 글을 발견할 수 있고, 예약 후 작성자가 내용을 고칠 수도 있다. 발행은 커밋됐지만 작업의 성공 로그를 남기기 전에 연결이 끊길 수도 있다. 이 장에서는 “정확한 순간에 함수를 한 번 부르기”보다 “발행할 시간이 지난 유효한 초안을 결국 한 번의 상태 전이로 공개하기”를 목표로 삼는다.

## 시계가 깨우고 데이터베이스가 기억한다

가장 작은 시도는 `setTimeout`으로 남은 밀리초만큼 기다렸다가 발행하는 것이다. 하지만 메모리의 타이머는 재시작과 함께 사라진다. `@Timeout`으로 바꿔도 이 사실은 달라지지 않는다. Fluo의 `@Timeout(ms)`은 애플리케이션 시작을 기준으로 한 지연 작업이며, 특정 날짜를 영속적으로 예약하는 기능이 아니다. `@Cron`도 `Date`를 받는 절대 시각 예약 API가 아니다. 문자열 Cron 표현식을 받는다.

예약의 원본은 데이터베이스에 두고, Cron은 그 원본을 주기적으로 찾아보는 알람으로 사용한다. 작업이 중단된 시간의 tick을 재생할 필요는 없다. `scheduledAt <= 현재 시각`인 글을 다시 조회하면 중단 동안 기한이 지난 글도 발견한다. 반대로 `scheduledAt = 현재 분`처럼 같은 분만 찾으면 프로세스가 잠시 멈춘 것만으로 영구 누락이 생긴다.

제품의 약속도 이 구조에 맞춰야 한다. 이 장은 30초마다 최대 100개를 처리한다. 부하가 낮고 DB가 정상일 때는 다음 tick에서 발행을 시도하지만, “오전 9시 정각 0밀리초에 모든 독자가 본다”고 약속하지 않는다. 실행 시간, 대기 중인 글 수, 공개 목록의 캐시 수명이 실제 지연에 추가된다. 독자 화면에는 예약 시각과 실제 발행 시각을 구분해서 보여줄 수 있어야 한다.

예약 시각은 시간대를 포함한 입력을 하나의 절대 시각으로 변환해 저장한다. 예를 들어 `2026-09-14T09:00:00+09:00`은 `2026-09-14T00:00:00Z`와 같은 순간이다. `2026-09-14 09:00`처럼 시간대가 없는 문자열은 요청 경계에서 받지 않는다. 매일 서울 시각 오전 9시에 실행하는 정기 작업에는 `timezone: 'Asia/Seoul'`을 사용할 수 있지만, 사용자 한 명의 예약 시각을 표현하기 위해 글마다 Cron 표현식을 만들지는 않는다.

## 초안에 예약 정보를 붙이는 규칙

게시글의 `status`는 여전히 `draft` 또는 `published`다. `scheduled`라는 세 번째 상태를 추가하지 않는다. 예약된 글은 아직 공개되지 않은 초안이며, 그 초안에 공개를 시도할 미래 시각이 붙어 있다. 이 구분 덕분에 공개 목록의 기존 `status = published` 조건과 작성자 전용 초안 조회를 유지할 수 있다.

예약과 편집이 충돌할 때의 정책을 먼저 정한다. 예약은 작성자와 현재 `version`이 일치하는 초안에만 가능하다. 제목·본문·slug는 5장의 `publishPost`가 인정하는 상태여야 한다. 예약 변경과 취소도 `version`을 올린다. 승인 직후의 버전과 승인자를 저장하고 모든 본문·slug·표지·첨부 변경은 같은 트랜잭션에서 승인을 취소한다. 승인된 버전이 아닌 내용이 이전 예약에 실려 나가지 않게 하려는 선택이다.

다음은 `prisma/schema.prisma`에 합칠 **필드 추가 부분**이다. 초안의 slug는 여전히 중복 가능하고 발행된 slug만 10장의 부분 고유 인덱스로 보호한다. 11장의 `PostPublication(id, postId @unique, actorId, version, publishedAt)`와 `Post.publication`, 19장의 `PostPublication.deliveries`는 그대로 둔다. 발행 기록이나 `Publication` 모델을 새로 정의하지 않는다.

```prisma
// Add inside the existing Post model.
scheduledAt DateTime? @db.Timestamptz(3)
scheduleGeneration String?
scheduledById String?
scheduledVersion Int?
scheduleFailure String?
scheduledBy User? @relation("ScheduleApprover", fields: [scheduledById], references: [id], onDelete: Restrict)
@@index([status, scheduledAt, id])

// Add inside the existing User model.
approvedPostSchedules Post[] @relation("ScheduleApprover")
```

```bash
pnpm exec prisma migrate dev --name add_publication_schedule --create-only
```

생성된 migration 뒤에 다음 제약을 추가하고 적용한다. 실패한 세대는 `scheduledAt=null`로 제외하되 승인자·버전·generation과 실패 코드를 남길 수 있다. 활성 예약만 세 값이 모두 있어야 하며 승인 버전과 현재 버전도 같아야 한다.

```sql
ALTER TABLE "Post" ADD CONSTRAINT "Post_active_schedule_consistent" CHECK (
  "scheduledAt" IS NULL OR (
    "status" = 'draft' AND "scheduleGeneration" IS NOT NULL
    AND "scheduledById" IS NOT NULL AND "scheduledVersion" IS NOT NULL
    AND "scheduledVersion" = "version" AND "scheduleFailure" IS NULL
  )
);
```

```bash
pnpm exec prisma migrate dev
pnpm exec prisma generate
```

`scheduleGeneration`은 예약을 승인할 때 새로 만드는 UUID다. 시각과 작성자가 같아도 취소 뒤 재승인은 다른 세대다. 오래된 worker가 실패 처리하면서 새 승인을 지우지 않게 하는 비교 값이지 별도 게시글 ID가 아니다. 실패 후 편집하거나 다시 승인하면 이전 실패 필드를 지운다. 장기 감사 이력이 필요하면 예약 이력 테이블을 별도로 설계해야 하며 이 현재 상태 필드를 영구 감사 원장이라고 부르지 않는다.

## 하나의 발행 트랜잭션에 예약 조건을 더하기

아래는 **`src/posts/publishing.service.ts`의 이 단계 전체 교체 파일**이다. 19장에서 추가한 전달 의도 기록까지 포함한다. 세 필수 인수 `postId`, `actorId`, `expectedVersion`은 그대로이고 예약 호출자만 `schedule` 조건을 추가한다. 기존 수동 API는 변경 없이 같은 메서드를 호출한다. 예약 서비스가 `post.status=published`를 직접 쓰거나 발행 기록을 따로 만들지 않는다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaService, Transaction } from '@fluojs/prisma';
import { Prisma, type PostPublication, type PrismaClient } from '@prisma/client';
import { publishPost } from './post.js';
import { toPostSnapshot } from './post-row.js';
import { PostsRepository } from './posts.repository.js';
import { PostPublicationsRepository } from './post-publications.repository.js';
import { recordPublicationDeliveries } from '../subscriptions/record-publication-deliveries.js';

export type PublishCommand = {
  postId: number;
  actorId: string;
  expectedVersion: number;
  schedule?: { generation: string; now: Date };
};
export type PublicationReceipt = { postId: number; version: number; publishedAt: string };
export type PublishRejectionCode = 'not_found' | 'forbidden' | 'conflict' | 'slug_conflict';
export class PublishRejected extends Error {
  constructor(readonly code: PublishRejectionCode) {
    super(code);
    this.name = 'PublishRejected';
  }
}

function receipt(record: PostPublication): PublicationReceipt {
  return { postId: record.postId, version: record.version, publishedAt: record.publishedAt.toISOString() };
}

@Inject(PrismaService, PostsRepository, PostPublicationsRepository)
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly posts: PostsRepository,
    private readonly publications: PostPublicationsRepository,
  ) {}

  @Transaction({ isolationLevel: 'ReadCommitted', timeout: 5000 })
  async publish(command: PublishCommand): Promise<PublicationReceipt> {
    const row = await this.posts.findById(command.postId);
    if (!row) throw new PublishRejected('not_found');
    if (row.authorId !== command.actorId) throw new PublishRejected('forbidden');
    const schedule = command.schedule;
    if (schedule && (
      row.scheduleGeneration !== schedule.generation
      || row.scheduledById !== command.actorId
      || row.scheduledVersion !== command.expectedVersion
      || row.scheduledAt === null || row.scheduledAt > schedule.now
    )) throw new PublishRejected('conflict');
    const next = publishPost(
      toPostSnapshot(row), command.expectedVersion, schedule?.now ?? new Date(),
    );
    const publishedAt = new Date(next.publishedAt);
    try {
      const changed = await this.prisma.current().post.updateMany({
        where: {
          id: row.id, authorId: command.actorId,
          status: 'draft', version: command.expectedVersion,
          ...(schedule ? {
            scheduleGeneration: schedule.generation,
            scheduledById: command.actorId,
            scheduledVersion: command.expectedVersion,
            scheduledAt: { lte: schedule.now },
          } : {}),
        },
        data: {
          status: 'published', publishedAt, version: { increment: 1 },
          scheduledAt: null, scheduleGeneration: null, scheduledById: null,
          scheduledVersion: null, scheduleFailure: null,
        },
      });
      if (changed.count !== 1) throw new PublishRejected('conflict');
    } catch (error: unknown) {
      // Only this update can violate the published-slug unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new PublishRejected('slug_conflict');
      }
      throw error;
    }
    const publication = await this.publications.record({
      postId: row.id, actorId: command.actorId, version: next.version, publishedAt,
    });
    await recordPublicationDeliveries(this.prisma.current(), publication.id);
    return receipt(publication);
  }
}
```

`publishPost`의 `POST_NOT_PUBLISHABLE`과 `POST_NOT_DRAFT`, 버전 오류는 기존 `PostDomainError`다. DB의 발행 slug 충돌은 `PublishRejected('slug_conflict')`다. 오류 클래스와 코드를 새 이름으로 추정하지 않고 그대로 유지해야 기존 `runPostCommand`와 아래 배치 분류가 맞는다. `P2002`를 잡는 범위는 공개 전이 UPDATE뿐이다. 전달 행 중복이나 다른 제약 위반까지 slug 충돌로 오분류하지 않는다.

예약 취소·편집·수동 발행이 후보 조회 뒤에 먼저 성공하면 최종 `updateMany`가 예약 세대·버전·상태 조건을 다시 검사한다. 선행 조회만 검사하고 최종 UPDATE에서는 generation을 빼면 이미 취소한 예약을 실행할 수 있다. 수동 발행이 이기면 예약은 같은 트랜잭션에서 비워진다. 이후 cron이 같은 글을 다시 찾지 않는다.

## 승인과 취소, 실패한 후보의 격리

다음 **`src/posts/scheduled-publishing.service.ts` 전체**에서 `schedule`과 `cancel`은 인증 경계에서 받은 `PostActor`를 사용한다. 승인 시각은 기본 실제 시계 대신 테스트가 명시한 `now`로 비교할 수 있다. 승인 가능한 마지막 버전은 2,147,483,645로 제한해 승인과 발행의 두 번 증가 공간을 남긴다.

```ts
import { randomUUID } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { BadRequestException, ForbiddenException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import { PostDomainError, publishPost } from './post.js';
import { toPostSnapshot } from './post-row.js';
import { PublishingService, PublishRejected } from './publishing.service.js';

function permanentFailure(error: unknown): string | undefined {
  if (error instanceof PublishRejected) {
    switch (error.code) {
      case 'not_found': case 'forbidden': case 'slug_conflict': return error.code;
      case 'conflict': return undefined;
    }
  }
  if (error instanceof PostDomainError) {
    switch (error.code) {
      case 'POST_NOT_FOUND': case 'POST_INVALID_TEXT': case 'POST_NOT_DRAFT':
      case 'POST_NOT_PUBLISHABLE': case 'POST_SLUG_CONFLICT': return error.code;
      case 'POST_VERSION_CONFLICT': return undefined;
    }
  }
  throw error;
}

@Inject(PrismaService, PublishingService)
export class ScheduledPublishingService {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly publishing: PublishingService,
  ) {}

  async schedule(
    actor: PostActor, id: number, expectedVersion: number, when: Date,
    now: Date = new Date(),
  ) {
    if (!Number.isFinite(when.getTime()) || when <= now
      || expectedVersion < 1 || expectedVersion > 2_147_483_645) {
      throw new BadRequestException('Expected a future date and an approvable version.');
    }
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const post = await db.post.findUnique({ where: { id } });
      if (!post) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, post)) throw new ForbiddenException('Only the author may schedule.');
      publishPost(toPostSnapshot(post), expectedVersion, now);
      const generation = randomUUID();
      const result = await db.post.updateMany({
        where: { id, authorId: actor.id, version: expectedVersion, status: 'draft' },
        data: {
          scheduledAt: when, scheduleGeneration: generation, scheduledById: actor.id,
          scheduledVersion: expectedVersion + 1, scheduleFailure: null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new PublishRejected('conflict');
      return { id, version: expectedVersion + 1, generation, scheduledAt: when.toISOString() };
    });
  }

  async cancel(actor: PostActor, id: number, expectedVersion: number) {
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const post = await db.post.findUnique({ where: { id } });
      if (!post) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, post)) throw new ForbiddenException('Only the author may cancel.');
      const result = await db.post.updateMany({
        where: { id, authorId: actor.id, version: expectedVersion, status: 'draft' },
        data: {
          scheduledAt: null, scheduleGeneration: null, scheduledById: null,
          scheduledVersion: null, scheduleFailure: null, version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw new PublishRejected('conflict');
      return { id, version: expectedVersion + 1 };
    });
  }

  async publishDue(now: Date): Promise<number> {
    const due = await this.prisma.current().post.findMany({
      where: { status: 'draft', scheduledAt: { lte: now } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, version: true, scheduleGeneration: true, scheduledById: true },
    });

    let published = 0;
    for (const candidate of due) {
      if (!candidate.scheduleGeneration || !candidate.scheduledById) {
        throw new Error('Active schedule violates its database constraint.');
      }
      try {
        await this.publishing.publish({
          postId: candidate.id, actorId: candidate.scheduledById,
          expectedVersion: candidate.version,
          schedule: { generation: candidate.scheduleGeneration, now },
        });
        published += 1;
      } catch (error: unknown) {
        const failure = permanentFailure(error);
        if (failure === undefined) continue;
        // The failed publication transaction has already rolled back.
        await this.prisma.current().post.updateMany({
          where: {
            id: candidate.id, version: candidate.version, status: 'draft',
            scheduleGeneration: candidate.scheduleGeneration,
            scheduledAt: { lte: now },
          },
          data: {
            scheduledAt: null, scheduleFailure: failure, version: { increment: 1 },
          },
        });
      }
    }
    return published;
  }
}
```

실패 격리는 후보마다 일어난다. 가장 오래된 A의 slug가 이미 발행된 글과 충돌하면 A는 `scheduleFailure=slug_conflict`, `scheduledAt=null`로 남고 다음 후보 B로 진행한다. 같은 A를 매 tick 맨 앞에서 실패시키는 구조는 큐가 아니라 영구 장애다. A의 세대와 버전을 조건에 포함하므로 실패 처리 직전에 작성자가 재승인했다면 그 새 예약을 지우지 않는다.

`conflict`와 `POST_VERSION_CONFLICT`는 경합 패배이므로 성공 수에 더하지 않고 넘어간다. 나머지 **알려진 도메인 거절만** 실패 상태로 격리한다. Prisma 연결 실패, transaction timeout, 발행 감사·전달 insert 오류, 실패 상태 저장 오류는 삼키지 않는다. 그 경우 배치는 실패하며 아직 pending인 유효 후보는 다음 tick에 다시 발견된다. 먼저 커밋한 후보는 되돌리지 않는다. DB 오류까지 `continue`로 바꾸면 “대기 중”과 “인프라 장애”를 구별할 수 없다.

반환값은 이번 실행이 확인한 전이 수이지 영구적으로 정확한 발행 통계가 아니다. 커밋 뒤 응답을 잃으면 DB에는 기록이 있지만 호출자는 실패를 볼 수 있다. 운영 지표를 합산해 데이터베이스의 발행 이력을 복원하려 하지 않는다. 회계처럼 정확한 목록이 필요하면 `PostPublication`을 조회한다.

`now`는 한 번 받아 배치 전체에서 사용한다. 테스트에서 경계 시각을 고정할 수 있고, 배치 앞뒤의 글이 서로 다른 시각 기준을 쓰지 않는다. 이 값은 예약 시각이 아니라 실제 처리 시각의 근사치다. 여기서는 호스트 시계가 동기화된 운영을 전제한다. 초 단위의 시계 오차도 허용할 수 없는 서비스라면 DB 시각을 기준으로 후보 선택과 기록을 수행하는 쿼리로 바꿔야 한다. Cron의 `timezone` 옵션은 호스트 시계 오차를 교정하지 않는다.

## 예약 API와 네이티브 폼의 실제 연결

**`src/posts/post-schedule-input.ts` 전체**는 JSON의 정수 버전과 폼의 문자열 버전을 구분한다. `datetime-local`은 시간대가 없으므로 그대로 받지 않고 ISO 8601 UTC 또는 명시적 offset을 입력받는다. 잘못된 달력 날짜를 `Date`가 다음 달로 보정하지 못하도록 날짜와 시·분·초도 검사한다.

```ts
import { BadRequestException, FromBody, FromPath } from '@fluojs/http';
import { positiveInt } from './post-form-input.js';

export class SchedulePathDto {
  @FromPath('id') id: unknown = '';
}
export class CancelScheduleDto {
  @FromPath('id') id: unknown = '';
  @FromBody('expectedVersion') expectedVersion: unknown = 0;
}
export class ApproveScheduleDto {
  @FromPath('id') id: unknown = '';
  @FromBody('expectedVersion') expectedVersion: unknown = 0;
  @FromBody('scheduledAt') scheduledAt: unknown = '';
}

export function scheduleVersion(value: unknown, form: boolean, approval: boolean): number {
  const maximum = approval ? 2_147_483_645 : 2_147_483_646;
  const version = form ? positiveInt(value, maximum) : value;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > maximum) {
    throw new BadRequestException('Invalid expected version.');
  }
  return version;
}

export function scheduleDate(value: unknown): Date {
  if (typeof value !== 'string' || value.length > 35) throw new BadRequestException('Invalid date.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new BadRequestException('An explicit timezone is required.');
  const [, year, month, day, hour, minute, second, zone] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(year) < 1000 || Number(month) < 1 || Number(month) > 12
    || Number(day) < 1 || Number(day) > days || Number(hour) > 23
    || Number(minute) > 59 || Number(second) > 59
    || (zone !== 'Z' && (!zone || Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new BadRequestException('Invalid calendar date.');
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new BadRequestException('Invalid date.');
  return result;
}
```

**`src/posts/post-schedule.controller.ts` 전체**는 Bearer API를 기존 API 모듈에 등록한다. GET은 승인 상태와 실패 이유를 확인하고 POST는 승인, DELETE는 취소다. 요청 body의 승인자 ID는 받지 않는다. HTTP 도메인 오류 변환은 기존 `runPostCommand`를 재사용한다.

```ts
import { Inject } from '@fluojs/core';
import {
  Controller, Delete, Get, Header, HttpCode, Post, RequestDto,
  UnauthorizedException, ForbiddenException, UseGuards, type RequestContext,
} from '@fluojs/http';
import { RequireScopes, UseAuth } from '@fluojs/passport';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import { PostDomainError } from './post.js';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import { positiveInt } from './post-form-input.js';
import { runPostCommand } from './post-http-error.js';
import {
  ApproveScheduleDto, CancelScheduleDto, SchedulePathDto, scheduleDate, scheduleVersion,
} from './post-schedule-input.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

export function scheduleActor(context: RequestContext): PostActor {
  if (!context.principal) throw new UnauthorizedException();
  return { id: context.principal.subject, scopes: context.principal.scopes ?? [] };
}

@Inject(PrismaService)
export class ScheduleReader {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}
  async read(id: number, actor: PostActor) {
    const row = await this.prisma.current().post.findUnique({ where: { id } });
    if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
    if (!canEditPost(actor, row)) throw new ForbiddenException('Only the author may inspect.');
    return {
      id: row.id, version: row.version, status: row.status,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      generation: row.scheduleGeneration, approvedBy: row.scheduledById,
      approvedVersion: row.scheduledVersion, failure: row.scheduleFailure,
    };
  }
}

@Inject(ScheduledPublishingService, ScheduleReader)
@Controller('/posts')
@UseAuth('blog-jwt')
@RequireScopes('posts:write')
@Header('Cache-Control', 'private, no-store')
export class PostScheduleController {
  constructor(private readonly scheduling: ScheduledPublishingService, private readonly reader: ScheduleReader) {}

  @Get('/:id/schedule')
  @RequestDto(SchedulePathDto)
  inspect(input: SchedulePathDto, context: RequestContext) {
    return runPostCommand(() => this.reader.read(positiveInt(input.id), scheduleActor(context)));
  }

  @Post('/:id/schedule')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(ApproveScheduleDto)
  approve(input: ApproveScheduleDto, context: RequestContext) {
    return runPostCommand(() => this.scheduling.schedule(
      scheduleActor(context), positiveInt(input.id),
      scheduleVersion(input.expectedVersion, false, true), scheduleDate(input.scheduledAt),
    ));
  }

  @Delete('/:id/schedule')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(CancelScheduleDto)
  cancel(input: CancelScheduleDto, context: RequestContext) {
    return runPostCommand(() => this.scheduling.cancel(
      scheduleActor(context), positiveInt(input.id), scheduleVersion(input.expectedVersion, false, false),
    ));
  }
}
```

**`src/posts/post-schedule-pages.module.ts` 전체**는 같은 서비스를 사용하는 별도 HTML 경로다. `/posts/:id/schedule/edit`에 직접 접속하거나 편집 화면에서 링크로 연다. `FormsAuthGuard`와 `FormOriginGuard`는 17장의 실제 `FormsAuthModule` export이며, `requireFormWriter(context)`가 작성 scope를 확인한다. POST의 버전은 화면에서 읽은 값 그대로이고, 오류가 났다고 최신 버전으로 자동 재시도하지 않는다.

```ts
import { createElement } from 'react';
import { Inject } from '@fluojs/core';
import { Header, Post, RequestDto, UseGuards, type RequestContext } from '@fluojs/http';
import { Path, ReactModule, Router, createReactServerEntry } from '@fluojs/react';
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import {
  FormsAuthModule, FormsAuthGuard, FormOriginGuard, requireFormWriter,
} from '../auth/forms-auth.module.js';
import { Document } from './post-pages.js';
import { PostsModule } from './posts.module.js';
import { positiveInt } from './post-form-input.js';
import { runPostCommand } from './post-http-error.js';
import { ScheduleReader } from './post-schedule.controller.js';
import {
  ApproveScheduleDto, CancelScheduleDto, SchedulePathDto, scheduleDate, scheduleVersion,
} from './post-schedule-input.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

@Inject(ScheduledPublishingService, ScheduleReader)
@Router('/posts')
@Header('Cache-Control', 'private, no-store')
class PostSchedulePages {
  constructor(private readonly scheduling: ScheduledPublishingService, private readonly reader: ScheduleReader) {}

  @Path('/:id/schedule/edit')
  @UseGuards(FormsAuthGuard)
  @RequestDto(SchedulePathDto)
  async show(input: SchedulePathDto, context: RequestContext) {
    const actor = requireFormWriter(context);
    const state = await runPostCommand(() => this.reader.read(positiveInt(input.id), actor));
    return createElement('main', null,
      createElement('h1', null, 'Publication schedule'),
      createElement('p', null, `Approved: ${state.approvedVersion ?? '-'}; actor: ${state.approvedBy ?? '-'}`),
      createElement('p', { role: 'status' }, state.failure ?? state.scheduledAt ?? 'Not scheduled'),
      createElement('a', { href: `/posts/${state.id}/edit` }, 'Back to draft'),
      createElement('form', {
        action: `/posts/${state.id}/schedule/approve`, method: 'post', encType: 'multipart/form-data',
      },
      createElement('input', { type: 'hidden', name: 'expectedVersion', value: state.version }),
      createElement('label', { htmlFor: 'scheduledAt' }, 'Publication time including timezone'),
      createElement('input', {
        id: 'scheduledAt', name: 'scheduledAt', required: true, maxLength: 35,
        placeholder: '2026-09-14T09:00:00+09:00', defaultValue: state.scheduledAt ?? '',
      }),
      createElement('button', { type: 'submit' }, 'Approve schedule')),
      createElement('form', {
        action: `/posts/${state.id}/schedule/cancel`, method: 'post', encType: 'multipart/form-data',
      },
      createElement('input', { type: 'hidden', name: 'expectedVersion', value: state.version }),
      createElement('button', { type: 'submit' }, 'Cancel schedule')),
    );
  }

  @Post('/:id/schedule/approve')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(ApproveScheduleDto)
  async approve(input: ApproveScheduleDto, context: RequestContext) {
    const actor = requireFormWriter(context);
    const id = positiveInt(input.id);
    await runPostCommand(() => this.scheduling.schedule(
      actor, id, scheduleVersion(input.expectedVersion, true, true), scheduleDate(input.scheduledAt),
    ));
    context.response.redirect(303, `/posts/${id}/schedule/edit`);
  }

  @Post('/:id/schedule/cancel')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  @RequestDto(CancelScheduleDto)
  async cancel(input: CancelScheduleDto, context: RequestContext) {
    const actor = requireFormWriter(context);
    const id = positiveInt(input.id);
    await runPostCommand(() => this.scheduling.cancel(
      actor, id, scheduleVersion(input.expectedVersion, true, false),
    ));
    context.response.redirect(303, `/posts/${id}/schedule/edit`);
  }
}

export const PostSchedulePagesModule = ReactModule.forRoot({
  imports: [PostsModule, FormsAuthModule],
  controllers: [PostSchedulePages],
  renderPage: (page) => createReactServerEntry(createElement(Document, null, page)),
});
```

## 스케줄러를 모듈 안에 배치하기

그 전에 예약 이후의 편집 경로를 닫아야 한다. 아래 교체는 **이 장의 스키마 migration을 적용한 뒤에만** 수행한다. 15·17·18장에서 아직 존재하지 않았던 예약 열을 미리 쓰게 만들지 않는다.

### JSON 편집의 소유자와 내부 저장 경로

다음은 **`src/posts/post-editing.service.ts` 전체 교체 파일**이다. 기존 `PUT /posts/:id`의 `PostEditingController`와 16장의 제한·인증·DTO·직렬화 등록은 유지한다. 같은 `PostEditingService` 토큰이 아래 구현을 받으므로 API가 새 경로를 선택할 필요가 없다. 텍스트 저장과 예약 취소는 한 UPDATE다.

```ts
import { Inject } from '@fluojs/core';
import { ForbiddenException } from '@fluojs/http';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { canEditPost, type PostActor } from './post-edit-policy.js';
import type { EditPostCommand } from './post-edit-input.js';
import { PostDomainError, reviseDraft } from './post.js';
import { toPostSnapshot } from './post-row.js';

@Inject(PrismaService)
export class PostEditingService {
  constructor(private readonly prisma: PrismaService<PrismaClient>) {}

  async edit(actor: PostActor, command: EditPostCommand) {
    return this.prisma.transaction(async () => {
      const db = this.prisma.current();
      const row = await db.post.findUnique({ where: { id: command.postId } });
      if (!row) throw new PostDomainError('POST_NOT_FOUND', 'Post not found.');
      if (!canEditPost(actor, row)) {
        throw new ForbiddenException('Only the author may edit this post.');
      }
      const next = reviseDraft(toPostSnapshot(row), command.expectedVersion, {
        title: command.title, content: command.content, slug: command.slug,
      });
      const changed = await db.post.updateMany({
        where: {
          id: command.postId, authorId: actor.id,
          version: command.expectedVersion, status: 'draft',
        },
        data: {
          title: next.title, content: next.content, slug: next.slug,
          version: { increment: 1 }, scheduledAt: null, scheduleGeneration: null,
          scheduledById: null, scheduledVersion: null, scheduleFailure: null,
        },
      });
      if (changed.count !== 1) {
        throw new PostDomainError('POST_VERSION_CONFLICT', 'The post changed while it was being saved.');
      }
      return next;
    });
  }
}
```

10장에서 남아 있는 내부 `PostsRepository.editDraft`도 예약 열을 놓치면 안 된다. 지금 HTTP·React의 쓰기 소유자는 위 서비스지만 기존 내부 호출과 저장소 실험까지 안전하게 유지하기 위해 **`src/posts/posts.repository.ts`의 `editDraft` 메서드만** 다음으로 교체한다. 기존 import, 나머지 조회·생성 메서드, 11장에서 제거한 직접 발행 경로는 유지한다.

```ts
async editDraft(id: number, expectedVersion: number, input: DraftEdit) {
  const result = await this.prisma.current().post.updateMany({
    where: { id, status: 'draft', version: expectedVersion },
    data: {
      ...normalizeText(input), version: { increment: 1 },
      scheduledAt: null, scheduleGeneration: null, scheduledById: null,
      scheduledVersion: null, scheduleFailure: null,
    },
  });
  return result.count === 1;
}
```

### React는 예약 취소를 따로 요청하지 않는다

**`src/posts/posts-pages.module.ts`의 `PostsPages.save` 메서드와 데코레이터를 아래 블록으로 교체한다.** 같은 파일에 이미 있는 `PostEditingService`, `parseDraftForm`, `PostDomainError`, `FormsAuthGuard`, `FormOriginGuard`, `requireFormWriter`와 HTTP/React import를 재사용하고 아래 import만 추가한다. 20장의 cache factory 교체, 18장의 `cover`·`attachments` 조회, 다른 GET은 유지한다.

```ts
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import { runPostCommand } from './post-http-error.js';
```

```ts
@Post('/:id/edit')
@UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
@Throttle({ ttl: 60, limit: 20 })
@Header('Cache-Control', 'private, no-store')
@RequestDto(EditInput)
async save(input: EditInput, context: RequestContext) {
  const actor = requireFormWriter(context);
  const id = positiveInt(input.id);
  const version = positiveInt(input.version, 2_147_483_646);
  const current = await this.posts.readOwnedDraft(id, actor.id);
  if (!current) throw new NotFoundException('Draft not found');
  if (typeof input.title !== 'string' || typeof input.content !== 'string'
    || typeof input.slug !== 'string') throw new BadRequestException('Expected text fields');
  const post = {
    ...current, title: input.title, content: input.content, slug: input.slug, version,
  };
  try {
    await this.editing.edit(actor, parseDraftForm(input));
  } catch (error: unknown) {
    if (error instanceof PostDomainError && error.code === 'POST_NOT_FOUND') {
      throw new NotFoundException('Draft not found');
    }
    const invalid = error instanceof BadRequestException
      || (error instanceof PostDomainError && error.code === 'POST_INVALID_TEXT');
    const conflict = error instanceof PostDomainError
      && (error.code === 'POST_VERSION_CONFLICT' || error.code === 'POST_NOT_DRAFT');
    if (!invalid && !conflict) return runPostCommand(async () => { throw error; });
    context.response.setStatus(invalid ? 400 : 409);
    return createReactServerEntry(createElement(Document, null,
      createElement(EditingPage, {
        post, notice: invalid ? 'Check the field lengths.'
          : 'Draft changed. Copy your edits, then reload and compare.',
      }),
    ));
  }
  context.response.redirect(303, `/posts/${id}/edit`);
}
```

성공한 한 번의 `editing.edit`가 예약 취소까지 커밋한다. React가 먼저 취소 API를 부르고 나중에 저장하면 저장 실패 때 승인만 사라진다. 반대 순서라면 저장과 취소 사이에 cron이 실행될 수 있다. 두 HTTP 요청을 묶는 대신 DB의 한 쓰기에 의미를 넣는다. 입력 오류·409 화면에서는 제출 텍스트와 기존 자산 메타데이터를 보존하며, 오래된 버전으로 재시도해 새 승인을 취소하지 않는다.

`src/posts/post-pages.tsx`의 `EditingPage`에서 기존 `<h1>Edit draft</h1>` 바로 뒤에 다음 JSX를 추가하면 실제 예약 화면에 도달한다. 업로드 폼과 텍스트 폼은 그대로 둔다.

```tsx
<p><a href={`/posts/${post.id}/schedule/edit`}>Review publication schedule</a></p>
```

### 표지와 첨부파일도 승인한 내용의 일부다

**`src/uploads/post-assets.ts`의 `PostAssets.attach` 메서드 전체**를 다음으로 교체한다. import·생성자와 `download`는 18장의 파일 그대로다. 정책의 2 MiB 표지·5 MiB 첨부 한도, MIME/이름 검사, HTTP의 `FormOriginGuard`·scope·버전 검사, 반환 URL을 바꾸지 않는다. 첨부파일도 독자에게 공개할 내용이므로 표지가 아닌 경우에도 예약을 취소한다.

```ts
async attach(
  postId: number, authorId: string, version: number, asset: PreparedAsset,
) {
  const id = randomUUID();
  return this.prisma.transaction(async () => {
    const tx = this.prisma.current();
    const post = await tx.post.findFirst({
      where: { id: postId, authorId, status: 'draft' },
      select: { coverAssetId: true },
    });
    if (!post) throw new NotFoundException('Draft not found');
    const changed = await tx.post.updateMany({
      where: { id: postId, authorId, status: 'draft', version },
      data: {
        version: { increment: 1 },
        scheduledAt: null, scheduleGeneration: null, scheduledById: null,
        scheduledVersion: null, scheduleFailure: null,
        ...(asset.kind === 'cover' ? { coverAssetId: id } : {}),
      },
    });
    if (changed.count !== 1) throw new ConflictException('Draft changed');
    await tx.postAsset.create({
      data: { id, postId, ownerId: authorId, ...asset },
    });
    if (asset.kind === 'cover' && post.coverAssetId) {
      await tx.postAsset.deleteMany({
        where: { id: post.coverAssetId, postId, kind: 'cover' },
      });
    }
    return {
      id, version: version + 1,
      assetUrl: `/posts/${postId}/assets/${id}`,
      editUrl: `/posts/${postId}/edit#asset-${id}`,
      readUrl: `/posts/${postId}/read`,
    };
  });
}
```

파일 생성이나 이전 표지 삭제가 실패하면 버전 증가와 예약 취소도 함께 롤백된다. 바이트가 바뀌었는데 승인은 남거나, 업로드가 실패했는데 승인만 사라지는 상태가 없어야 한다. 발행이 먼저 이기면 `status=draft` 조건이 실패하므로 발행본의 표지나 첨부를 바꾸지 않는다. 이후 새 삭제·교체 API를 만들 때에도 같은 계약이 필요하지만, 여기서 아직 없는 경로를 있다고 설명하지 않는다.

`src/posts/publishing-schedule.ts`는 **완전한 파일**이다. HTTP 요청 범위가 없는 singleton provider로 등록한다. `@Cron`은 공개 인스턴스 메서드에 붙이며, private 메서드나 static 메서드에 붙이지 않는다.

```typescript
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';

@Inject(ScheduledPublishingService)
export class PublishingSchedule {
  constructor(private readonly publishing: ScheduledPublishingService) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'posts.publish-due' })
  async tick(): Promise<void> {
    const published = await this.publishing.publishDue(new Date());
    console.info(JSON.stringify({ event: 'posts.publish_due', published }));
  }
}
```

다음은 **`src/posts/posts.module.ts`의 이 단계 전체 파일**이다. `src/database/blog-database.module.ts`의 루트 소유 `BlogDatabaseModule`과 `AppSettings` 기반 `PrismaModule.forRootAsync({ global: true })`를 유지한다. 19장의 `BlogJobsModule`을 재사용하므로 Cron 등록도 하나다. 15장의 API 제공자, 17장의 편집 서비스 export, 20장의 cache import를 모두 포함한다.

```ts
import { Module } from '@fluojs/core';
import { SerializerInterceptor } from '@fluojs/serialization';
import { AuthModule } from '../auth/auth.module.js';
import { BlogJobsModule } from '../jobs/blog-jobs.module.js';
import { ReadingCacheModule } from './reading-cache.module.js';
import { PostEditingController } from './post-editing.controller.js';
import { PostEditingService } from './post-editing.service.js';
import { PostWritingController } from './post-writing.controller.js';
import { PostWritingService } from './post-writing.service.js';
import { PostIdConverter } from './post-id.converter.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { PostsRepository } from './posts.repository.js';
import { PostLinks } from './post-links.js';
import { PostPublicationsRepository } from './post-publications.repository.js';
import { PublishingService } from './publishing.service.js';
import { PostFeed } from './post-feed.js';
import { PublishingSchedule } from './publishing-schedule.js';
import { ScheduledPublishingService } from './scheduled-publishing.service.js';
import { PostScheduleController, ScheduleReader } from './post-schedule.controller.js';

@Module({
  imports: [AuthModule, ReadingCacheModule, BlogJobsModule],
  controllers: [
    PostsController, PostEditingController, PostWritingController, PostScheduleController,
  ],
  providers: [
    PostsService, PostsRepository, PostLinks, PostIdConverter, SerializerInterceptor,
    PostPublicationsRepository, PublishingService, PostFeed,
    PostEditingService, PostWritingService,
    ScheduledPublishingService, PublishingSchedule, ScheduleReader,
  ],
  exports: [
    PostsService, PostsRepository, PublishingService, PostFeed, PostEditingService,
    ScheduledPublishingService, ScheduleReader,
  ],
})
export class PostsModule {}
```

**`src/app.ts`**의 기존 imports에는 페이지 모듈을 한 번 추가하고, 기존 OpenAPI `sources`에는 API 컨트롤러를 추가한다. 19장의 구독 모듈과 `EmailDispatchSchedule`을 지우지 않는다. 이로써 발행 tick은 의도를 기록하고 메일 tick은 실제 `dispatchPending`을 호출하는 두 책임이 연결된다.

```diff
+import { PostSchedulePagesModule } from './posts/post-schedule-pages.module.js';
+import { PostScheduleController } from './posts/post-schedule.controller.js';
@@ imports
+    PostSchedulePagesModule,
@@ OpenApiModule.forRoot sources
+        { controllerToken: PostScheduleController },
```

스케줄러는 `onApplicationBootstrap`에서 작업을 등록한다. 전체 앱의 bootstrap-ready 신호를 기다리는 Queue worker와 같다고 설명하지 않는다. 실행 중인 같은 작업에 다음 tick이 오면 실행을 쌓지 않고 건너뛴다. 공개 옵션에 없는 `waitForCompletion`을 복사할 필요가 없다. 다만 직접 `tick()`을 두 번 호출하는 것은 스케줄러의 실행 보호를 거치지 않는다. 그래서 위 서비스의 DB 조건은 타이머 종류와 무관하게 필요하다.

서버가 여러 대라면 Redis 분산 락으로 중복 조회 비용을 줄일 수 있다. `CronModule.forRoot({ distributed: { enabled: true, lockTtlMs: 30_000 } })`를 선택할 때는 실제 Redis 모듈 등록과 토큰 가시성도 필요하다. 활성 TTL의 최소값은 1,000밀리초이며 락은 갱신된다. 그래도 네트워크 단절과 lease 상실이 이미 실행 중인 SQL을 되돌리지는 않는다. 락은 실행 조정 수단이고, 버전 조건과 트랜잭션이 데이터 정합성의 경계다. 이 구현은 그 이유로 분산 락 없이도 중복 발행을 방어한다.

## 시간을 기다리지 않는 스케줄러 실험

타이머 테스트를 실제 30초 대기로 작성하면 느리고, 실행 환경이 바쁜 날에는 불안정해진다. `CronModule`의 공개 `scheduler` 옵션을 이용해 등록된 callback을 잡아 두면 tick을 직접 발생시킬 수 있다. 다음은 `src/posts/publishing-scheduler.spec.ts`에 둘 수 있는 **독립된 계약 실험 파일**이다. 애플리케이션의 기존 Vitest 표준 데코레이터 변환 설정을 사용한다. DB와 실제 발행 서비스는 사용하지 않으며 스케줄러의 중복 실행 방지만 검증한다.

```typescript
import { Inject, Module } from '@fluojs/core';
import { Cron, CronModule, type CronScheduler } from '@fluojs/cron';
import { bootstrapApplication } from '@fluojs/runtime';
import { expect, it } from 'vitest';

it('skips an overlapping publishing tick', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const callbacks: Array<() => Promise<void>> = [];
  const WORK = Symbol('publishing.work');
  let calls = 0;

  const scheduler: CronScheduler = (_expression, _options, callback) => {
    callbacks.push(callback);
    return { stop() {} };
  };

  @Inject(WORK)
  class ScheduleProbe {
    constructor(private readonly work: () => Promise<void>) {}

    @Cron('*/30 * * * * *', { name: 'posts.publish-due' })
    async tick(): Promise<void> {
      await this.work();
    }
  }

  @Module({
    imports: [CronModule.forRoot({ scheduler })],
    providers: [
      ScheduleProbe,
      {
        provide: WORK,
        useValue: async () => {
          calls += 1;
          started.resolve();
          await release.promise;
        },
      },
    ],
  })
  class ProbeModule {}

  const app = await bootstrapApplication({ rootModule: ProbeModule });
  let first: Promise<void> | undefined;
  try {
    expect(callbacks).toHaveLength(1);
    const tick = callbacks[0];
    if (!tick) throw new Error('The publishing callback was not registered.');
    first = tick();
    await started.promise;
    await tick();
    expect(calls).toBe(1);
    release.resolve();
    await first;
    await tick();
    expect(calls).toBe(2);
  } finally {
    release.resolve();
    await first;
    await app.close();
  }
}, 5_000);
```

`started`는 첫 실행이 실제 작업 본문에 도달했다는 신호다. 이 신호를 만든 뒤 tick을 발생시키므로 “아마 실행됐겠지”라는 시간 추정이 없다. `release`를 해제하기 전의 두 번째 tick은 작업 수를 늘리지 않아야 한다. 해제 후의 tick은 다시 실행돼야 한다. 두 번째 assertion까지 있어야 영구적으로 실행을 막아 버린 잘못된 구현도 잡는다. 마지막의 5초는 성공 조건을 만드는 대기가 아니라 잘못된 구현이 테스트를 무한히 붙잡지 못하게 하는 상한이다.

DB 정합성은 이 실험과 별도로 검증한다. 운영 DB가 아닌 전용 PostgreSQL 테스트 데이터베이스에 제목·본문·slug가 유효한 초안을 만들고, 충분히 미래인 시각 `T`로 예약한다. 예약 후 버전을 읽은 다음 `publishDue(T 이전 1밀리초)`의 반환값과 발행 기록 수가 모두 0인지 확인한다. 이어 별도 컨텍스트에서 `publishDue(T)`를 동시에 두 번 호출한다. 두 반환값의 합은 1, 상태는 `published`, 버전은 예약 직후보다 1 증가, 발행 기록은 하나여야 한다.

부분 실패도 만들어 본다. 테스트 DB에서 발행 기록 삽입을 실패시키면 같은 글의 `status`와 `publishedAt`이 이전 값으로 남아야 한다. 예약 취소와 발행을 경쟁시키면 먼저 유효한 버전 조건을 만족한 작업만 이기며, 취소가 먼저 완료됐다면 발행 기록은 없어야 한다. 재시작 복구는 메모리 상태를 복원하는 시험이 아니다. 이미 지난 `scheduledAt`을 가진 초안을 저장하고 새 애플리케이션을 시작한 뒤 첫 tick을 실행해 공개되는지 보는 시험이다.

### A의 영구 충돌 뒤에도 B가 발행되는가

다음은 **`test/scheduled-publishing.integration.test.ts` 전체**다. 21장까지 migration한 **다른 예약이 없는 전용 PostgreSQL 테스트 DB**가 필요하다. 고정한 `approvedAt`, `dueA`, `dueB`를 서비스에 주입하므로 현실 시각을 기다리거나 시스템 시계를 바꾸지 않는다. A와 B의 예약 순서를 확정하고, A의 slug를 먼저 발행한 글로 점유한다. 단순히 publisher mock이 throw하는 실험이 아니라 실제 부분 고유 인덱스가 발행 UPDATE를 거절해야 한다.

```ts
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@fluojs/prisma';
import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { PostsRepository } from '../src/posts/posts.repository.js';
import { PostPublicationsRepository } from '../src/posts/post-publications.repository.js';
import { PublishingService } from '../src/posts/publishing.service.js';
import { ScheduledPublishingService } from '../src/posts/scheduled-publishing.service.js';

it('excludes conflicting schedule A and publishes valid schedule B in the same batch', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');
  const client = new PrismaClient({ datasources: { db: { url } } });
  const prisma = new PrismaService(client, { strictTransactions: true });
  const userId = randomUUID();
  const ids: number[] = [];
  try {
    await prisma.onModuleInit();
    await client.user.create({
      data: { id: userId, emailKey: `${userId}@example.test`, displayName: 'Schedule test' },
    });
    const publishing = new PublishingService(
      prisma, new PostsRepository(prisma), new PostPublicationsRepository(prisma),
    );
    const scheduling = new ScheduledPublishingService(prisma, publishing);
    const slug = `schedule-${userId}`;
    const blocker = await client.post.create({
      data: { authorId: userId, title: 'Existing post', content: 'Already public.', slug },
    });
    ids.push(blocker.id);
    await publishing.publish({ postId: blocker.id, actorId: userId, expectedVersion: 1 });
    await client.subscription.create({
      data: { userId, address: `${userId}@example.test`, active: true },
    });
    const a = await client.post.create({
      data: { authorId: userId, title: 'A', content: 'Conflicting draft.', slug },
    });
    ids.push(a.id);
    const b = await client.post.create({
      data: { authorId: userId, title: 'B', content: 'Valid draft.', slug: `${slug}-b` },
    });
    ids.push(b.id);
    const actor = { id: userId, scopes: ['posts:write'] };
    const approvedAt = new Date('2026-09-14T00:00:00.000Z');
    const dueA = new Date('2026-09-14T00:01:00.000Z');
    const dueB = new Date('2026-09-14T00:02:00.000Z');
    const approvedA = await scheduling.schedule(actor, a.id, 1, dueA, approvedAt);
    const approvedB = await scheduling.schedule(actor, b.id, 1, dueB, approvedAt);

    const published = await scheduling.publishDue(dueB);

    expect(published).toBe(1);
    expect(await client.post.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'draft', scheduledAt: null, scheduleFailure: 'slug_conflict',
      scheduleGeneration: approvedA.generation, scheduledById: userId,
      scheduledVersion: approvedA.version, version: approvedA.version + 1,
    });
    expect(await client.post.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      status: 'published', scheduledAt: null, scheduleFailure: null,
      version: approvedB.version + 1, publishedAt: dueB,
    });
    expect(await client.postPublication.count({ where: { postId: a.id } })).toBe(0);
    const publication = await client.postPublication.findUniqueOrThrow({ where: { postId: b.id } });
    expect(publication).toMatchObject({
      actorId: userId, version: approvedB.version + 1, publishedAt: dueB,
    });
    expect(await client.postDelivery.findMany({
      where: { publicationId: publication.id, subscriberId: userId },
    })).toMatchObject([{ status: 'pending', address: `${userId}@example.test` }]);
    expect(await client.post.count({
      where: { id: { in: [a.id, b.id] }, status: 'draft', scheduledAt: { lte: dueB } },
    })).toBe(0);
  } finally {
    try {
      await client.postDelivery.deleteMany({ where: { publication: { postId: { in: ids } } } });
      await client.postPublication.deleteMany({ where: { postId: { in: ids } } });
      await client.post.deleteMany({ where: { id: { in: ids } } });
      await client.subscription.deleteMany({ where: { userId } });
      await client.user.deleteMany({ where: { id: userId } });
    } finally {
      await prisma.onApplicationShutdown();
    }
  }
}, 15_000);
```

```bash
pnpm exec vitest run test/scheduled-publishing.integration.test.ts src/posts/publishing-scheduler.spec.ts
```

이 시나리오에서 A는 같은 배치의 첫 후보이므로 try/catch가 루프 바깥에 있으면 B가 발행되지 않아 실패한다. `catch { continue; }`로만 바꾸면 A가 다음 후보 조회에 계속 남아 마지막 검사에서 실패한다. 실패 상태를 generation 없이 저장하는 회귀는 별도 경합 실험에서 잡는다. A의 `publish`가 거절된 신호를 관측한 뒤 실패 저장을 잠시 멈추고 A를 새 버전으로 재승인한다. 문을 다시 열었을 때 새 generation의 `scheduledAt`이 남아야 한다. 이 순서는 Promise 신호로 제어하고 sleep으로 만들지 않는다.

실제 DB 연결 오류를 주입했을 때에는 `publishDue`가 reject하고 `scheduleFailure=slug_conflict` 같은 업무 실패로 변환되지 않아야 한다. 본문 편집, React POST, 표지, 첨부 각각은 예약된 초안으로 시작해서 저장 성공 직후 `scheduledAt`, `scheduleGeneration`, `scheduledById`, `scheduledVersion`이 null인지 검사한다. 업로드의 asset insert를 실패시키면 기존 예약과 버전이 함께 보존되어야 한다. 모든 실험에서 발행본은 수정되지 않아야 한다.

이 원고 작성에서는 위 PostgreSQL·HTTP·브라우저 통합 실험을 실행하지 않았다. 명령을 따라 하기 전에 생성된 Prisma client, 스키마 migration, 전용 테스트 DB를 준비해야 한다. 기존 `examples/fluo-blog`는 초기 HTTP·DI 근거이며 이 예약 스키마와 메일 원장을 갖춘 완성 앱이 아니다. 기록 transport 밖의 SMTP나 외부 발송 실험도 수행하지 않았다.

## 정기 작업이 운영 기능이 되는 순간

캐시가 있으면 DB 발행과 독자에게 보이는 순간이 다를 수 있다. 직접 조회가 DB의 공개 상태를 읽어도 목록 캐시에 이전 결과가 남아 있을 수 있다. 20장의 query별 30초 TTL을 예약 발행의 가시성 지연에 포함한다. 즉시 무효화 caller가 이미 존재한다고 가정하지 않는다. 발행된 상세는 `reading-v2-assets` key로 자산 메타데이터까지 읽는다. DB 트랜잭션을 열린 채로 캐시 삭제 완료를 기다려 이 차이를 숨기지 않는다.

작업량이 늘면 30초와 100이라는 두 숫자가 중요한 운영 변수가 된다. 한 배치를 처리하는 데 주기보다 오래 걸리면 tick이 건너뛰어져 적체가 늘 수 있다. 이때 주기를 무조건 줄이는 것은 해법이 아니다. 오래 기한을 넘긴 글의 나이, 실행 시간, DB 부하를 보고 배치 크기를 조정하거나 후보를 병렬 분배하는 방식으로 전환한다. 정기적인 작은 정리는 Cron에 잘 맞지만, 독자별 전달 재시도와 큰 작업의 처리량 제어에는 큐가 더 적합하다.

종료 시 Cron은 새 tick의 진입을 먼저 닫고 예약 handle을 멈춘 뒤 실행 중인 작업을 제한된 시간 동안 기다린다. 기본 drain 상한은 10초이고 위 등록은 5초를 선택했다. 상한이 지났다고 작업의 Promise나 DB 연산이 취소됐다고 생각해서는 안 된다. 따라서 발행 작업은 짧게 커밋하고, 프로세스가 중단돼도 데이터에서 재개할 수 있어야 한다. 종료 전체의 예산과 DB 정리는 23장에서 이 경계와 함께 다룬다.

이제 FluoBlog는 운영자가 접속해 있지 않아도 발행을 시도한다. 대신 “예약했는데 왜 아직 안 보이나요?”라는 질문에 답할 책임이 생겼다. 작업이 실행되지 않았는지, DB가 실패했는지, 발행은 됐지만 캐시가 남았는지 구별할 근거가 필요하다. 다음 장에서는 요청과 백그라운드 작업의 상태를 지표와 구조화된 기록으로 연결한다.

## 구현 근거

- [Cron 등록·시간대·중복 실행·종료 계약](../../packages/cron/README.ko.md)
- [공개 Cron 타입과 scheduler 교체 경계](../../packages/cron/src/types.ts)
- [스케줄러 수명주기와 tick 진입 제어](../../packages/cron/src/service.ts)
- [작업 호출과 오류 hook 처리](../../packages/cron/src/task-runner.ts)
- [종료 중 대기 tick과 lease 경합 테스트](../../packages/cron/src/lifecycle-race.test.ts)
- [Prisma 등록·트랜잭션·종료 계약](../../packages/prisma/README.ko.md)
