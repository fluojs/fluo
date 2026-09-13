# Migrate Prisma Registration

<p><strong><kbd>English</kbd></strong> <a href="./migrate-prisma-registration.ko.md"><kbd>한국어</kbd></a></p>

`@fluojs/prisma` has one application registration path: import `PrismaModule.forRoot(...)` or `PrismaModule.forRootAsync(...)`, then inject `PrismaService`. A default registration aliases the `PrismaService` class token and `getPrismaServiceToken()` to the same module-owned facade. Named registrations remain scoped, resolve only through `getPrismaServiceToken(name)`, and do not bind or export the `PrismaService` class token.

<!-- fluo-prisma-registration-contract: default-class-token-alias, named-token-isolation, no-transaction-interceptor-export -->

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

Inject `getPrismaServiceToken(name)` for a named registration; it resolves that named registration's isolated facade and never aliases the `PrismaService` class token. Do not construct a second facade or duplicate lifecycle owner.

## Replace Request Interceptor Registration

Replace `@UseInterceptors(PrismaTransactionInterceptor)` with an application-owned interceptor or controller boundary that calls `prisma.requestTransaction(() => next.handle(), context.requestContext.request.signal)`. Forwarding the same request signal preserves cancellation and the complete downstream handler scope. Keep ordinary business atomicity on service `@Transaction()` methods.

## Verification

Verify that a default registration resolves the same facade through `PrismaService` and `getPrismaServiceToken()`. Verify each named registration resolves only through its own `getPrismaServiceToken(name)`, remains isolated from other names, and does not expose the `PrismaService` class token. Also verify generated delegate calls select the ambient transaction client, request cancellation reaches `requestTransaction(...)`, application shutdown owns one connect/disconnect lifecycle, and `PrismaTransactionInterceptor` is not a root-package export.
