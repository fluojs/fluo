# Migrate Prisma Registration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-prisma-registration.ko.md"><kbd>한국어</kbd></a></p>

`@fluojs/prisma` has one application registration path: import `PrismaModule.forRoot(...)` or `PrismaModule.forRootAsync(...)`, then inject `PrismaService`. Named registrations remain scoped and use `getPrismaServiceToken(name)`.

`PrismaService.createFacade(...)` and `PrismaTransactionInterceptor` are removed. This is a breaking migration despite the lane's patch-only Changeset policy.

## Replace Facade Assembly

Remove direct `PrismaService.createFacade(client)` calls. Register the client through `PrismaModule`, inject `PrismaService`, and type a repository that calls generated delegates as `PrismaServiceFacade<TClient>`. The injected value preserves the `PrismaService` DI token, lifecycle ownership, `instanceof` identity, and ambient transaction delegation.

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

Inject `getPrismaServiceToken(name)` for a named registration; do not construct a second facade or duplicate lifecycle owner.

## Replace Request Interceptor Registration

Replace `@UseInterceptors(PrismaTransactionInterceptor)` with an application-owned interceptor or controller boundary that calls `prisma.requestTransaction(() => next.handle(), context.requestContext.request.signal)`. Forwarding the same request signal preserves cancellation and the complete downstream handler scope. Keep ordinary business atomicity on service `@Transaction()` methods.

## Verification

Verify that the registered service is the same instance resolved through its class and named token, generated delegate calls select the ambient transaction client, request cancellation reaches `requestTransaction(...)`, and application shutdown owns one connect/disconnect lifecycle.
