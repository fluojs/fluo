# 파트 II 개요 — 핵심 실행 경로

> **기준 소스**: [repo:docs/getting-started/first-feature-path.md] [repo:docs/concepts/architecture-overview.md] [repo:docs/concepts/di-and-modules.md] [repo:docs/concepts/http-runtime.md]

이 파트는 독자를 starter 형태의 앱에서 출발시켜, bootstrap, DI, module boundary, request execution, configuration을 실제 코드 수준에서 이해하도록 이끈다.

## 파트 목표

1. 첫 실행 가능한 앱에서 첫 기능 슬라이스까지 도달하게 한다.
2. runtime, DI, HTTP가 어떻게 이어지는지 하나의 흐름으로 보여준다.
3. 추상 설명을 예제 코드에 계속 묶어 둔다.

## 포함될 챕터

### 4장. 부트스트랩과 플랫폼 어댑터

`quick-start`와 minimal 예제를 첫 번째 실제 앵커로 사용한다 `[repo:docs/getting-started/quick-start.md]` `[ex:minimal/README.md]`.

```ts
// source: ex:minimal/src/main.ts
import { createFastifyAdapter } from '@konekti/platform-fastify';
import { KonektiFactory } from '@konekti/runtime';

import { AppModule } from './app';

const app = await KonektiFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
```

이 adapter-first bootstrap은 runtime-neutral 설계가 코드에서 어떻게 드러나는지를 보여주는 첫 장면이다 `[repo:docs/concepts/architecture-overview.md]` `[pkg:runtime/README.md]`.

### 5장. 첫 번째 기능 슬라이스

first-feature 문서는 feature boundary, provider 생성, controller 생성, module 묶기, root app에 장착하는 과정을 가장 자연스럽게 보여준다 `[repo:docs/getting-started/first-feature-path.md]`.

### 6장~8장. core, DI, module graph

이 구간에서는 표준 데코레이터, metadata registry, token 기반 DI, scope, imports/exports를 하나의 이야기로 묶어 설명해야 한다 `[repo:docs/concepts/decorators-and-metadata.md]` `[repo:docs/concepts/di-and-modules.md]` `[pkg:core/README.md]` `[pkg:di/README.md]`.

### 9장. HTTP 런타임과 DTO 흐름

HTTP runtime 개념 문서는 파이프라인을 설명하고, realworld controller는 그 파이프라인이 코드에서 어떤 모양인지 보여준다 `[repo:docs/concepts/http-runtime.md]` `[ex:realworld-api/src/users/users.controller.ts]`.

```ts
// source: ex:realworld-api/src/users/users.controller.ts
@Inject(UsersService)
@Controller('/users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Post('/')
  @RequestDto(CreateUserDto)
  create(dto: CreateUserDto): UserResponseDto {
    return this.service.createUser(dto.name, dto.email);
  }
}
```

### 10장. 설정은 데이터다

config 문서와 package README를 함께 사용해, 왜 Konekti가 흩어진 `process.env` 접근을 싫어하고 bootstrap 시점의 검증을 선호하는지 설명한다 `[repo:docs/concepts/config-and-environments.md]` `[pkg:config/README.md]`.

## 연결 챕터

- `chapter-04-bootstrap-and-adapter.md`
- `chapter-05-first-feature-slice.md`
- `chapter-06-standard-decorators-and-metadata.md`
- `chapter-07-token-based-di-and-container-resolution.md`
- `chapter-08-module-boundaries-and-graph.md`
- `chapter-09-http-runtime-and-dto-flow.md`
- `chapter-10-config-as-runtime-data.md`
