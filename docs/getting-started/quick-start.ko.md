# 퀵 스타트

<p><strong><kbd>한국어</kbd></strong> <a href="./quick-start.md"><kbd>English</kbd></a></p>

1분 안에 표준 데코레이터와 명시적 의존성 주입을 경험해 보세요. 레거시 컴파일러 플래그나 마법 같은 리플렉션 없이, 깨끗하고 검증 가능한 TypeScript를 만나실 수 있습니다.

### 대상 독자
레거시 데코레이터에서 벗어나 현대적이고 고성능인 TypeScript 프레임워크를 사용하고 싶은 개발자.

### 1. CLI 설치
fluo CLI는 프로젝트 스캐폴딩과 컴포넌트 생성을 담당합니다.

```sh
pnpm add -g @fluojs/cli
```

### 2. 프로젝트 생성
새 애플리케이션을 초기화합니다. 기본적으로 Node.js 환경의 고성능 Fastify HTTP 어댑터가 생성됩니다.

```sh
fluo new my-fluo-app
cd my-fluo-app
```

대화형 터미널 마법사(interactive terminal)를 사용하는 것이 좋지만, 명시적 플래그를 사용해 특정 스타터를 선택할 수도 있습니다.

| Shape | Transport | Runtime | Platform | Command |
| :--- | :--- | :--- | :--- | :--- |
| application | http | node | fastify | `fluo new app --shape application --transport http --runtime node --platform fastify` |
| application | http | node | express | `fluo new app --shape application --transport http --runtime node --platform express` |
| application | http | node | nodejs | `fluo new app --shape application --transport http --runtime node --platform nodejs` |
| application | http | bun | bun | `fluo new app --shape application --transport http --runtime bun --platform bun` |
| application | http | deno | deno | `fluo new app --shape application --transport http --runtime deno --platform deno` |
| application | http | cloudflare-workers | cloudflare-workers | `fluo new app --shape application --transport http --runtime cloudflare-workers --platform cloudflare-workers` |
| microservice | tcp | node | none | `fluo new svc --shape microservice --transport tcp --runtime node --platform none` |
| microservice | redis-streams | node | none | `fluo new svc --shape microservice --transport redis-streams --runtime node --platform none` |
| microservice | nats | node | none | `fluo new svc --shape microservice --transport nats --runtime node --platform none` |
| microservice | kafka | node | none | `fluo new svc --shape microservice --transport kafka --runtime node --platform none` |
| microservice | rabbitmq | node | none | `fluo new svc --shape microservice --transport rabbitmq --runtime node --platform none` |
| microservice | mqtt | node | none | `fluo new svc --shape microservice --transport mqtt --runtime node --platform none` |
| microservice | grpc | node | none | `fluo new svc --shape microservice --transport grpc --runtime node --platform none` |
| mixed | tcp | node | fastify | `fluo new app --shape mixed --transport tcp --runtime node --platform fastify` |

사용 가능한 전체 구성 목록은 [fluo new 지원 매트릭스](../reference/fluo-new-support-matrix.ko.md)에서 확인하세요.

### 3. 개발 시작
fluo 스타터는 TypeScript 컴파일과 프로세스 재시작을 자동으로 처리하는 최적화된 개발 환경을 제공합니다.

```sh
pnpm dev
```

### 4. 설정 확인
서버가 3000번 포트에서 실행되면, 내장된 관측성 엔드포인트와 샘플 API를 확인해 보세요.

- **헬스 체크**: `curl http://localhost:3000/health`
  *기대 결과: {"status":"ok"}*
- **인사말 API**: `curl http://localhost:3000/hello`
  *기대 결과: {"message":"Hello, World!"}*

### 5. 프로젝트 이해하기
생성된 프로젝트는 명확한 구조와 명시적 의존성 관리를 위해 모듈화된 설계를 따릅니다.

```text
my-fluo-app/
├── src/
│   ├── main.ts            # 애플리케이션 진입점
│   ├── app.ts             # 루트 모듈 정의
│   ├── hello.controller.ts # HTTP 요청 핸들러
│   └── hello.service.ts    # 비즈니스 로직 제공자
├── tsconfig.json          # 표준 중심 설정
└── package.json
```

#### main.ts: 진입점
진입점에서는 선택한 플랫폼 어댑터와 루트 모듈을 사용해 런타임을 초기화합니다.

```ts
import { createFastifyAdapter } from '@fluojs/platform-fastify';
import { FluoFactory } from '@fluojs/runtime';
import { AppModule } from './app';

const app = await FluoFactory.create(AppModule, {
  adapter: createFastifyAdapter({ port: 3000 }),
});
await app.listen();
```

#### app.ts: 루트 모듈
`@Module` 데코레이터는 애플리케이션 경계를 정의합니다. 라우팅을 위한 컨트롤러와 로직을 담당하는 프로바이더를 모읍니다.

```ts
import { Module } from '@fluojs/core';
import { createHealthModule } from '@fluojs/runtime';
import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

const RuntimeHealthModule = createHealthModule();

@Module({
  imports: [RuntimeHealthModule],
  controllers: [HelloController],
  providers: [HelloService],
})
export class AppModule {}
```

#### hello.controller.ts: 요청 처리
컨트롤러는 `@Controller`와 `@Get` 데코레이터를 사용해 요청을 메서드에 매핑합니다. 의존성 주입은 `@Inject` 데코레이터를 통해 명시적으로 이루어집니다.

```ts
import { Inject } from '@fluojs/core';
import { Controller, Get } from '@fluojs/http';
import { HelloService } from './hello.service';

@Inject(HelloService)
@Controller('/hello')
export class HelloController {
  constructor(private readonly helloService: HelloService) {}

  @Get('/')
  greet(): { message: string } {
    return this.helloService.greet('World');
  }
}
```

#### hello.service.ts: 비즈니스 로직
서비스는 실제 로직을 처리하는 클래스입니다. 모듈에 프로바이더로 등록되어 필요한 곳에 주입됩니다.

```ts
export class HelloService {
  greet(name: string): { message: string } {
    return { message: `Hello, ${name}!` };
  }
}
```

### 왜 fluo인가요?
프로젝트의 `tsconfig.json`을 열어보세요. fluo가 TypeScript 표준 설정만으로 동작한다는 점을 알 수 있습니다.

```json
{
  "compilerOptions": {
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  }
}
```

TC39 표준 데코레이터를 사용하면 실험적 플래그 없이도 완벽한 IDE 지원과 타입 안정성을 누릴 수 있습니다.

### 다음 단계
- **진짜 서비스 만들기**: [첫 번째 기능 구현 경로](./first-feature-path.ko.md)를 따라 로직을 추가해 보세요.
- **CLI 마스터하기**: [제너레이터 워크플로우](./generator-workflow.ko.md)를 통해 기능 슬라이스를 생성하는 방법을 배워보세요.
- **Node.js 그 너머로**: [부트스트랩 경로](./bootstrap-paths.ko.md)를 통해 Bun, Deno, Edge 런타임을 확인해 보세요.
- **CLI 계약 확인하기**: 스타터 매트릭스는 [toolchain contract matrix](../reference/toolchain-contract-matrix.ko.md)에서 확인할 수 있습니다.
