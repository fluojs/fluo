# 참조 슬라이스(Reference Slice)

<p><a href="./reference-slice.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 문서는 나중에 다른 문서에서 요청 DTO 바인딩, 유효성 검사, 서비스 경계, 저장소 이음새(seam), 정식 응답을 포함하는 엔드 투 엔드 예시가 필요할 때 재사용할 수 있는 구체적인 요청 흐름을 담고 있습니다.

## 참조 흐름

정식 참조 슬라이스는 `packages/prisma/src/vertical-slice.test.ts`에 위치합니다.

해당 슬라이스는 다음 경로를 엔드 투 엔드로 검증합니다:

1. `AppModule` 부트스트랩을 통해 요청이 앱으로 들어옴
2. 라우트 메타데이터가 요청 DTO를 바인딩함
3. 컨트롤러 메서드 본문 실행 전 DTO 유효성 검사가 수행됨
4. 컨트롤러가 서비스에 작업을 위임함
5. 서비스가 저장소(repository)에 작업을 위임함
6. 실제 어댑터 기반 예시를 통해 저장소 이음새가 작동함
7. 런타임이 정식 성공 및 에러 응답을 반환함

## 주요 산출물

- 요청 DTO: `CreateUserRequest`, `GetUserRequest`
- 컨트롤러: `UsersController`
- 서비스: `UserService`
- 저장소: `UserRepository`
- 어댑터 모듈 경계: `createPrismaModule(...)`
- 어댑터 런타임 핸들: `PrismaService`

## 복사 가능한 형태

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

## 이것이 참조 슬라이스인 이유

- 실제 앱과 동일한 명시적 데코레이터 계약을 사용함
- HTTP 런타임을 통해 DTO 바인딩 및 유효성 검사를 수행함
- 컨트롤러 -> 서비스 -> 저장소 -> 어댑터 이음새를 모두 관통함
- 성공 응답과 정식 에러 응답을 모두 포함함
- 나중에 다른 문서, 생성기, 예시에서 새로운 패턴을 만들지 않고도 복사해 쓸 수 있을 만큼 작음
