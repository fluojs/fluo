# 새 글을 구독자에게 알리기

<!-- book:volume=01-fluoblog;chapter=19 -->

[이전: 표지 이미지와 첨부파일 받기](./ch18-uploads.ko.md) · [목차](./toc.ko.md) · [다음: 인기 글을 빠르게 제공하기](./ch20-caching.ko.md)

## 발행 버튼이 메일 서버를 기다리기 시작했다

FluoBlog의 독자가 다음 글도 읽고 싶다며 구독 기능을 요청한다. 운영자는 처음에 발행 처리 뒤에 수신자 목록을 조회하고 메일을 하나씩 보내려고 한다. 독자가 열 명일 때는 간단하다. 그러나 전송 한 건이 지연되면 발행 요청 전체가 늦어지고, 브라우저가 시간 초과 뒤 다시 제출하면 이미 받은 사람에게 같은 메일이 간다. 메일 실패를 이유로 발행 트랜잭션을 롤백하더라도 외부로 나간 메일은 회수되지 않는다.

이 장은 세 가지 사실을 분리한다. 글은 PostgreSQL에 발행됐는가, 전달할 일이 기록됐는가, 메일 제공자가 특정 수신자를 수락했는가. `@fluojs/queue`는 두 번째 일을 실행할 작업자로 넘기고, `@fluojs/email`은 명시적으로 등록한 transport에 전달한다. Redis가 연결됐다는 사실이나 `enqueue()`가 성공했다는 사실을 독자의 수신함 도착으로 번역하지 않는다.

게시글은 여전히 앞 장의 `Post`다. ID는 양의 정수이고 계정의 subject는 문자열이다. `draft → published` 전이는 기존 발행 트랜잭션에서 한 번만 일어난다. 발행본은 불변이므로 제목을 고칠 때마다 알림을 다시 보내는 기능은 없다. 아래 스키마와 작업 클래스는 이 제품이 소유하는 추가 코드이며, 패키지 등록만으로 생성되는 테이블이 아니다.

실습의 메일 transport는 메모리에 기록만 한다. 실제 SMTP 전송이나 외부 서비스 호출을 수행하지 않는다. PostgreSQL과 Redis를 쓰는 통합 재현은 독자의 격리된 개발 환경에서 하며, 원고 작성 중 실행했다고 주장하지 않는다.

## 동의와 주소 확인을 구독 상태로 남기기

로그인한 사용자가 메일 주소를 적었다는 것만으로 그 주소를 소유한다고 볼 수 없다. 따라서 구독은 신청과 확인을 나눈다. 아래는 `prisma/schema.prisma`의 **필드 추가 부분과 새 모델**이다. 11장의 `Post.publication PostPublication?`와 `PostPublication`의 `id Int`, `postId @unique`, `actorId`, `version`, `publishedAt`, `post` 관계는 그대로 둔다. 별도 `Publication` 모델을 만들지 않는다. 기존 `User`에 `subscription Subscription?`, 기존 `PostPublication`에 `deliveries PostDelivery[]`를 추가한다.

```prisma
// Add inside User.
subscription Subscription?

// Add inside PostPublication.
deliveries PostDelivery[]
```

```prisma
model Subscription {
  userId      String   @id
  user        User     @relation(fields: [userId], references: [id], onDelete: Restrict)
  address     String
  active      Boolean  @default(false)
  tokenHash   String?  @unique
  expiresAt   DateTime?
  deliveries  PostDelivery[]
}

model PostDelivery {
  id              String       @id
  publicationId   Int
  publication     PostPublication @relation(fields: [publicationId], references: [id], onDelete: Restrict)
  subscriberId    String
  subscription    Subscription @relation(fields: [subscriberId], references: [userId], onDelete: Restrict)
  address         String
  status          String       @default("pending")
  dispatchVersion Int          @default(1)
  messageId       String?
  updatedAt       DateTime     @updatedAt

  @@unique([publicationId, subscriberId])
  @@index([status, id])
}
```

```bash
pnpm add @fluojs/email @fluojs/queue @fluojs/redis @fluojs/cron
pnpm exec prisma migrate dev --name add_subscription_deliveries
pnpm exec prisma generate
```

이 migration은 구독 사용자와 기존 발행 기록을 FK로 연결한다. 과거 `PostPublication`의 `actorId`를 지우거나 ID를 다시 매기지 않으며 과거 발행에 소급해서 전달 행을 만들지도 않는다. 이 장 이후의 발행부터 당시 활성 구독자를 펼친다.

`PostDelivery.address`는 발행 당시의 주소 스냅샷이다. 나중에 계정의 주소가 바뀌었다고 과거 작업을 새 주소로 조용히 바꾸지 않는다. 작업 실행 직전에 현재 구독 주소와 다시 비교하고 달라졌으면 취소한다. `active`가 꺼진 구독도 같은 방식으로 제외한다. 해지의 판단 경계는 worker가 구독 상태를 마지막으로 읽는 시점이다. 그 조회 직후 해지가 커밋되어도 이미 진행 중인 전달은 나갈 수 있으며, transport에 넘긴 메일까지 취소한다고 보장하지 않는다.

다음 `src/subscriptions/subscriptions.ts`는 완전한 신청·확인 서비스 파일이다. 10장의 루트 소유 `BlogDatabaseModule`이 전역으로 공개한 `PrismaService`를 주입한다. `userId`에는 HTTP body가 아니라 검증된 principal의 subject를 넘긴다. 신청·확인·해지의 실제 HTTP 연결은 뒤에서 등록한다.

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Inject } from '@fluojs/core';
import { BadRequestException } from '@fluojs/http';
import { EmailService } from '@fluojs/email';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

@Inject(PrismaService, EmailService)
export class Subscriptions {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly email: EmailService,
  ) {}

  async request(userId: string, address: string) {
    const normalized = address.trim();
    if (normalized.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('Invalid email address');
    }
    const token = randomBytes(32).toString('hex');
    await this.prisma.current().subscription.upsert({
      where: { userId },
      create: {
        userId, address: normalized, tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
      update: {
        address: normalized, active: false, tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const receipt = await this.email.send({
      to: normalized,
      subject: 'Confirm your FluoBlog subscription',
      text: `Paste this code into the subscription confirmation form: ${token}`,
    });
    return receipt.accepted.length === 1 &&
      receipt.pending.length === 0 && receipt.rejected.length === 0;
  }

  async confirm(userId: string, token: string) {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new BadRequestException('Invalid confirmation code');
    }
    const result = await this.prisma.current().subscription.updateMany({
      where: {
        userId, active: false, tokenHash: digest(token),
        expiresAt: { gt: new Date() },
      },
      data: { active: true, tokenHash: null, expiresAt: null },
    });
    if (result.count !== 1) {
      throw new BadRequestException('Confirmation expired or already used');
    }
  }

  async unsubscribe(userId: string) {
    await this.prisma.current().subscription.updateMany({
      where: { userId },
      data: { active: false, tokenHash: null, expiresAt: null },
    });
  }
}
```

확인 코드는 URL에 넣지 않고 메일에서 확인 폼으로 붙여 넣는다. 접근 로그의 URL에 비밀이 남는 문제를 피하고, 17장의 기본 폼만으로 동작하게 하려는 선택이다. HTTP 응답이나 애플리케이션 로그에는 코드 원문을 넣지 않는다. 메일 전송 실패 시 pending 구독은 남지만 활성화되지는 않는다. 신청을 다시 하면 코드가 교체되어 이전 코드는 사용할 수 없다.

이 간단한 구현은 가입 순간의 확인 메일을 요청에서 한 번 보낸다. 그래서 제공자 지연은 구독 신청에만 영향을 주고 글 발행에는 영향을 주지 않는다. 신청 API에는 16장의 제한을 적용해 반복 발송을 통제한다. 대규모 가입 유입을 받게 되면 확인 메일도 별도의 전달 원장으로 옮길 수 있지만, 글 알림의 핵심 경로부터 큐로 분리한다. 주소 확인 여부를 형식 검사와 혼동하지 않는 것이 우선이다.

## 발행과 함께 전달 의도를 저장하기

글을 커밋한 뒤 `enqueue()`만 호출하면 프로세스가 그 사이에서 죽었을 때 알림이 사라진다. 반대로 먼저 enqueue하면 아직 커밋되지 않은 글을 알릴 수 있다. 이 장에서는 기존 발행 트랜잭션 안에 `PostPublication`과 `PostDelivery`를 저장하고, 커밋 뒤에 pending 행을 큐로 전달한다. 이는 애플리케이션이 직접 만든 전달 원장이다. PostgreSQL과 Redis 사이에 분산 트랜잭션이 생긴 것은 아니다.

다음 `src/subscriptions/record-publication-deliveries.ts`는 완전한 함수 파일이다. 발행 원장을 만드는 함수가 아니라 **이미 같은 트랜잭션에서 만든 발행 기록 ID**에 전달 의도를 붙인다. 독립 DB나 다른 트랜잭션을 열지 않는다.

```ts
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

export async function recordPublicationDeliveries(
  tx: Prisma.TransactionClient, publicationId: number,
): Promise<void> {
  const subscribers = await tx.subscription.findMany({
    where: { active: true },
    select: { userId: true, address: true },
    orderBy: { userId: 'asc' },
  });
  for (let offset = 0; offset < subscribers.length; offset += 200) {
    await tx.postDelivery.createMany({
      data: subscribers.slice(offset, offset + 200).map((subscriber) => ({
        id: randomUUID(),
        publicationId,
        subscriberId: subscriber.userId,
        address: subscriber.address,
      })),
    });
  }
}
```

이제 **`src/posts/publishing.service.ts`에 아래 import와 반환 직전 변경을 적용한다.** 나머지 `PublishCommand`, `PublishRejected`, 도메인 검사, slug 충돌 매핑, `@Transaction`, 조건부 갱신은 11장의 코드 그대로다. `PostsModule`의 기존 `PublishingService` 등록도 그대로 사용한다. 새 서비스 토큰을 추가할 필요가 없는 일반 함수이므로 순환 모듈 의존성도 만들지 않는다.

```diff
 import { PostPublicationsRepository } from './post-publications.repository.js';
+import { recordPublicationDeliveries } from '../subscriptions/record-publication-deliveries.js';
@@
     const publication = await this.publications.record({
       postId: row.id, actorId: command.actorId, version: next.version, publishedAt,
     });
+    await recordPublicationDeliveries(this.prisma.current(), publication.id);
     return receipt(publication);
```

`PostPublication.postId`의 유일성과 기존 발행의 조건부 갱신이 중복 발행을 막는다. 전달 행은 `(publicationId, subscriberId)`에 대해서도 유일하다. 전달 insert가 실패하면 글 공개와 `actorId`를 포함한 감사 기록도 롤백된다. 수동 `POST /posts/:id/publish`는 기존 `PostWritingService → PostsService → PublishingService.publish` 연결을 통해 이 코드를 실행한다. 여러 번 dispatch하더라도 새 구독 목록을 계속 펼치는 대신 이미 확정한 행을 사용한다. 구독을 커밋한 시점과 발행 중 구독 목록을 조회한 시점이 겹친 사용자는 그 SQL 조회의 PostgreSQL 가시성에 따라 이번 발행의 대상이 되거나 다음 발행부터 대상이 된다.

이 구현은 현재의 작은 구독 목록에 맞는다. 조회한 목록 전체가 메모리에 있고, 200개씩 나누어 insert해도 전체 트랜잭션 시간은 줄어들지 않는다. 수십만 명이 되면 발행에는 publication만 기록하고 커서와 대상 기준 시점을 갖춘 별도 fan-out 작업이 필요하다. 처음부터 그 시스템을 복제하지 않는 대신 현재 선택의 한계를 숫자로 관찰한다. 발행 트랜잭션 지연과 대상 수를 함께 기록하면 전환 시점을 결정할 수 있다.

## 정확한 작업 클래스를 보내고 한 주소씩 처리하기

큐 payload에는 delivery ID 하나만 넣는다. Prisma 객체, `Date`, 함수, 메일 transport를 직렬화하지 않는다. 작업은 JSON object로 저장되고 등록된 prototype으로 복원되지만 constructor가 다시 실행된다고 기대해서는 안 된다. `new SendPostEmailJob(id)`의 constructor identity가 worker 탐색의 기준이므로 같은 모양의 plain object나 복사한 클래스는 올바른 producer가 아니다.

다음 `src/subscriptions/email-jobs.ts`는 완전한 작업 파일이다. 전역 `PrismaService`와 `AppSettings`를 그대로 사용한다. `jobName`은 리팩터링한 클래스 이름과 무관하게 고정해서 이미 Redis에 저장된 작업의 식별자를 보존한다.

```ts
import { Inject } from '@fluojs/core';
import { EmailService } from '@fluojs/email';
import { QueueLifecycleService, QueueWorker } from '@fluojs/queue';
import { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';
import { AppSettings } from '../config/app-settings.js';

export class SendPostEmailJob {
  constructor(public readonly deliveryId: string) {}
}

export class AmbiguousDeliveryError extends Error {
  constructor(readonly deliveryId: string) {
    super(`Delivery requires reconciliation: ${deliveryId}`);
  }
}

@Inject(PrismaService, QueueLifecycleService)
export class PendingEmailDispatcher {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly queue: QueueLifecycleService,
  ) {}

  async dispatchPending(): Promise<number> {
    let cursor: string | undefined;
    let dispatched = 0;
    for (;;) {
      const rows = await this.prisma.current().postDelivery.findMany({
        where: { status: 'pending' },
        select: { id: true, dispatchVersion: true },
        orderBy: { id: 'asc' }, take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) return dispatched;
      await this.queue.enqueueMany(rows.map((row) => ({
        job: new SendPostEmailJob(row.id),
        options: { deduplicationKey: `post-email:${row.id}:${row.dispatchVersion}` },
      })));
      dispatched += rows.length;
      cursor = rows[rows.length - 1]?.id;
    }
  }
}

@Inject(PrismaService, EmailService, AppSettings)
@QueueWorker(SendPostEmailJob, {
  jobName: 'blog-post-email-v1',
  concurrency: 4,
  attempts: 3,
  backoff: { type: 'exponential', delayMs: 1000 },
})
export class PostEmailWorker {
  constructor(
    private readonly prisma: PrismaService<PrismaClient>,
    private readonly email: EmailService,
    private readonly settings: AppSettings,
  ) {}

  async handle(job: SendPostEmailJob): Promise<void> {
    const current = await this.prisma.current().postDelivery.findUnique({
      where: { id: job.deliveryId },
    });
    if (!current) return;
    if (current.status === 'sending' || current.status === 'uncertain') {
      throw new AmbiguousDeliveryError(current.id);
    }
    if (current.status !== 'pending') return;
    const claim = await this.prisma.current().postDelivery.updateMany({
      where: { id: current.id, status: 'pending' },
      data: { status: 'sending' },
    });
    if (claim.count !== 1) return;

    try {
      const delivery = await this.prisma.current().postDelivery.findUniqueOrThrow({
        where: { id: current.id },
        include: { subscription: true, publication: { include: { post: true } } },
      });
      if (!delivery.subscription.active ||
          delivery.subscription.address !== delivery.address) {
        await this.prisma.current().postDelivery.update({
          where: { id: delivery.id }, data: { status: 'cancelled' },
        });
        return;
      }
      const receipt = await this.email.send({
        to: delivery.address,
        subject: `New post: ${delivery.publication.post.title}`,
        text: `${delivery.publication.post.title}\n` +
          `${this.settings.publicOrigin}/posts/${delivery.publication.postId}/read\n` +
          'Manage your subscription from your FluoBlog account.',
        metadata: { deliveryId: delivery.id },
      });
      const accepted = receipt.accepted.length === 1 &&
        receipt.pending.length === 0 && receipt.rejected.length === 0;
      const rejected = receipt.accepted.length === 0 &&
        receipt.pending.length === 0 && receipt.rejected.length === 1;
      await this.prisma.current().postDelivery.update({
        where: { id: delivery.id },
        data: {
          status: accepted ? 'accepted' : rejected ? 'rejected' : 'uncertain',
          messageId: receipt.messageId,
        },
      });
      if (!accepted && !rejected) throw new AmbiguousDeliveryError(delivery.id);
    } catch (error) {
      await this.prisma.current().postDelivery.updateMany({
        where: { id: current.id, status: 'sending' },
        data: { status: 'uncertain' },
      });
      throw error;
    }
  }
}
```

한 delivery에 한 주소만 넣으면 수신자 한 명의 실패 때문에 성공한 여러 명에게 다시 보내는 문제를 피할 수 있다. `EmailService.send()`는 `accepted`, `pending`, `rejected`를 보존한다. Promise가 resolve했다는 사실만 보고 성공 처리하면 부분 실패를 놓친다. 이 워커의 `accepted`는 제공자가 받아들였다는 뜻이며, 스팸 분류나 최종 수신함 도착까지 확인한 값은 아니다.

`pending → sending`은 PostgreSQL의 조건부 갱신으로 선점한다. 분산 worker 두 개가 같은 delivery를 봐도 한 개만 전송을 시작한다. 그러나 `sending` 상태에서 프로세스가 죽으면 실제 전달 여부는 모른다. 코드는 그 행을 다시 만나도 자동 전송하지 않고 `AmbiguousDeliveryError`로 남긴다. 중복 없는 전달을 꾸며내는 대신 중복 가능성이 있는 경계를 운영자가 볼 수 있게 한 것이다.

큐의 재시도는 선점 전 DB 오류 같은 실패를 다시 실행하는 데 도움이 된다. 전송을 시작한 뒤 오류는 원장에 `uncertain`으로 남기고 재시도에서도 같은 경고를 내므로, 3회 시도 설정이 메일 3통을 뜻하지 않는다. 이 보수적인 정책은 가용성보다 불확실한 중복 발송 방지를 우선한다. 일정 확률의 중복보다 누락이 더 나쁜 알림이라면 재시도 정책을 바꿀 수 있지만, 그때도 제공자 멱등성 계약 없이 exactly-once라고 부르면 안 된다.

## Redis와 메일의 소유자를 명시하기

먼저 HTTP 연결을 닫는다. **`src/subscriptions/subscriptions-controller.ts` 전체**는 쿠키 인증을 사용하는 세 POST API와 네이티브 폼을 함께 제공한다. `/subscriptions`에서 신청·확인·해지를 제출하며 성공하면 303으로 GET에 돌아온다. JSON 요청도 같은 필드 검사를 통과해야 하지만 이 경로의 성공 계약은 JSON 응답이 아니라 303이다. 17장의 로그인 페이지에서 먼저 로그인해야 하며 `userId`를 hidden input으로 받지 않는다.

```ts
import { createElement } from 'react';
import { Inject } from '@fluojs/core';
import {
  BadRequestException, FromBody, Header, Post, RequestDto,
  UnauthorizedException, UseGuards, type RequestContext,
} from '@fluojs/http';
import { Path, Router } from '@fluojs/react';
import { Throttle, ThrottlerGuard } from '@fluojs/throttler';
import { FormsAuthGuard, FormOriginGuard } from '../auth/forms-auth.module.js';
import { Subscriptions } from './subscriptions.js';

class SubscriptionRequestDto {
  @FromBody('address') address: unknown = '';
}
class SubscriptionConfirmDto {
  @FromBody('token') token: unknown = '';
}

function subject(context: RequestContext): string {
  if (!context.principal) throw new UnauthorizedException();
  return context.principal.subject;
}

@Inject(Subscriptions)
@Router('/subscriptions')
@Header('Cache-Control', 'private, no-store')
export class SubscriptionsController {
  constructor(private readonly subscriptions: Subscriptions) {}

  @Path('/')
  @UseGuards(FormsAuthGuard)
  show(_input: unknown, context: RequestContext) {
    subject(context);
    return createElement('main', null,
      createElement('h1', null, 'Manage your subscription'),
      createElement('form', {
        method: 'post', action: '/subscriptions/request', encType: 'multipart/form-data',
      },
      createElement('label', { htmlFor: 'address' }, 'Email address'),
      createElement('input', {
        id: 'address', name: 'address', type: 'email', required: true, maxLength: 254,
      }),
      createElement('button', { type: 'submit' }, 'Request confirmation')),
      createElement('form', {
        method: 'post', action: '/subscriptions/confirm', encType: 'multipart/form-data',
      },
      createElement('label', { htmlFor: 'token' }, 'Confirmation code'),
      createElement('input', {
        id: 'token', name: 'token', required: true, minLength: 64, maxLength: 64,
        autoComplete: 'off',
      }),
      createElement('button', { type: 'submit' }, 'Confirm subscription')),
      createElement('form', { method: 'post', action: '/subscriptions/unsubscribe' },
        createElement('button', { type: 'submit' }, 'Unsubscribe')),
    );
  }

  @Post('/request')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 300, limit: 3 })
  @RequestDto(SubscriptionRequestDto)
  async request(input: SubscriptionRequestDto, context: RequestContext) {
    if (typeof input.address !== 'string') throw new BadRequestException('Expected an email address.');
    await this.subscriptions.request(subject(context), input.address);
    context.response.redirect(303, '/subscriptions');
  }

  @Post('/confirm')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 5 })
  @RequestDto(SubscriptionConfirmDto)
  async confirm(input: SubscriptionConfirmDto, context: RequestContext) {
    if (typeof input.token !== 'string') throw new BadRequestException('Expected a confirmation code.');
    await this.subscriptions.confirm(subject(context), input.token);
    context.response.redirect(303, '/subscriptions');
  }

  @Post('/unsubscribe')
  @UseGuards(FormsAuthGuard, FormOriginGuard, ThrottlerGuard)
  @Throttle({ ttl: 60, limit: 20 })
  async unsubscribe(_input: unknown, context: RequestContext) {
    await this.subscriptions.unsubscribe(subject(context));
    context.response.redirect(303, '/subscriptions');
  }
}
```

인증은 `FormsAuthModule`이 export하는 `FormsAuthGuard`가 맡으며 내부적으로 14장의 `BlogTokenAuthenticator.authenticateToken`을 사용한다. 별도 Passport 전략 레지스트리를 추가하지 않는다. 독자 구독에는 `posts:write`가 필요하지 않으므로 `requireFormWriter`를 호출하지 않는다. POST의 `FormOriginGuard`는 검증된 `AppSettings.publicOrigin`과 정확히 비교하며 누락도 403이다. `ThrottlerGuard`는 16장의 전역 `ProtectionModule` 등록을 사용한다. 메모리 IP 제한의 다중 인스턴스 한계와 프록시 정책도 그대로다. HTML의 `required`를 지워도 DTO와 서비스의 검사는 남는다.

구독 요청의 303은 **신청 처리**의 결과이지 메일 도착 확인이 아니다. 확인 토큰은 transport에만 전달하고 응답에 내보내지 않는다. 기록 transport를 쓰는 실습에서는 테스트가 보관한 메시지에서 토큰을 얻는다. 실제 메일은 별도 승인과 transport 설정 없이는 전송하지 않는다.

전달 원장에는 실제로 반복 실행하는 호출자가 필요하다. 다음 두 파일을 만든다. **`src/jobs/blog-jobs.module.ts` 전체**는 앱의 유일한 Cron 등록이다. 21장도 이 모듈을 재사용하며 `CronModule.forRoot`를 새로 호출하지 않는다.

```ts
import { Module } from '@fluojs/core';
import { CronModule } from '@fluojs/cron';

@Module({
  imports: [CronModule.forRoot({ global: true, shutdown: { timeoutMs: 5_000 } })],
})
export class BlogJobsModule {}
```

**`src/subscriptions/email-dispatch-schedule.ts` 전체**에서 tick의 본문은 실제 dispatcher를 await한다. 발행 요청의 성공 뒤에 Redis 실패를 덧붙이지 않고, DB에 남은 pending 행을 다음 tick에서 복구한다.

```ts
import { Inject } from '@fluojs/core';
import { Cron, CronExpression } from '@fluojs/cron';
import { PendingEmailDispatcher } from './email-jobs.js';

@Inject(PendingEmailDispatcher)
export class EmailDispatchSchedule {
  constructor(private readonly dispatcher: PendingEmailDispatcher) {}

  @Cron(CronExpression.EVERY_30_SECONDS, { name: 'subscriptions.dispatch-pending' })
  async tick(): Promise<void> {
    const dispatched = await this.dispatcher.dispatchPending();
    console.info(JSON.stringify({ event: 'subscriptions.dispatched', dispatched }));
  }
}
```

다음 `src/subscriptions/subscriptions.module.ts`는 완전한 모듈 factory다. 기본 Redis가 이미 등록되어 있을 가능성이 있으므로 `mail-jobs`라는 이름 있는 연결을 사용한다. 같은 이름은 앱 전체에서 한 번만 등록한다. `RedisModule.forRoot()`에는 애플리케이션 경계에서 이미 해석한 설정을 전달한다. 이 Redis 등록에 없는 `forRootAsync()`를 만들어 쓰지 않는다. 반면 메일은 실제 `EmailModule.forRootAsync({ inject, useFactory })` API도 지원한다. 비밀 설정을 DI로 해석할 때 그 경로로 교체할 수 있다.

```ts
import { createElement } from 'react';
import {
  EmailModule,
  type EmailTransport, type EmailTransportContext, type NormalizedEmailMessage,
} from '@fluojs/email';
import { QueueModule } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';
import { ReactModule, createReactServerEntry } from '@fluojs/react';
import { FormsAuthModule } from '../auth/forms-auth.module.js';
import { BlogJobsModule } from '../jobs/blog-jobs.module.js';
import { Document } from '../posts/post-pages.js';
import { PendingEmailDispatcher, PostEmailWorker } from './email-jobs.js';
import { EmailDispatchSchedule } from './email-dispatch-schedule.js';
import { Subscriptions } from './subscriptions.js';
import { SubscriptionsController } from './subscriptions-controller.js';

export class RecordingEmailTransport implements EmailTransport {
  readonly messages: NormalizedEmailMessage[] = [];

  async send(message: NormalizedEmailMessage, context: EmailTransportContext) {
    context.signal?.throwIfAborted();
    this.messages.push(structuredClone(message));
    return {
      accepted: message.to.map((entry) => entry.address),
      rejected: [], pending: [],
      messageId: `recording-${this.messages.length}`,
    };
  }
}

export function createSubscriptionsModule(
  redis: { readonly host: string; readonly port: number },
  transport: EmailTransport,
) {
  return ReactModule.forRoot({
    imports: [
      FormsAuthModule, BlogJobsModule,
      RedisModule.forRoot({ name: 'mail-jobs', ...redis }),
      QueueModule.forRoot({ clientName: 'mail-jobs' }),
      EmailModule.forRoot({
        defaultFrom: { name: 'FluoBlog', address: 'noreply@example.test' },
        transport: { kind: 'blog-mail', create: () => transport, ownsResources: false },
      }),
    ],
    controllers: [SubscriptionsController],
    providers: [
      Subscriptions, PendingEmailDispatcher, PostEmailWorker, EmailDispatchSchedule,
    ],
    exports: [Subscriptions, PendingEmailDispatcher],
    renderPage: (page) => createReactServerEntry(createElement(Document, null, page)),
  });
}
```

루트 **`src/app.ts`의 기존 import들과 `AppModule.imports`에 다음 조각만 추가한다**. 기존 `AppSettingsModule`, `BlogDatabaseModule`, 인증·게시글·React·업로드·OpenAPI·보호 모듈을 삭제하지 않는다. 예제 Redis는 로컬의 명시적 주소이며, 배포에서는 기존 설정 해석 경계에서 검증한 연결 옵션을 이 인수로 전달한다. DB나 공개 출처를 별도 전역 변수로 다시 만드는 factory가 아니다.

```diff
+import { createSubscriptionsModule, RecordingEmailTransport } from './subscriptions/subscriptions.module.js';
@@
   imports: [
+    createSubscriptionsModule({ host: '127.0.0.1', port: 6379 }, new RecordingEmailTransport()),
```

기록 transport 인스턴스의 메시지는 테스트에서만 검사하고 원문을 로그에 출력하지 않는다. 운영 transport로 바꿀 때도 같은 포트가 필요하다. Node SMTP를 선택한다면 `@fluojs/email/node`의 `createNodemailerEmailTransportFactory`가 별도로 있고, 루트 import가 SMTP를 자동 설정하지 않는다.

Redis의 원본 연결은 Redis module이 소유한다. Queue는 BullMQ용 duplicate 연결을 만들고 자기 연결만 닫는다. worker는 전체 앱의 bootstrap-ready 이후 시작되며, 단순히 decorated class를 import하는 것만으로 발견되지 않는다. 위처럼 singleton provider로 등록해야 한다. 종료가 시작되면 새 enqueue는 거부되며, worker close의 각 단계는 설정된 timeout budget을 따른다. EmailService도 종료 뒤 새 전송을 받아들여 transport를 다시 만들지 않는다.

## 다시 보내기 전에 원장을 읽는다

등록된 `EmailDispatchSchedule.tick()`이 30초마다 `PendingEmailDispatcher.dispatchPending()`을 호출한다. Cron은 `onApplicationBootstrap`에서 스케줄을 등록하고 Queue worker는 전체 bootstrap-ready 이후 시작하므로 둘을 같은 ready 신호라고 설명하지 않는다. 준비 전 enqueue나 Redis 장애가 오류를 내면 Cron의 오류 경계로 전파되고 pending 행은 남는다. 다음 tick이 같은 원장을 다시 읽는다. 조회 중 cursor보다 앞에 새로 생성된 행도 다음 실행에서 잡힌다. 21장에서는 이 caller를 유지한 채 발행용 tick만 추가한다.

`enqueueMany()`는 한 worker queue를 대상으로 하는 유효한 batch를 BullMQ의 한 `addBulk()` 호출로 기록한다. 여러 페이지나 PostgreSQL 트랜잭션까지 원자적으로 묶지는 않는다. 응답이 사라져 같은 페이지를 다시 보내도 delivery ID와 dispatch version에서 만든 `deduplicationKey`가 같으므로 같은 backing job identity를 사용한다. 완료·실패 작업을 지운 뒤까지 영원한 중복 방지라고 일반화하지 않는다. DB 원장의 terminal 상태 검사가 더 긴 수명의 방어선이다.

운영 조회는 큐와 DB를 함께 본다. `queue.inspectDeadLetters('blog-post-email-v1', { limit: 25 })`는 read-only이며 malformed record를 건너뛴다. 기본 dead-letter 보관은 작업별 최근 1,000개이고, 모든 실패의 영구 감사 로그가 아니다. `sending`, `uncertain`, `rejected` 행의 수와 오래된 `updatedAt`도 조회해야 한다. `rejected`는 제공자가 거부했다는 결과이고 `uncertain`은 결과를 확정하지 못했다는 상태라 대응이 다르다.

아래는 `src/subscriptions/reconcile-delivery.ts`의 완전한 관리 함수다. worker가 멈추거나 해당 작업이 terminal 실패인 것을 확인한 뒤, 인가된 관리 경로에서만 호출한다. `accepted` 결정은 제공자 기록으로 수락을 확인한 경우, `retry` 결정은 수락되지 않았음을 확인했거나 중복 위험을 명시적으로 수용한 경우다. 실패한 BullMQ job이 같은 deduplication key에 남아 있을 수 있으므로 재전송 결정 때 dispatch version도 올린다.

```ts
import { ConflictException } from '@fluojs/http';
import type { PrismaService } from '@fluojs/prisma';
import type { PrismaClient } from '@prisma/client';

export async function reconcileDelivery(
  prisma: PrismaService<PrismaClient>, id: string, decision: 'accepted' | 'retry',
) {
  const result = await prisma.current().postDelivery.updateMany({
    where: { id, status: { in: ['sending', 'uncertain', 'rejected'] } },
    data: decision === 'accepted'
      ? { status: 'accepted' }
      : { status: 'pending', dispatchVersion: { increment: 1 }, messageId: null },
  });
  if (result.count !== 1) {
    throw new ConflictException('Delivery state changed');
  }
}
```

이 함수가 제공자 조회를 대신하지 않는다. 근거 없이 pending으로 바꾸는 버튼을 공개하면 보수적으로 설계한 worker가 무력해진다. 관리자는 판단 근거를 별도 운영 기록에 남기고 retry 뒤 dispatcher를 호출한다. 기록 transport를 사용하는 실습에서는 저장된 메시지의 `metadata.deliveryId`를 대조할 수 있다. 실제 제공자에서는 그 제공자가 지원하는 검색·멱등성 기능을 검토해야 한다.

## 타이밍을 기다리지 않는 실패 실험

먼저 기록 transport로 신청하고, 테스트가 보관한 메일 본문에서 확인 코드를 추출해 `confirm()`에 전달한다. DB의 `active`가 true이고 같은 코드를 두 번 쓰면 두 번째가 400이어야 한다. 해지 뒤 publication을 기록하면 그 사용자의 새 delivery가 없어야 한다. 발행 뒤 worker의 구독 조회 전에 해지를 커밋한 경우는 delivery가 만들어졌어도 `cancelled`로 끝내고 transport 기록은 늘지 않아야 한다.

큐 통합 실험은 Redis와 PostgreSQL이 필요하다. `dispatchPending()`을 두 번 호출하고 실제 worker 완료 신호를 구독해 기다린다. 고정된 sleep 뒤 메시지 배열 길이를 읽으면 느린 머신에서 우연히 통과하거나 실패한다. 테스트 transport의 `send`가 시작됐다는 Promise와 완료를 허용하는 Promise를 별도로 두면, 수락 직후 DB 기록 실패 같은 경계도 정확히 멈출 수 있다. 제한된 timeout은 실패 종료용이지 작업이 끝났다고 추정하는 시간값이 아니다.

부분 실패 transport는 정상 resolve하면서 `accepted: []`, `rejected: ['reader@example.test']`, `pending: []`를 반환하도록 만든다. 기대 결과는 `rejected` 원장이지 `accepted`가 아니다. 제공자가 받아들인 뒤 네트워크 오류를 흉내 내면 원장은 `uncertain`이며, 같은 job의 재시도에서 transport 호출 수가 증가하면 안 된다. DB 읽기가 선점 전에 실패했다가 회복되는 경우에는 다음 시도에서 전송이 가능해야 한다.

종료 실험에서는 transport의 진행 중인 send를 이벤트로 붙잡은 채 앱 close를 시작한다. 새 enqueue는 거부되어야 하고, 이미 시작한 작업을 어떻게 마무리했는지 원장과 큐 상태가 설명해야 한다. shutdown timeout을 exactly-once의 보장으로 취급하지 않는다. 종료 중 사라진 응답이나 dead-letter 기록 실패도 독립된 실패다.

이제 운영자는 발행 요청의 성공과 메일 전달 상태를 따로 설명할 수 있다. 구독자는 같은 블로그의 사용자이며, 2권에서 상품 소식을 받더라도 계정을 다시 만들지 않는다. 당장 다음 문제는 알림을 받은 독자가 같은 인기 글로 몰려오는 상황이다. 다음 장에서는 불변 발행본을 이용해 조회 비용을 줄이되, 캐시가 권한과 진실의 원천이 되지 않도록 한다.

## 구현 근거

- [Queue README: producer, 재시도, batch, 종료](../../packages/queue/README.ko.md), [공개 export](../../packages/queue/src/index.ts)
- [작업 직렬화와 deduplication key 구현](../../packages/queue/src/service.ts), [worker·batch·종료 회귀 테스트](../../packages/queue/src/module.test.ts)
- [Email README: transport와 수락 결과](../../packages/email/README.ko.md), [메일 공개 타입](../../packages/email/src/types.ts)
- [부분 수락·abort·shutdown 테스트](../../packages/email/src/module.test.ts), [Email 공개 export](../../packages/email/src/index.ts)
- [Redis README: 이름 있는 연결과 소유권](../../packages/redis/README.ko.md), [Redis 공개 export](../../packages/redis/src/index.ts)
