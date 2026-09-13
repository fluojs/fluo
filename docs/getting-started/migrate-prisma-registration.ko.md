# Prisma 등록 마이그레이션

<p><a href="./migrate-prisma-registration.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

`@fluojs/prisma`에는 하나의 애플리케이션 등록 경로가 있습니다. `PrismaModule.forRoot(...)` 또는 `PrismaModule.forRootAsync(...)`를 import한 뒤 `PrismaService`를 주입하세요. 기본 등록은 `PrismaService` class token과 `getPrismaServiceToken()`을 같은 module-owned facade의 alias로 만듭니다. 이름 있는 등록은 계속 scoped이며 `getPrismaServiceToken(name)`으로만 resolve되고 `PrismaService` class token을 bind하거나 export하지 않습니다.

<!-- fluo-prisma-registration-contract: default-class-token-alias, named-token-isolation, no-transaction-interceptor-export -->

`PrismaService.createFacade(...)`와 `PrismaTransactionInterceptor`는 제거되었습니다. lane의 patch-only Changeset 정책에도 이 변경은 breaking migration입니다.

## Facade 조립 교체

직접 `PrismaService.createFacade(client)`를 호출하던 코드를 제거하세요. `PrismaModule`로 client를 등록하고 `PrismaService`를 주입하며, 생성된 delegate를 호출하는 repository는 `PrismaServiceFacade<TClient>`로 타입을 지정하세요. 주입된 값은 `PrismaService` DI token, lifecycle ownership, `instanceof` identity, ambient transaction delegation을 보존합니다.

```ts
import { Inject } from '@fluojs/core';
import { PrismaModule, PrismaService, type PrismaServiceFacade } from '@fluojs/prisma';

const persistence = PrismaModule.forRoot({ client });

@Inject(PrismaService)
class UserRepository {
  constructor(
    private readonly prisma: PrismaServiceFacade<typeof client>,
  ) {}
}
```

이름 있는 등록에는 `getPrismaServiceToken(name)`을 주입하세요. 이 token은 해당 이름 등록의 격리된 facade를 resolve하며 `PrismaService` class token의 alias가 아닙니다. 두 번째 facade를 만들거나 lifecycle owner를 중복하지 마세요.

## 요청 인터셉터 등록 교체

`@UseInterceptors(PrismaTransactionInterceptor)`는 `prisma.requestTransaction(() => next.handle(), context.requestContext.request.signal)`을 호출하는 애플리케이션 소유 interceptor 또는 controller 경계로 교체하세요. 같은 request signal을 전달하면 cancellation과 완전한 downstream handler scope를 보존합니다. 일반적인 비즈니스 원자성은 서비스 `@Transaction()` 메서드에 두세요.

## 검증

기본 등록이 `PrismaService`와 `getPrismaServiceToken()`에서 같은 facade를 resolve하는지 검증하세요. 각 이름 있는 등록은 자기 `getPrismaServiceToken(name)`으로만 resolve되고 다른 이름과 격리되며 `PrismaService` class token을 노출하지 않는지 검증하세요. 또한 생성된 delegate 호출이 ambient transaction client를 선택하는지, request cancellation이 `requestTransaction(...)`에 도달하는지, application shutdown이 하나의 connect/disconnect lifecycle을 소유하는지, `PrismaTransactionInterceptor`가 root-package export가 아닌지 검증하세요.
