# reference slice

<p><strong><kbd>English</kbd></strong> <a href="./reference-slice.ko.md"><kbd>한국어</kbd></a></p>


This document captures one concrete request flow that later docs can reuse when they need an end-to-end example covering request DTO binding, validation, service boundaries, repository seams, and canonical responses.

## reference flow

The canonical reference slice lives in `packages/prisma/src/vertical-slice.test.ts`.

That slice proves this path end to end:

1. request enters the app through `AppModule` bootstrap
2. route metadata binds a request DTO
3. DTO validation runs before the controller method body
4. the controller delegates to a service
5. the service delegates to a repository
6. the repository seam is exercised through one concrete adapter-backed example
7. the runtime returns canonical success and error responses

## main artifacts

- request DTOs: `CreateUserRequest`, `GetUserRequest`
- controller: `UsersController`
- service: `UserService`
- repository: `UserRepository`
- adapter module boundary: `createPrismaModule(...)`
- adapter runtime handle: `PrismaService`

## copy-pastable shape

```ts
import { IsString, MinLength } from '@konekti/dto-validator';
import { FromBody, Post, RequestDto, SuccessStatus } from '@konekti/http';

class CreateUserRequest {
  @FromBody('email')
  @IsString()
  email = '';

  @FromBody('name')
  @MinLength(1, { message: 'name is required' })
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

## why this is the reference slice

- it uses the same explicit decorator contracts as real apps
- it exercises DTO binding and validation through the HTTP runtime
- it crosses the controller -> service -> repository -> adapter seam
- it includes both success and canonical error responses
- it is small enough to copy into later docs, generators, and examples without inventing a second pattern
