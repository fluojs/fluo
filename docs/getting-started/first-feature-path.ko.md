# Feature Creation Reference

<p><strong><kbd>한국어</kbd></strong> <a href="./first-feature-path.md"><kbd>English</kbd></a></p>

이 문서는 fluo 애플리케이션에서 사용하는 최소 기능 슬라이스 구조를 정의한다. 이 저장소의 기준 예시는 `examples/minimal/src/hello.*` 및 `examples/realworld-api/src/users/*`이다.

단계별 실습은 [FluoBlog 튜토리얼](../../apps/docs/content/docs/tutorial/index.ko.mdx)을 이용하세요. 이 페이지는 기존 애플리케이션을 위한 구조 레퍼런스로 유지합니다.

## Required Files

가장 작은 HTTP 기능 슬라이스는 보통 `src/users/` 또는 `src/catalog/` 같은 전용 디렉터리 아래에 다음 파일을 둔다.

| File | Role | Required | Notes |
| --- | --- | --- | --- |
| `*.module.ts` | 슬라이스의 모듈 경계 | Yes | `@Module(...)`로 `controllers`, `providers`, `imports`, `exports` 메타데이터를 선언한다. |
| `*.service.ts` | 비즈니스 로직 프로바이더 | Yes | 모듈의 `providers` 목록에 등록한다. 생성자가 다른 토큰이나 클래스를 의존하면 `@Inject(...)`를 추가한다. |
| `*.controller.ts` | HTTP 라우트 표면 | HTTP 기능에서는 Yes | `@fluojs/http`의 `@Controller(...)`와 라우트 데코레이터를 사용한다. |
| `*.repo.ts` 또는 동등 파일 | 영속성 또는 데이터 액세스 프로바이더 | No | 서비스가 단일 파일 범위를 넘기 시작하면 흔해진다. 현재 저장소 패턴은 `examples/realworld-api/src/users/users.repo.ts`이다. |
| `*.dto.ts` | 요청 검증 경계 | No | 요청 본문 검증이나 변환이 필요할 때 추가한다. 예시는 `create-user.dto.ts`이다. |
| `*.response.dto.ts` 또는 동등 파일 | 응답 계약 타입 | No | 기능이 안정적인 응답 형태를 노출할 때 사용한다. |

`examples/minimal/src/hello.service.ts`는 가장 작은 서비스 파일을 보여 주고, `examples/realworld-api/src/users/`는 저장소와 DTO를 포함한 확장 슬라이스를 보여 준다.

## Module Registration

기능 모듈은 `@fluojs/core`의 `@Module(...)`로 선언한다. 현재 저장소 패턴은 명시적 메타데이터 배열을 가진 클래스이다.

```ts
import { Module } from '@fluojs/core';

import { UsersController } from './users.controller';
import { UsersRepo } from './users.repo';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersRepo, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

런타임이 사용하는 모듈 등록 사실은 다음과 같다.

- `controllers`는 기능의 라우트 핸들러를 노출한다.
- `providers`는 클래스 또는 프로바이더 정의를 슬라이스 컨테이너에 등록한다.
- `exports`는 다른 import 모듈이 이 슬라이스의 프로바이더를 사용해야 할 때 필요하다.
- `imports`는 슬라이스가 다른 모듈이 export한 프로바이더를 소비할 때 필요하다.

루트 활성화는 기능 모듈을 애플리케이션 모듈에 import해서 수행한다.

```ts
import { Module } from '@fluojs/core';

import { UsersModule } from './users/users.module';

@Module({
  imports: [UsersModule],
})
export class AppModule {}
```

런타임은 이 메타데이터를 모듈 그래프로 컴파일한다. 가시성 관계가 잘못되었거나 export 관계가 빠지면 `ModuleVisibilityError`, `ModuleInjectionMetadataError` 같은 런타임 오류로 드러난다.

## DI Wiring

fluo는 `@Inject(...)`를 통해 명시적 생성자 토큰 메타데이터를 사용한다. `packages/core/src/decorators.ts`는 가변 인자 형태의 `@Inject(A, B)`를 기준 API로 정의한다.

```ts
import { Inject } from '@fluojs/core';

import { UsersRepo } from './users.repo';

@Inject(UsersRepo)
export class UsersService {
  constructor(private readonly repo: UsersRepo) {}
}
```

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get, Post, RequestDto } from '@fluojs/http';

import { CreateUserDto } from './create-user.dto';
import { UsersService } from './users.service';

@Inject(UsersService)
@Controller('/users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get('/')
  list() {
    return this.service.listUsers();
  }

  @Post('/')
  @RequestDto(CreateUserDto)
  create(dto: CreateUserDto) {
    return this.service.createUser(dto.name, dto.email);
  }
}
```

기능 슬라이스의 DI 연결 규칙은 다음과 같다.

- `@Inject(...)`의 토큰 순서는 생성자 파라미터 순서와 대응한다.
- 저장소나 서비스처럼 기능 내부에서 쓰는 프로바이더는 구체 클래스 토큰을 사용하는 경우가 많다.
- fluo는 `emitDecoratorMetadata`에 의존하지 않으므로 추상 토큰이나 심볼도 항상 명시적 `@Inject(TOKEN)`가 필요하다.
- 프로바이더는 주입 전에 현재 모듈에 등록되어 있거나, import한 모듈에서 export되어 있어야 한다.

## Checklist

- `src/users/` 같은 전용 기능 디렉터리를 만든다.
- `@Module(...)` 메타데이터를 가진 `*.module.ts` 파일을 추가한다.
- 모든 컨트롤러를 `controllers`에 등록한다.
- 모든 서비스, 저장소, 프로바이더를 `providers`에 등록한다.
- 다른 모듈이 소비해야 하는 프로바이더만 `exports`에 노출한다.
- 기능 모듈을 루트 애플리케이션 모듈 또는 이를 조합하는 상위 모듈에 import한다.
- 생성자 의존성이 있는 클래스에는 `@Inject(...)`를 추가한다.
- 기능 경계에 필요할 때만 DTO 또는 응답 계약 파일을 추가한다.
