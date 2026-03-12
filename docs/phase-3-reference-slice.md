# Phase 3 Reference Slice

This document is the reusable reference slice for Phase 3.

It points to one concrete request flow that later phases can reuse when they need an end-to-end example covering request DTO binding, validation, service boundaries, ORM access, and canonical responses.

## Reference flow

The canonical reference slice lives in `packages/prisma/src/vertical-slice.test.ts`.

That slice proves this path end to end:

1. Request enters the app through `AppModule` bootstrap.
2. Route metadata binds a request DTO.
3. DTO validation runs before the controller method body.
4. The controller delegates to a service.
5. The service delegates to a repository.
6. The repository uses the selected ORM integration (`PrismaService`).
7. The runtime returns canonical success and error responses.

## Main artifacts

- Request DTOs: `CreateUserRequest`, `GetUserRequest` in `packages/prisma/src/vertical-slice.test.ts`
- Controller: `UsersController` in `packages/prisma/src/vertical-slice.test.ts`
- Service: `UserService` in `packages/prisma/src/vertical-slice.test.ts`
- Repository: `UserRepository` in `packages/prisma/src/vertical-slice.test.ts`
- ORM module boundary: `createPrismaModule(...)` in `packages/prisma/src/module.ts`
- ORM runtime handle: `PrismaService` in `packages/prisma/src/service.ts`

## Copy-pastable example shape

```ts
class CreateUserRequest {
  @FromBody('email')
  email = '';

  @FromBody('name')
  name = '';
}

@Inject([UserService])
@Controller('/users')
class UsersController {
  constructor(private readonly users: UserService) {}

  @RequestDto(CreateUserRequest)
  @SuccessStatus(201)
  @Post('/')
  async create(input: CreateUserRequest) {
    return this.users.create(input);
  }
}
```

This is the smallest recommended Phase 3 shape for later docs and examples: one request DTO, one controller route, one service boundary, and one selected ORM integration path.

## Canonical error example

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed.",
    "requestId": "req-prisma-400",
    "status": 400,
    "details": [
      {
        "code": "REQUIRED",
        "field": "name",
        "message": "name is required",
        "source": "body"
      }
    ]
  }
}
```

This shows the strict-close 3B/3D contract in one place: the reference slice includes both the reusable request flow and the canonical error envelope with correlated `requestId`.

## Why this is the reference slice

- It uses the same explicit decorator contracts as real apps.
- It exercises DTO binding and validation through the HTTP runtime.
- It crosses the controller -> service -> repository -> ORM seam.
- It includes both success and canonical error responses.
- It is small enough to copy into later docs, generators, and examples without inventing a second pattern.

## Reuse guidance

When a later phase needs a concrete example, prefer adapting this slice instead of introducing a new ad hoc one.

- For HTTP/docs work, keep `CreateUserRequest` and `UsersController` as the request-shape reference.
- For data-layer docs, keep `UserRepository` + `PrismaService` as the ORM-boundary reference.
- For testing/docs examples, keep the success + validation-error + not-found response set as the canonical response reference.
