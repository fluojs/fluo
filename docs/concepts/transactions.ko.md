# 트랜잭션 관리 (Transaction Management)

<p><a href="./transactions.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

데이터 무결성은 신뢰할 수 있는 모든 백엔드의 근간입니다. Konekti는 공식 ORM 연동(Prisma, Drizzle, Mongoose)을 위한 표준화된 트랜잭션 관리 기능을 제공하여, 트랜잭션 객체를 모든 함수에 전달하는 번거로움 없이 복잡한 비즈니스 작업의 **원자성(Atomicity)**을 보장합니다.

## 왜 Konekti의 트랜잭션인가요?

- **ALS 기반 문맥 (ALS-Backed Context)**: `AsyncLocalStorage`를 사용하여 Konekti는 활성 트랜잭션을 자동으로 추적합니다. 모든 함수 호출에 `tx`나 `session` 객체를 일일이 전달할 필요가 없습니다.
- **통합된 `current()` 패턴**: 모든 ORM 연동 패키지는 `Service.current()` 메서드를 제공합니다. 이 메서드는 활성 트랜잭션 클라이언트 또는 루트 클라이언트를 자동으로 찾아 반환하며, 완벽한 타입 안전성과 IDE 자동 완성을 유지합니다.
- **요청 범위 트랜잭션 (Request-Scoped Transactions)**: 간단한 인터셉터 하나로 전체 HTTP 요청을 단일 트랜잭션으로 묶을 수 있습니다. 이를 통해 어떤 서비스에서든 에러가 발생하면 전체 작업이 자동으로 롤백됩니다.
- **명시적 경계 설정**: 트랜잭션의 *접근*은 단순화되었지만, 그 *경계*는 여전히 명시적입니다. 개발자가 트랜잭션의 시작과 끝을 정확하게 제어할 수 있습니다.

## 책임 분담

- **서비스 계층 (소유자)**: 특정 작업이 원자적이어야 하는지 결정합니다. 서비스는 `transaction()` 블록이나 인터셉터를 사용하여 트랜잭션 경계를 정의합니다.
- **ORM 연동 패키지 (러너)**: `@konekti/prisma`, `@konekti/drizzle`과 같은 패키지들은 실제 트랜잭션 드라이버를 제공하고 애플리케이션 종료 시 자동 연결 해제 등 연결 수명 주기를 관리합니다.
- **레포지토리 계층 (소비자)**: 수동적인 참여자입니다. `Service.current()`를 사용하여 작업을 수행하며, 현재 작업이 트랜잭션의 일부인지 여부를 알 필요가 없습니다.

## 일반적인 워크플로우

### 1. 수동 트랜잭션 블록
서비스 내에서 특정 로직의 하위 집합만 원자적으로 처리해야 할 때 적합합니다.

```typescript
@Inject([PrismaService])
class OrderService {
  async checkout(cartId: string) {
    return this.prisma.transaction(async () => {
      // 이 블록 내부에서 current()는 트랜잭션 클라이언트를 사용합니다
      const order = await this.orderRepo.create(cartId);
      await this.inventoryRepo.decreaseStock(order.items);
      return order;
    });
  }
}
```

### 2. 요청 레벨 트랜잭션
전체 POST/PUT/DELETE 작업이 하나의 원자적 단위여야 하는 "수직 슬라이스(Vertical Slice)" 아키텍처에 이상적입니다.

```typescript
@Post('/')
@UseInterceptors(PrismaTransactionInterceptor)
async createAccount(@FromBody() dto: CreateAccountDto) {
  // PrismaService.current()를 통한 모든 하위 호출은 이 tx를 공유합니다
  await this.userService.create(dto);
  await this.profileService.init(dto);
}
```

## 주요 경계

- **`current()` 규칙**: 레포지토리에서는 항상 루트 클라이언트 인스턴스 대신 `Service.current()`를 사용하세요. 이를 통해 코드가 기본적으로 "트랜잭션 인식" 상태가 됩니다.
- **암시적 전역 트랜잭션 지양**: 트랜잭션은 선택적(opt-in)으로 사용됩니다. Konekti는 예기치 않은 성능 병목이나 데이터베이스 잠금 문제를 방지하기 위해 암시적인 전역 트랜잭션을 피합니다.
- **에외 기반 롤백**: 트랜잭션 경계 내에서 예외가 발생하면 자동으로 롤백됩니다. 에러 핸들링 로직에서 롤백을 트리거해야 하는 에러를 무시하거나 삼켜버리지 않도록 주의하세요.

## 다음 단계

- **Prisma**: [Prisma 연동](../../packages/prisma/README.ko.md)에 대해 자세히 알아보세요.
- **Drizzle**: [Drizzle 연동](../../packages/drizzle/README.ko.md)을 살펴보세요.
- **Mongoose**: [Mongoose 트랜잭션](../../packages/mongoose/README.ko.md)에 대해 알아보세요.
- **예제**: 전형적인 [수직 슬라이스 예제](../../packages/prisma/src/vertical-slice.test.ts)를 확인해 보세요.
