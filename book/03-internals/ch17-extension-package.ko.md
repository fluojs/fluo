# 재사용 가능한 Fluo 확장 패키지 만들기

<!-- book:volume=03-internals;chapter=17 -->

[이전: 직접 어댑터를 만들고 계약 검증하기](./ch16-custom-adapter.ko.md) · [3권 목차](./toc.ko.md) · [다음: CLI와 Studio가 애플리케이션을 보는 방법](./ch18-cli-and-studio.ko.md)

## 복사한 코드가 두 번째 제품 규칙이 되는 순간

FluoBlog에 상점을 붙인 뒤 운영자의 질문도 달라졌다. 처음에는 “누가 이 글을 발행했는가”만 알면 됐다. 이제는 같은 계정의 독자가 주문한 티셔츠에 대해 “어느 주문의 결제 완료를 처리했는가”도 확인해야 한다. 게시글 발행 코드와 주문 처리 코드에 각각 기록 함수를 넣었더니 한쪽은 `postId`, 다른 쪽은 `resource`라는 필드를 썼다. 장애를 조사할 때 두 기록을 같은 도구로 읽을 수 없었다. 기록 형식을 한 번 고쳐도 두 구현이 다시 어긋났다.

이 문제를 해결하려고 주문 상태 머신을 공통 패키지로 옮기면 추출 범위가 지나치게 커진다. 게시글의 `draft → published`와 주문의 `pending_payment → paid`는 같은 전이가 아니다. 확장이 공유해야 하는 것은 **이미 결정된 사건을 일정한 모양으로 전달하는 경계**다. 전이가 허용되는지, 거래가 커밋됐는지, 중복 사건을 어떻게 판별하는지는 기존 `PostsModule`과 `OrdersModule`의 책임으로 남긴다.

앞 장에서 만든 어댑터가 요청 실행 계약을 보존해야 했듯, 이번 확장은 DI와 모듈 계약을 보존해야 한다. 패키지를 import하자마자 전역 컨테이너에 등록하거나 환경 변수를 읽는 구현은 사용자의 선택권을 빼앗는다. 테스트에서 import만 했는데 연결이 생기고, 같은 프로세스의 두 앱이 같은 설정을 쓰게 된다. 명시적인 등록 함수가 필요한 이유는 사용법을 보기 좋게 만들기 위해서가 아니라 구성과 자원 소유권을 애플리케이션에 돌려주기 위해서다.

이 장의 `@example/fluo-audit`는 독자가 작성할 확장 이름이다. 저장소에 배포된 Fluo 패키지가 아니며 완성된 상점 저장소가 있다는 뜻도 아니다. Node24와 pnpm10, 표준 데코레이터를 처리하는 기존 빌드 설정을 기준으로 구현한다. 파일은 독자의 확장 프로젝트 `src/index.ts`와 `fluo-blog/src/audit/...`에 나누어 둔다. `examples/fluo-blog`는 이 확장의 실행 체크포인트가 아니라 초기 HTTP/DI 학습 근거다.

## 먼저 기록의 성공이 무엇인지 정한다

기록 포트는 `append(record): Promise<void>` 하나다. 반환된 Promise가 이행되면 해당 어댑터가 정의한 저장 작업이 완료된 것이다. 메모리 어댑터에서는 배열에 들어갔다는 뜻이고, 영속 어댑터에서는 그 어댑터가 약속한 커밋이 끝났다는 뜻이다. 어느 경우에도 이 반환값만으로 게시글이나 주문의 데이터베이스 거래와 원자적으로 묶였다고 말할 수 없다.

사건에는 `eventId`, 문자열 사용자 ID인 `actorId`, 엔터티 종류, 엔터티 ID, 사건 이름, 버전을 넣는다. 게시글 ID는 양의 정수로 유지한다. 주문 ID는 이 실험에서 문자열로 표현한다. 엔터티와 사건 이름을 판별 유니온으로 묶어 `entity: 'post'`에 `action: 'order.paid'`가 붙는 조합을 타입 단계에서 막는다. 제목, 본문, 비밀번호, 토큰, 주문 전체를 받지 않는 것도 설계다. 기록 형식을 만들면서 민감한 객체 전체를 직렬화하는 습관을 들이지 않는다.

버전의 출발점은 두 도메인에서 다르다. 새 게시글 초안은 version 1이고 수정 없이 처음 발행하면 2다. 새 주문은 version 0이고 첫 결제 완료 전이 뒤에는 1이다. 여기서 받는 두 사건은 전이 이후의 기록이므로 양의 버전을 요구한다. 이 조건을 주문 생성 모델에 그대로 옮겨 version 0을 금지하지 않는다.

`eventId`는 호출자가 정한 사건 식별자다. 패키지 안에서 매번 새 ID를 만들면 같은 사건의 재시도가 서로 다른 사건으로 바뀐다. 반대로 이 장의 메모리 어댑터는 같은 ID를 거부하지 않으므로 멱등성을 제공하지 않는다. 식별자를 보존하는 것과 중복을 제거하는 것은 다른 계약이다. 영속 Outbox에서 같은 사건을 재전달할 때도 이 구분이 유지되어야 한다.

다음은 확장 프로젝트의 **완전한 `src/index.ts` 파일**이다. 외부 전송이나 데이터베이스 연결은 하지 않는다. `AuditOptions`의 `sink`가 필수 포트이며, 환경 설정과 포트의 실제 구현은 등록하는 쪽이 제공한다.

```ts
import {
  Inject,
  Module,
  type AsyncModuleOptions,
  type Constructor,
  type Token,
} from '@fluojs/core';
import type { Provider } from '@fluojs/di';

export type AuditEvent = {
  readonly eventId: string;
  readonly actorId: string;
  readonly version: number;
} & (
  | { readonly entity: 'post'; readonly entityId: number; readonly action: 'post.published' }
  | { readonly entity: 'order'; readonly entityId: string; readonly action: 'order.paid' }
);

export type AuditRecord = AuditEvent & { readonly source: string };

export interface AuditSink {
  append(record: AuditRecord): Promise<void>;
}

export interface AuditOptions {
  readonly source: string;
  readonly sink: AuditSink;
}

export type AuditAsyncOptions = AsyncModuleOptions<AuditOptions> & {
  readonly imports?: Constructor[];
};

export const AUDIT_OPTIONS: Token<Readonly<AuditOptions>> =
  Symbol.for('fluo.example-audit.options');
export const AUDIT_RECORDER: Token<AuditRecorder> =
  Symbol.for('fluo.example-audit.recorder');

function normalizeOptions(options: AuditOptions): Readonly<AuditOptions> {
  if (typeof options.source !== 'string' || options.source.trim() === '') {
    throw new TypeError('Audit source must be a non-empty string.');
  }
  if (!options.sink || typeof options.sink.append !== 'function') {
    throw new TypeError('Audit sink must implement append(record).');
  }
  return Object.freeze({ source: options.source.trim(), sink: options.sink });
}

@Inject(AUDIT_OPTIONS)
export class AuditRecorder {
  constructor(private readonly options: Readonly<AuditOptions>) {}

  async record(event: AuditEvent): Promise<void> {
    if (!event.eventId || !event.actorId) {
      throw new TypeError('Audit event and actor identifiers are required.');
    }
    if (!Number.isSafeInteger(event.version) || event.version < 1) {
      throw new RangeError('Audit version must be a positive safe integer.');
    }
    if (event.entity === 'post') {
      if (!Number.isSafeInteger(event.entityId) || event.entityId < 1) {
        throw new RangeError('Post identifier must be a positive safe integer.');
      }
      if (event.action !== 'post.published') {
        throw new TypeError('Invalid post audit action.');
      }
    } else if (event.entity === 'order') {
      if (typeof event.entityId !== 'string' || event.entityId.length === 0) {
        throw new TypeError('Order identifier must be a non-empty string.');
      }
      if (event.action !== 'order.paid') {
        throw new TypeError('Invalid order audit action.');
      }
    } else {
      throw new TypeError('Unsupported audit entity.');
    }
    await this.options.sink.append(Object.freeze({
      eventId: event.eventId,
      actorId: event.actorId,
      version: event.version,
      entity: event.entity,
      entityId: event.entityId,
      action: event.action,
      source: this.options.source,
    }) as AuditRecord);
  }
}

export class AuditModule {
  static forRoot(options: AuditOptions): Constructor {
    return AuditModule.configure({
      provide: AUDIT_OPTIONS,
      useValue: normalizeOptions(options),
    });
  }

  static forRootAsync(options: AuditAsyncOptions): Constructor {
    return AuditModule.configure({
      provide: AUDIT_OPTIONS,
      inject: options.inject,
      useFactory: async (...deps: unknown[]) =>
        normalizeOptions(await options.useFactory(...deps)),
    }, options.imports);
  }

  private static configure(
    optionProvider: Provider<Readonly<AuditOptions>>,
    imports: Constructor[] = [],
  ): Constructor {
    @Module({
      imports,
      providers: [
        optionProvider,
        AuditRecorder,
        { provide: AUDIT_RECORDER, useExisting: AuditRecorder },
      ],
      exports: [AUDIT_RECORDER],
    })
    class ConfiguredAuditModule {}

    return ConfiguredAuditModule;
  }
}
```

여기서 `@Inject(AUDIT_OPTIONS)`는 클래스에 붙는다. 생성자 인수의 TypeScript 타입은 지워지기 때문에 `Readonly<AuditOptions>`라고 썼다는 사실만으로 주입되지 않는다. `AUDIT_OPTIONS`를 제공하는 provider와 그 토큰을 요구하는 클래스 메타데이터가 실제 연결이다. `Token<T>`에 타입 인수를 붙여도 런타임 객체 검증을 대신하지 않으므로 등록 경계에서 옵션을 확인한다.

`normalizeOptions`는 입력 객체를 그대로 보관하지 않고 새 객체를 동결한다. 호출자가 나중에 `source`를 바꾸어도 이미 등록된 설정은 바뀌지 않는다. 그러나 `sink` 자체는 복제하지 않는다. 호출자가 소유한 인스턴스를 복제하면 테스트에서 관찰하던 배열이나 외부 자원 소유권이 끊어질 수 있다. 마지막의 타입 단언은 검증한 판별 유니온의 필드를 새 객체로 투영하면서 생기는 TypeScript 상관관계 손실만 좁힌다. 검증되지 않은 외부 JSON을 신뢰하기 위한 단언이 아니다.

옵션 provider는 기본 singleton이므로 비동기 factory의 결과도 그 컨테이너 안에서 공유된다. 비동기 설정을 매번 읽는 서비스가 아니다. `forRootAsync`에 넘긴 `imports`는 설정 factory가 사용하는 의존성의 가시성을 연다. 이 배열을 버리고 `inject`만 복사하면 토큰 이름이 있어도 컴파일할 모듈 그래프에서 찾지 못할 수 있다.

클래스는 패키지 루트에서 export하지만 모듈의 `exports`에는 `AUDIT_RECORDER`만 넣었다. 두 export는 역할이 다르다. 전자는 TypeScript 소비자가 import할 수 있는 이름이고, 후자는 다른 Fluo 모듈에서 주입받을 수 있는 토큰이다. `useExisting`은 별도 `AuditRecorder`를 만들지 않고 같은 인스턴스에 이름을 하나 더 붙인다. 옵션 토큰도 패키지 공개 이름이지만 모듈 소비자에게 설정을 꺼내 수정할 권한까지 주지는 않는다.

## 애플리케이션이 연결을 소유하게 한다

정적 등록은 `AuditModule.forRoot({ source: 'fluo-blog', sink })`다. 설정과 sink가 DI로 공급되는 상황에서는 비동기 등록을 사용한다. 다음은 **완전한 `fluo-blog/src/audit/audit.module.ts` 파일**이다. 메모리 sink는 관찰용 실험 장치다. 프로세스가 끝나면 기록도 사라지며 실제 감사 보관소라고 부르지 않는다.

```ts
import { Module } from '@fluojs/core';
import {
  AUDIT_RECORDER,
  AuditModule,
  type AuditRecord,
  type AuditSink,
} from '@example/fluo-audit';

export class MemoryAuditSink implements AuditSink {
  readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }
}

@Module({
  providers: [MemoryAuditSink],
  exports: [MemoryAuditSink],
})
class AuditDependenciesModule {}

const ConfiguredAuditModule = AuditModule.forRootAsync({
  imports: [AuditDependenciesModule],
  inject: [MemoryAuditSink],
  useFactory: (sink) => {
    if (!(sink instanceof MemoryAuditSink)) {
      throw new TypeError('Expected MemoryAuditSink.');
    }
    return { source: 'fluo-blog', sink };
  },
});

@Module({
  imports: [ConfiguredAuditModule],
  exports: [AUDIT_RECORDER],
})
export class ProductAuditModule {}
```

factory가 받는 인수는 공개 계약상 `unknown[]`이므로 이 예제에서는 구체 클래스 경계에서 좁혔다. production 어댑터를 직접 `new`로 만들어 옵션에 넘기는 정적 등록에는 이 좁히기가 필요 없다. 중요한 것은 라이브러리 내부에서 특정 애플리케이션의 설정 서비스를 import하지 않는다는 점이다. 의존성 방향은 상품 코드에서 확장 패키지로 향하고, 확장은 포트만 안다.

기존 `PostsModule`과 `OrdersModule`의 `imports`에 **동일한** `ProductAuditModule`을 넣고, 사건 전달을 담당하는 클래스에 `@Inject(AUDIT_RECORDER)`를 선언한다. 기존 providers, controllers, 다른 imports를 지우고 이 모듈만 남기는 교체가 아니다. 이 수정은 애플리케이션 조립부의 부분 변경이며 각 기능 모듈의 전체 파일이 아니다.

두 기능 모듈이 각각 `AuditModule.forRoot(...)`를 호출하는 것은 피한다. 호출마다 다른 모듈 클래스가 생기고, 같은 토큰을 별도 설정으로 등록하는 모양이 된다. 이 확장은 한 애플리케이션에서 하나의 root 구성을 갖는 계약이다. 여러 기록 채널이 정말 필요하면 토큰과 옵션을 구별하는 별도 계약을 설계해야지, 중복 provider 경고를 끄고 우연히 마지막 등록이 이기는 동작에 기대면 안 된다.

이제 주문 처리 클래스는 기존 거래에서 `paid` 전이를 확정한 뒤 사건을 넘길 수 있다. 다만 HTTP 요청 안에서 주문을 커밋하고 곧바로 `record`를 호출하면 저장소 실패 때 주문은 `paid`인데 응답은 실패할 수 있다. 그러므로 2권의 Outbox가 있는 제품에서는 Outbox 소비자가 이 포트를 호출하는 편이 맞다. 확장 추출이 기존 정합성 경계를 바꾸지 않도록 전달 위치를 보존한다. 이 장에서 실제 결제나 외부 전송은 실행하지 않는다.

그때도 상태·버전·`OrderTransition` 감사 기록을 같은 거래에 저장하는 `OrderTransitionsService.apply`를 유지한다. 이 확장의 전달 기록이나 Outbox가 그 원자적 감사 원장을 대체하지 않는다. `OrderInventoryService.confirmPayment`는 전이와 예약 확인을 묶고 `Reservation`을 `consumed`로 바꾸되 예약 시 줄인 `Stock.available`을 다시 차감하지 않는다. 청구 조율의 실제 경계는 `src/payments/payment-ledger.ts`의 `PaymentLedger.prepare/record`이며 확장 안에 두 번째 결제 흐름을 만들지 않는다.

## 컨테이너 실험과 모듈 실험을 분리한다

다음은 확장 프로젝트의 **완전한 `src/audit.test.ts` 파일**이다. 표준 데코레이터 변환이 설정된 Vitest에서 실행한다. 순수 Container 실험은 토큰과 별칭의 동일성, 실패 전파를 검증한다. 모듈 실험은 `imports/providers/exports` 연결을 검증한다. 하나를 통과했다고 다른 경계가 증명되는 것은 아니다.

```ts
import { Inject, Module } from '@fluojs/core';
import { Container } from '@fluojs/di';
import { createTestingModule } from '@fluojs/testing';
import { expect, it } from 'vitest';
import {
  AUDIT_OPTIONS,
  AUDIT_RECORDER,
  AuditModule,
  AuditRecorder,
  type AuditEvent,
  type AuditRecord,
} from './index.js';

const event: AuditEvent = {
  eventId: 'post:1:published:2',
  actorId: 'reader-7',
  entity: 'post',
  entityId: 1,
  action: 'post.published',
  version: 2,
};

it('shares the recorder alias and propagates sink failure', async () => {
  const failure = new Error('sink unavailable');
  const container = new Container().register(
    { provide: AUDIT_OPTIONS, useValue: {
      source: 'fluo-blog',
      sink: { append: async () => { throw failure; } },
    } },
    AuditRecorder,
    { provide: AUDIT_RECORDER, useExisting: AuditRecorder },
  );
  try {
    const recorder = await container.resolve<AuditRecorder>(AUDIT_RECORDER);
    expect(recorder).toBe(await container.resolve(AuditRecorder));
    await expect(recorder.record(event)).rejects.toBe(failure);
  } finally {
    await container.dispose();
  }
});

it('exports the configured recorder into a consuming module', async () => {
  const records: AuditRecord[] = [];
  let factoryCalls = 0;
  const extension = AuditModule.forRootAsync({
    useFactory: () => {
      factoryCalls += 1;
      return {
        source: 'fluo-blog',
        sink: { append: async (record) => { records.push(record); } },
      };
    },
  });
  @Inject(AUDIT_RECORDER)
  class Probe {
    constructor(readonly recorder: AuditRecorder) {}
  }
  @Module({ imports: [extension], providers: [Probe] })
  class ProbeModule {}

  const module = await createTestingModule({ rootModule: ProbeModule }).compile();
  try {
    const probe = await module.resolve(Probe);
    await Promise.all([probe.recorder.record(event), probe.recorder.record(event)]);
    expect(factoryCalls).toBe(1);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ ...event, source: 'fluo-blog' });
    expect(Object.isFrozen(records[0])).toBe(true);
  } finally {
    await module.container.dispose();
  }
});
```

두 번째 테스트에서 기록이 두 개라는 기대는 의도적이다. 중복 제거를 구현하지 않았는데 한 개라고 주장하는 회귀 테스트를 만들지 않는다. sink가 성공한 직후 응답이 유실되어 재시도하더라도 이 메모리 구현은 두 번 추가한다. 영속 어댑터가 `eventId`의 유일성을 보장하게 바뀐다면 그 어댑터의 계약 테스트에서 중복 결과와 충돌 결과를 별도로 정의한다.

추가 실패 실험도 원인이 선명해야 한다. `source`를 빈 문자열로 바꾸면 `forRoot`에서 모듈을 반환하기 전에 `TypeError`가 발생해야 한다. 비동기 factory가 같은 옵션을 반환하면 컴파일 중 reject되어야 한다. `ProbeModule`에서 extension import를 제거하거나 확장의 `exports`를 빈 배열로 바꾸면 토큰 가시성 검증이 실패해야 한다. 이때 sink 호출 횟수가 0인지 함께 확인하면, 실제 호출 뒤에야 배선 오류를 발견하는 구현을 구별할 수 있다.

이 실험의 sink는 자원을 열지 않으므로 종료 훅이 없다. 나중에 파일 핸들이나 연결을 가진 구현을 넣을 때는 연결을 만든 provider가 `onDestroy`를 소유하게 한다. 외부에서 전달한 객체를 recorder가 마음대로 닫지 않는다. Container의 dispose는 실패한 훅을 명시적 재호출에서 재시도할 수 있으므로, 실제 어댑터는 부분 종료 뒤 재시도해도 안전해야 한다. 이것은 `record` 재시도 정책과 별개의 수명주기 계약이다.

## 패키지로 내보낼 때 남겨야 하는 경계

`src/index.ts`가 정직한 public surface가 되려면 배포물에도 같은 export와 declaration이 있어야 한다. 소비자가 `@example/fluo-audit/src/...`를 import하도록 안내하지 않는다. ESM JavaScript와 `.d.ts`를 만들고 package export map의 루트를 두 결과에 연결한다. Fluo 버전 범위는 실제로 확인한 조합만 선언한다. 표준 데코레이터를 쓰는 소스라고 해서 Node24가 변환 없이 모든 TypeScript 데코레이터를 실행한다고 주장하지 않는다.

패키지 README에는 정적 등록, DI 기반 등록, 필수 sink 포트, 한 앱당 root 설정 하나, 실패 전파, 비영속 메모리 예제의 제한을 함께 적는다. 공개 배포용 API의 TSDoc도 추가한다. 이 장의 파일은 런타임 구현을 설명하는 완전한 소스이지, 버전 선택과 빌드 설정까지 끝난 게시용 tarball은 아니다. 실제 배포는 소비자 프로젝트에서 공개 엔트리포인트를 import하는 테스트까지 확인한 뒤 진행한다.

`forRoot`와 `forRootAsync`는 장식적인 관례가 아니다. 확장 계약은 명시적인 진입점, typed option과 token, import 시점 부작용 금지, 해석된 비동기 옵션의 정규화 또는 공유를 요구한다. 설정 형태나 실패 의미가 바뀌면 코드만 바꾸지 말고 테스트와 문서, 버전 정책을 같이 바꿔야 한다. first-party `@fluojs/*` 패키지로 기여할 때의 Changesets와 릴리스 경계는 마지막 장에서 다룬다.

한 서비스에서 두 번 쓰이는 짧은 함수라면 당장 npm 패키지로 만들 필요는 없다. `src/audit` 안의 모듈로 두고 실제로 다른 앱이 요구하는 차이를 확인할 수 있다. 반대로 별도 배송 프로세스에서도 같은 사건 형식과 등록 계약을 유지해야 한다면 패키지 경계가 유용해진다. 추출의 기준은 코드 줄 수가 아니라 독립적으로 설명하고 검증할 계약이 생겼는가다.

이제 같은 블로그와 상점은 기록 형식을 공유하면서 도메인 판단과 저장 책임은 각자의 경계에 남긴다. 다음 장에서는 이렇게 등록한 토큰과 모듈이 도구에서 어떻게 보이는지 살핀다. 그림에 선이 있다고 실제 요청이 그 선을 따라 실행됐다는 뜻인지, 정적 보고서가 실패한 부트스트랩까지 설명할 수 있는지도 구분할 것이다.

## 소스 근거와 검증 범위

- [core README](../../packages/core/README.ko.md), [공개 export](../../packages/core/src/index.ts), [데코레이터 구현](../../packages/core/src/decorators.ts): 클래스 수준 주입과 모듈 메타데이터.
- [DI README](../../packages/di/README.ko.md), [provider 공개 타입](../../packages/di/src/types.ts), [Container 구현](../../packages/di/src/container.ts): 등록, 별칭, singleton, 정리 소유권.
- [확장 계약](../../docs/contracts/third-party-extension-contract.ko.md): 옵션·토큰·등록 진입점과 환경 격리.
- [testing README](../../packages/testing/README.ko.md), [모듈 테스트 구현](../../packages/testing/src/module.ts), [테스트 계약](../../docs/contracts/testing-guide.ko.md): 실제 모듈 그래프를 통과하는 검증.
- [DI 종료 재시도 테스트](../../packages/di/src/container-disposal-retry.test.ts): 기록 재시도와 구분해야 하는 종료 계약.

예제 테스트의 예상 결과는 위 계약에 근거한 재현 기준이다. 이 원고에서 새 확장 프로젝트를 생성하거나 테스트를 실행한 결과로 제시한 것이 아니며, 영속 기록·중복 제거·Outbox 연결은 이 메모리 실험으로 검증되지 않는다.
