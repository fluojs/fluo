# 이메일·Slack·Discord로 같은 사건 전달하기

<!-- book:volume=02-fluoshop;chapter=18 -->

[이전: 여러 단계의 주문 처리를 조율하기](./ch17-order-sagas.ko.md) · [목차](./toc.ko.md) · [다음: 주문 상태를 실시간으로 보여주기](./ch19-realtime-orders.ko.md)

## 같은 주문을 세 사람이 다르게 읽는다

FluoBlog에서 글을 구독하던 독자는 티셔츠를 주문한 뒤 이메일 확인서를 기다린다. 운영자는 Slack에서 결제 완료를 보고 고객 문의에 대비한다. 소규모 포장 팀은 비공개 Discord 공간에서 배송 준비 대상을 확인한다. 세 알림은 같은 주문에서 비롯되지만 같은 문장을 복사해서 보내는 기능은 아니다. 고객에게는 금액과 주문 조회 링크가 필요하고, 운영자에게는 사건 식별자와 처리 단계가 필요하며, 포장 담당자에게는 개인정보를 제외한 인계 안내가 필요하다.

지난 장의 Saga는 확정된 결제에서 포장을 요청하고, 포장 결과에 따라 배송 인계 또는 환불을 요청했다. 그 판단과 알림을 한 트랜잭션처럼 취급하면 Slack 장애 때문에 결제된 주문이 실패로 보인다. 알림은 이미 확정된 사실을 전달하는 부수 효과다. 전달 실패가 주문 상태를 `paid`에서 `pending_payment`로 되돌릴 이유는 없다. 주문의 Outbox에서 알림 작업이 나오는 지점과 알림이 외부 서비스에 전달되는 지점을 분리해야 한다.

결제 알림의 입력은 `src/payments/payment-ledger.ts`의 `PaymentLedger.prepare/record`와 앞선 결과 반영 경계에 연결한다. `prepare`로 저장한 시도 ID·금액을 사용한 외부 청구가 성공했다고 곧바로 알림을 보내지는 않는다. `OrderInventoryService.confirmPayment`가 예약을 `consumed`로 만들고, `OrderTransitionsService.apply`가 주문 상태·버전·`OrderTransition` 감사를 함께 기록한 확정 결과를 Outbox로 받는다. 결제사 성공 응답과 로컬 업무 반영 사이에 장애가 생겼다면 대사 대상이지 아직 결제 완료 안내를 보낼 근거가 아니다.

처음에는 `EmailService.send` 한 번이면 충분했다. 1권의 구독 메일에서 사용한 전송 설정과 발신자 도메인을 계속 사용할 수 있다. 채널이 셋으로 늘면 주문 서비스가 SMTP 주소 정규화, Slack의 `text`, Discord의 `content`를 모두 알아야 하는 구조가 부담이 된다. 그렇다고 모든 채널을 동일한 payload로 강제하면 각 서비스의 의미를 잃는다. 이 장에서는 공통 요청 봉투와 채널별 변환을 나누고, 부분 실패를 실제 결과로 남기는 작은 알림 경계를 만든다.

## 공통인 것은 봉투이고 내용은 채널의 계약이다

`@fluojs/notifications`는 `channel`, `id`, `recipients`, `subject`, `template`, `payload`, `metadata` 등을 가진 요청을 받아 등록된 채널로 보낸다. 이메일이나 Slack 구현을 스스로 발견하거나 설치하지 않는다. `NotificationChannel` 값을 `channels`에 명시적으로 넣어야 한다. 이 장에서는 직접 채널 인터페이스를 흉내 내지 않고 `@fluojs/email`의 `EMAIL_CHANNEL`, `@fluojs/slack`의 `SLACK_CHANNEL`, `@fluojs/discord`의 `DISCORD_CHANNEL`을 사용한다. 그래야 부분 이메일 수락, recipient 해석, 전송 취소 같은 실제 패키지 동작을 함께 검증할 수 있다.

세 채널의 대상 지정은 서로 다르다. 이메일 recipient는 이메일 주소다. Slack의 하나의 dispatch는 하나의 대상 채널로 해석되며 `payload.channel`, 단일 recipient, 기본 채널 순으로 대상을 정한다. Discord recipient는 이메일 주소나 사용자 ID가 아니라 이 통합에서의 thread 경로다. `payload.threadId`, 단일 recipient, 기본 thread가 그 경계다. 여러 Slack 채널이나 Discord thread에 보내려면 요청을 각각 만들거나 해당 서비스의 `sendMany`를 사용한다. 하나의 요청에 여러 recipient를 넣는 것이 세 시스템에서 같은 의미라고 가정하지 않는다.

아래 `src/notifications/order-notifications.ts`는 **완전한 애플리케이션 파일**이다. DB 조회나 전송을 하지 않고, 확인된 결제 사건과 기존 계정에서 얻은 수신자 정보로 세 요청을 만든다. 이 장의 `PaidNotice`는 알림용 스냅샷이며 저장소의 주문 모델을 대체하지 않는다. `totalMinor`는 JSON 경계를 넘은 십진 문자열이다. 통화와 금액은 이미 결제 처리 경계에서 검증된 값이며, 코드에서 소수로 다시 계산하지 않는다. 현재 `ProductVariant.priceMinor`를 조회해 과거 결제 금액을 다시 산출하지도 않는다.

```ts
import { Inject } from '@fluojs/core';
import {
  NotificationsService,
  type NotificationDispatchBatchResult,
  type NotificationDispatchRequest,
} from '@fluojs/notifications';

export type PaidNotice = Readonly<{
  eventId: string;
  id: string;
  customerId: string;
  status: 'paid';
  currency: 'KRW';
  totalMinor: string;
  version: number;
}>;

export type CustomerContact = Readonly<{
  id: string;
  email: string;
}>;

export function planPaidNotifications(
  order: PaidNotice,
  customer: CustomerContact,
): NotificationDispatchRequest[] {
  if (customer.id !== order.customerId) {
    throw new Error('Recipient does not own the order');
  }
  const noticeId = `order:${order.id}:paid:${order.version}`;
  const orderUrl = `https://shop.example.com/orders/${encodeURIComponent(order.id)}`;

  return [
    {
      id: `${noticeId}:email:customer`,
      channel: 'email',
      recipients: [customer.email],
      subject: `Payment confirmed for ${order.id}`,
      payload: {
        text: [
          `Order ${order.id} is paid.`,
          `Total: ${order.totalMinor} ${order.currency}`,
          `View order: ${orderUrl}`,
        ].join('\n'),
      },
      metadata: { eventId: order.eventId, orderId: order.id },
    },
    {
      id: `${noticeId}:slack:operations`,
      channel: 'slack',
      recipients: ['#shop-operations'],
      payload: {
        text: `Payment confirmed: ${order.id}, ${order.totalMinor} KRW`,
        mrkdwn: false,
        unfurlLinks: false,
        unfurlMedia: false,
      },
      metadata: { eventId: order.eventId, orderId: order.id },
    },
    {
      id: `${noticeId}:discord:packing`,
      channel: 'discord',
      recipients: ['123456789012345678'],
      payload: {
        content: `Payment confirmed for ${order.id}. Wait for a packing task.`,
        allowedMentions: { parse: [] },
      },
      metadata: { eventId: order.eventId },
    },
  ];
}

@Inject(NotificationsService)
export class OrderNotifications {
  constructor(private readonly notifications: NotificationsService) {}

  async send(
    order: PaidNotice,
    customer: CustomerContact,
  ): Promise<NotificationDispatchBatchResult> {
    return this.notifications.dispatchMany(
      planPaidNotifications(order, customer),
      { continueOnError: true, queue: false },
    );
  }

  async retryFailures(
    previous: NotificationDispatchBatchResult,
  ): Promise<NotificationDispatchBatchResult> {
    return this.notifications.dispatchMany(
      previous.failures.map(failure => failure.notification),
      { continueOnError: true, queue: false },
    );
  }
}
```

코드 블록의 안내 문구와 예제 데이터는 영문판과 동일하게 유지하기 위해 영어다. 실제 제품의 한국어·영어 메시지는 같은 사건 계약을 입력으로 받는 번역 템플릿에서 관리한다. 여기서는 먼저 텍스트 전달과 실패 경계를 고정한다. 사용자 입력을 HTML에 직접 끼워 넣지 않았고, Slack의 Markdown 해석과 링크 미리보기, Discord의 자동 멘션도 명시적으로 제한했다. 고객 이메일 주소를 운영 채널 payload로 복사하지 않는 것은 로그 마스킹보다 앞선 데이터 최소화다.

Discord 안내에 “포장을 시작하라”가 아니라 포장 작업을 기다리라고 적은 것도 업무 의미를 지키기 위해서다. 이 업무의 `paid`에는 예약 소비까지 반영되어 있지만 포장 작업을 접수했다는 의미는 없다. 작업 지시는 Saga의 `packing.request`를 멱등하게 접수한 결과에서 나오고, `fulfillment.accepted`는 이후 배송 준비 인계의 확인이다. 채널 메시지를 실제 작업 큐의 명령 대신 사용하거나, 이벤트 제목을 더 강한 업무 사실로 해석하지 않는다.

안정적인 `id`는 재시도 때 새로 생성하지 않는다. 같은 주문 버전의 결제 알림을 같은 논리적 대상에 전달하는 일이기 때문이다. 새 주문의 버전은 0이고 첫 `pending_payment → paid` 전이를 마치면 1이다. 늦게 전달된 결제 알림에도 Outbox에 저장한 당시 버전을 사용하며, 이미 배송 중인 주문의 최신 버전으로 바꿔 새 알림 ID를 만들지 않는다. 이메일 주소 자체를 키에 넣으면 개인정보가 큐 관리 화면에 남고, 계정의 이메일 변경이 같은 알림을 새 알림으로 만들 수 있다. 대상 주소는 최초 계획 시 스냅샷으로 저장하고 키는 `customer`, `operations`, `packing` 같은 논리적 대상에 연결한다. 운영자가 재발송을 명시적으로 요청할 때만 원본 ID를 참조하는 새로운 발송 요청을 만든다.

## 실제 채널을 사용하되 외부에는 보내지 않는다

다음 `src/notifications/notification-lab.ts`는 **완전한 무전송 실험 파일**이다. 이메일은 정규화된 메시지를 수집하는 `EmailTransport`를 쓴다. Slack과 Discord는 실제 webhook transport를 사용하되 `fetch` 자리에 요청을 기록하는 함수를 주입한다. 따라서 JSON 변환과 HTTP 상태 처리까지 지나지만 네트워크 요청은 발생하지 않는다. URL의 `example.invalid`는 실험용이며 자격 증명이 아니다.

```ts
import { Module } from '@fluojs/core';
import { NotificationsModule } from '@fluojs/notifications';
import {
  EMAIL_CHANNEL, EmailChannel, EmailModule,
  type EmailTransport, type NormalizedEmailMessage,
} from '@fluojs/email';
import {
  SLACK_CHANNEL, SlackChannel, SlackModule, createSlackWebhookTransport,
  type SlackFetchLike,
} from '@fluojs/slack';
import {
  DISCORD_CHANNEL, DiscordChannel, DiscordModule, createDiscordWebhookTransport,
  type DiscordFetchLike,
} from '@fluojs/discord';
import { OrderNotifications } from './order-notifications.js';

export function createNotificationLab() {
  const probe = {
    emails: [] as NormalizedEmailMessage[],
    slackBodies: [] as string[],
    discordBodies: [] as string[],
    slackStatus: 400,
    emailPending: false,
  };

  const emailTransport: EmailTransport = {
    async send(message, { signal }) {
      signal?.throwIfAborted();
      probe.emails.push(message);
      const addresses = message.to.map(entry => entry.address);
      return {
        messageId: `mail-${probe.emails.length}`,
        accepted: probe.emailPending ? [] : addresses,
        pending: probe.emailPending ? addresses : [],
        rejected: [],
      };
    },
  };

  const slackFetch: SlackFetchLike = async (_url, init) => {
    init?.signal?.throwIfAborted();
    probe.slackBodies.push(String(init?.body ?? ''));
    return new Response(probe.slackStatus === 200 ? 'ok' : 'invalid_payload', {
      status: probe.slackStatus,
    });
  };

  const discordFetch: DiscordFetchLike = async (_url, init) => {
    init?.signal?.throwIfAborted();
    probe.discordBodies.push(String(init?.body ?? ''));
    return new Response(JSON.stringify({ id: 'discord-receipt-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  @Module({
    imports: [
      EmailModule.forRoot({
        defaultFrom: 'shop@example.com',
        transport: emailTransport,
      }),
      SlackModule.forRoot({
        transport: createSlackWebhookTransport({
          webhookUrl: 'https://example.invalid/slack',
          fetch: slackFetch,
        }),
      }),
      DiscordModule.forRoot({
        transport: createDiscordWebhookTransport({
          webhookUrl: 'https://example.invalid/discord',
          fetch: discordFetch,
          retry: { attempts: 1, baseDelayMs: 0 },
        }),
      }),
      NotificationsModule.forRootAsync({
        inject: [EMAIL_CHANNEL, SLACK_CHANNEL, DISCORD_CHANNEL],
        useFactory: (email, slack, discord) => {
          if (!(email instanceof EmailChannel)
            || !(slack instanceof SlackChannel)
            || !(discord instanceof DiscordChannel)) {
            throw new TypeError('Unexpected notification channel provider');
          }
          return { channels: [email, slack, discord] };
        },
      }),
    ],
    providers: [OrderNotifications],
    exports: [OrderNotifications],
  })
  class NotificationLabModule {}

  return { rootModule: NotificationLabModule, probe };
}
```

모듈 등록에는 두 종류의 주입이 있다. `OrderNotifications`는 클래스 수준 `@Inject(NotificationsService)`로 공통 서비스를 받는다. `NotificationsModule.forRootAsync`는 공개 채널 토큰을 명시적으로 받아 `channels` 배열을 만든다. `EmailChannel` 클래스를 import만 하거나 provider 목록에 임의로 추가하는 것으로 foundation에 등록된다고 기대하지 않는다. 이 모듈들은 기본 global export를 사용한다. 기존 앱에서는 1권의 `EmailModule` 등록을 재사용하고, 이 실험의 중복 이메일 등록 대신 그 `EMAIL_CHANNEL`을 함께 주입한다.

이 패키지의 공통 async factory 타입은 주입 값을 `unknown`으로 받는다. 그래서 구성 경계에서 실제 채널 클래스를 확인한 뒤 배열을 만든다. 잘못 연결된 토큰을 정상 채널로 단언해서 넘기는 대신 시작 시 명확하게 거부하며, 업무 서비스에는 이 타입 확인이 퍼지지 않는다.

채널별 `forRootAsync`로 자격 증명을 주입할 때 지원되는 핵심 형태는 `inject`와 `useFactory`다. NestJS의 `imports`, `useClass`, `useExisting` 옵션을 그대로 복사하는 API가 아니다. 설정 provider는 애플리케이션 모듈 그래프에 등록하고 실제 토큰을 연결한다. 운영에서 SMTP를 택한다면 `@fluojs/email/node`의 `createNodemailerEmailTransportFactory` 경계를 사용하고, 기존 SMTP 설정을 그 옵션으로 넘긴다. 이메일 루트 패키지가 SMTP 서버를 자동으로 고르거나 환경변수를 읽는 것은 아니다.

transport 수명도 발송 기능의 일부다. factory가 생성하고 소유한 transport는 패키지의 초기화·종료 경로에 참여한다. 이미 생성해서 직접 넘긴 transport의 소유권은 기본적으로 호출자에게 남는다. 위 실험의 함수와 배열에는 닫을 외부 리소스가 없다. 실제 연결 풀이나 SDK 클라이언트를 넣을 때에는 어떤 객체가 생성하고 어느 종료 경로가 닫는지 먼저 정해야 이중 종료와 누수가 생기지 않는다.

## 부분 실패를 성공 개수 속에 숨기지 않는다

`src/notifications/notification-lab.test.ts`의 다음 **완전한 테스트 파일**은 foundation을 가짜로 대체하지 않는다. 실패를 만들어야 하는 가장 바깥 전송만 가짜다. 처음 Slack은 재시도 대상이 아닌 `400`을 반환하므로 고정 시간 대기 없이 부분 실패를 만든다. 설정을 바로잡은 다음 실패 요청만 다시 전달하는 상황을 검증한다.

```ts
import { describe, expect, it } from 'vitest';
import { bootstrapApplication } from '@fluojs/runtime';
import { NotificationsService } from '@fluojs/notifications';
import { createNotificationLab } from './notification-lab.js';
import {
  OrderNotifications, planPaidNotifications, type PaidNotice,
} from './order-notifications.js';

describe('order notification delivery', () => {
  it('preserves successful channels and retries only the failure', async () => {
    const { rootModule, probe } = createNotificationLab();
    const app = await bootstrapApplication({ rootModule });
    const order: PaidNotice = {
      eventId: 'payment-event-1',
      id: 'order-1',
      customerId: 'reader-1',
      status: 'paid',
      currency: 'KRW',
      totalMinor: '29000',
      version: 1,
    };
    const customer = { id: 'reader-1', email: 'reader@example.com' };

    try {
      const sender = await app.container.resolve(OrderNotifications);
      const first = await sender.send(order, customer);
      expect(first.succeeded).toBe(2);
      expect(first.failed).toBe(1);
      expect(first.failures[0]?.notification.channel).toBe('slack');
      expect(probe.emails).toHaveLength(1);
      expect(probe.discordBodies).toHaveLength(1);

      probe.slackStatus = 200;
      const retry = await sender.retryFailures(first);
      expect(retry.succeeded).toBe(1);
      expect(retry.failed).toBe(0);
      expect(probe.slackBodies).toHaveLength(2);
      expect(probe.emails).toHaveLength(1);
      expect(probe.discordBodies).toHaveLength(1);

      const notifications = await app.container.resolve(NotificationsService);
      probe.emailPending = true;
      const email = planPaidNotifications(order, customer)[0]!;
      await expect(notifications.dispatch(email))
        .rejects.toThrow('incomplete delivery');
    } finally {
      await app.close();
    }
  });
});
```

```sh
pnpm exec vitest run src/notifications/notification-lab.test.ts
```

기대 결과는 최초 두 채널 성공, 한 채널 실패, 재시도 후 Slack 요청만 한 번 추가되는 것이다. 마지막 이메일 실험에서는 transport가 예외를 던지지 않아도 foundation dispatch가 실패해야 한다. `EmailChannel`은 수락자가 없거나 `pending`, `rejected`가 남으면 불완전한 전달로 처리한다. `EmailService.send`의 상세 receipt와 채널 수준의 성공 판정은 같은 반환 타입이 아니다.

여기서 `delivered`를 “독자가 읽음”으로 해석하지 않는다. 이메일 서버의 수락, Slack·Discord webhook의 성공 응답은 사용자의 읽기 확인이 아니다. 메일함 분류, 나중의 반송, 채널 보관 설정은 별도 관측 대상이다. 공급자가 message ID를 주지 않는 경로에서는 foundation의 `deliveryId`가 외부 검색 가능한 receipt라는 보장도 없다. 애플리케이션의 알림 ID와 공급자의 receipt를 서로 다른 필드로 저장해야 고객 문의 때 무엇을 조회할지 분명해진다.

이 원고에서는 위 테스트 파일을 실제 앱에 생성하거나 실행하지 않았다. 제시한 예상값은 구현·채널 소스에 근거한 검증 조건이다. 실제 이메일, Slack, Discord 자격 증명을 넣어 전송한 결과가 아니다. Node24·pnpm10의 기존 프로젝트 환경에서 이 세 파일을 구성하면 무전송 통합 실험으로 사용할 수 있다.

## 재시도 단위는 사건 전체가 아니라 전달 하나다

위 서비스의 `retryFailures`는 한 실행에서 돌아온 실패 목록을 다시 전달하는 최소 동작이다. 프로세스가 재시작해도 그 목록이 남는다는 뜻은 아니다. 운영에서는 세 요청을 만들 때 알림 전달 원장을 함께 저장한다. 원장의 고유 키는 `notificationId`이며, 열에는 원본 사건 ID, 채널, 대상 참조, 고정된 요청 봉투, 상태, 시도 횟수, 다음 실행 가능 시각, 외부 receipt가 들어간다. 원장 생성과 입력 Inbox 기록을 같은 트랜잭션에 넣어 사건 재전달이 새 전달 세 개를 만들지 않게 한다.

이 저장소도 루트의 `src/database/blog-database.module.ts`에 있는 `BlogDatabaseModule`이 공유하는 `PrismaService`를 사용한다. `AppSettings`를 받는 비동기 global 등록을 유지하고 알림용 DB wrapper를 병렬로 만들지 않는다. 알림 전달 원장은 주문의 `OrderTransition` 감사와 별개이며, 알림 재시도는 주문 버전이나 `Stock.available`을 변경하지 않는다.

워커는 전달 행 하나를 조건부로 점유하고 전송한다. 성공 시 그 행만 완료하고, 실패 시 그 행만 재시도 가능 상태로 돌린다. 이메일·Discord가 성공한 사건을 Slack 때문에 처음부터 실행하면 고객은 같은 메일을 계속 받는다. 작업 결과의 `failed > 0`을 보고 상위 사건 전체를 던져 버리는 흔한 구현이 바로 이 중복을 만든다. 전체 작업을 실패 처리하더라도 성공 원장을 존중하여 완료된 전달을 건너뛰는 소비 계약이 필요하다.

점유와 외부 전송을 하나의 데이터베이스 트랜잭션 안에 오래 묶지는 않는다. 대신 소유자와 임대 만료 시각을 두고 중단된 실행을 회수한다. 임대 시간 동안 진행 중인 전송을 새 워커가 동시에 시작하지 않게 하되, 네트워크 요청이 외부에서 성공하고 응답만 사라지는 경우까지 중복을 완전히 제거할 수는 없다. webhook은 알림 ID를 공급자 멱등성 키로 자동 해석하지 않는다. 애매한 결과를 별도 상태로 보존하거나, 중복 가능성을 허용하는 정책을 정해야 한다. 결제처럼 정확한 재무 대사가 필요한 동작과 알림의 재전송 정책을 같은 것으로 만들지 않는다.

공급자 재시도와 작업 큐 재시도도 중첩된다. Slack webhook transport는 일시적인 HTTP 실패와 전송 오류에 제한된 재시도를 수행한다. Discord는 `retry.attempts`와 `baseDelayMs`를 설정할 수 있고 기본값은 총 세 번, 기본 지연 250ms다. `attempts`에는 최초 요청이 포함된다. 공급자 호출 한 번이 내부적으로 세 번 시도되고 작업이 다섯 번 재시도되면 실제 요청 수는 단순한 “다섯 번”이 아니다. 장애 동안 모든 주문이 같은 대상에 재시도를 몰아넣지 않도록 채널별 동시성과 전체 시도 예산을 작업 계층에서 제한한다.

foundation의 큐 설정 역시 영속 큐 자체가 아니다. `NotificationsQueueAdapter`는 애플리케이션이 제공한다. 단건 `dispatch`는 큐 adapter가 있어도 기본 직접 전달이며 `{ queue: true }`가 있어야 위임한다. `dispatchMany`는 기본 임계값 10 이상이면 큐 경로를 선택하고, `{ queue: false }`로 직접 전달을 강제할 수 있다. 위 실험이 명시적으로 `false`를 지정한 이유는 나중에 모듈에 큐 설정이 추가되어도 실험의 의미가 달라지지 않게 하기 위해서다.

큐 워커가 같은 foundation 서비스를 호출할 때도 `{ queue: false }`가 필요하다. 그렇지 않으면 배치 크기에 따라 받은 작업을 다시 큐에 넣는 순환이 생길 수 있다. adapter는 `job.id`를 backing queue의 중복 방지 경계로 전달하고, `enqueue`에서는 비어 있지 않은 작업 ID를 반환해야 한다. `enqueueMany` 결과도 입력과 같은 길이의 빈틈없는 ID 배열이어야 한다. 큐 수락은 `queued`이지 `delivered`가 아니다. 여기에 직접 전송 결과와 별개인 상태를 두어야 운영 화면이 큐 적체를 발송 완료로 표시하지 않는다.

## 취소와 종료도 전달 결과의 일부다

요청의 `AbortSignal`은 채널을 거쳐 전송 경계로 전달된다. 이미 취소된 작업을 보냈을 때 transport 기록이 늘지 않는지 검증한다. 진행 중 전송의 취소 테스트는 가짜 fetch가 진입 신호를 노출하고, 테스트가 그 신호를 받은 뒤 abort하도록 구성한다. 몇 밀리초 기다리면 전송이 시작했을 것이라고 추측하지 않는다. 큐가 이미 수락한 작업은 이후 호출자 signal을 취소했다고 사라지지 않는다. 큐 작업 취소는 별도의 저장된 명령과 정책이다.

종료 실험도 같은 방식이다. 가짜 transport의 `send`가 장벽에서 멈추게 하고 애플리케이션 종료를 시작한다. 패키지가 소유한 transport는 허용된 진행 중 전달을 정리한 뒤 닫혀야 하며 새 호출은 종료 경계에서 거부되어야 한다. 실제 메일 서버의 성공을 기다리는 대신 호출 순서와 close 횟수를 확인한다. 종료 도중 실패한 알림은 원장에 남아 다음 실행이 이어받아야 한다. 리소스를 잘 닫았다는 사실만으로 업무가 복구되는 것은 아니다.

관측에는 사건 ID, 알림 ID, 채널, 시도 횟수, 결과 코드와 지연을 남긴다. webhook URL, SMTP 비밀번호, 이메일 본문 전체를 예외 로그에 넣지 않는다. 선택적으로 `requested`, `queued`, `delivered`, `failed` 라이프사이클 이벤트를 발행할 수 있지만 그 이벤트 publisher도 애플리케이션 소유다. 메트릭이나 로그용 관찰을 켰다고 앞에서 설명한 영속 원장이 생기지는 않는다.

채널이 하나이고 대량 재시도 요구도 없다면 `EmailService` 직접 호출이 더 단순하다. foundation을 선택하는 시점은 같은 전달 계약 아래에서 여러 채널의 결과와 큐 경계를 다루어야 할 때다. 지금은 그 시점에 도달했다. 다음 장에서는 고객이 이메일을 기다리지 않고 주문 페이지에서 상태 변화를 보게 한다. 실시간 메시지 역시 확정 사실의 전달 수단이며, 끊겼다가 연결된 화면이 최신 주문을 다시 확인할 경로가 필요하다.

## 근거와 검증 범위

- [공유 구현 경계](../EDITORIAL.ko.md): 실제 결제 원장, 예약 소비, 주문 감사와 알림 입력의 연속성.
- [notifications 계약](../../packages/notifications/README.ko.md), [공개 export](../../packages/notifications/src/index.ts), [요청·결과 타입](../../packages/notifications/src/types.ts), [서비스 구현](../../packages/notifications/src/service.ts): 직접 전달, 큐 위임, 실패 수집의 근거.
- [이메일 계약](../../packages/email/README.ko.md), [공개 export](../../packages/email/src/index.ts), [EmailChannel](../../packages/email/src/channel.ts): 수락·보류·거절과 불완전한 전달 판정.
- [Slack 계약](../../packages/slack/README.ko.md), [공개 export](../../packages/slack/src/index.ts), [webhook 구현](../../packages/slack/src/webhook.ts): 요청 변환과 제한된 재시도.
- [Discord 계약](../../packages/discord/README.ko.md), [공개 export](../../packages/discord/src/index.ts), [webhook 구현](../../packages/discord/src/webhook.ts): thread 해석과 명시적 재시도 정책.
- [notifications 모듈 테스트](../../packages/notifications/src/module.test.ts), [이메일 모듈 테스트](../../packages/email/src/module.test.ts), [Slack 수명주기 회귀 테스트](../../packages/slack/src/lifecycle-regression.test.ts), [Discord 종료 테스트](../../packages/discord/src/lifecycle-shutdown.test.ts): 별도 재현에 사용할 패키지 테스트다. 이번 집필에서 외부 발송이나 이 테스트들의 재실행은 하지 않았다.
