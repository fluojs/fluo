# 제너레이터 워크플로우

<p><strong><kbd>한국어</kbd></strong> <a href="./generator-workflow.md"><kbd>English</kbd></a></p>

fluo CLI를 사용하여 반복적인 코드를 줄이고 일관된 프로젝트 구조를 유지하세요. 제너레이터는 fluo의 module-first 규약에 맞는 실제 구성 요소를 빠르게 만들어 줍니다.

### 대상 독자
아키텍처의 일관성을 유지하면서 모듈, 컨트롤러, 서비스 생성을 자동화하여 생산성을 높이고 싶은 개발자.

### 1. 전체 기능 모듈 생성
**모듈(Module)**은 fluo에서 조직화의 기본 단위입니다. 한 번의 명령으로 모듈 진입점을 만들고, 필요한 구성 요소를 뒤이어 세분화해 추가할 수 있습니다.

```sh
fluo g module catalog
```

이 명령은 다음 구조를 생성합니다:

```
src/
└── catalog/
    └── catalog.module.ts
```

생성된 모듈 파일은 다음과 같습니다:

```ts
import { Module } from '@fluojs/core';

@Module({
  controllers: [],
  providers: [],
})
export class CatalogModule {}
```

여기에 컨트롤러, 서비스 등의 구성 요소를 기능이 커질수록 차례로 추가할 수 있습니다.

### 2. 정밀한 컴포넌트 생성
기존 기능에 단일 구성 요소를 추가해야 하나요? 세분화된 제너레이터를 사용하세요.

```sh
fluo g controller catalog
fluo g service catalog
```

두 명령 실행 후 기능 디렉토리는 다음과 같습니다:

```
src/
└── catalog/
    ├── catalog.module.ts
    ├── catalog.controller.ts
    └── catalog.service.ts
```

생성된 컨트롤러는 표준 `@Inject` + `@Controller` 패턴을 따릅니다:

```ts
import { Inject } from '@fluojs/core';
import { Controller } from '@fluojs/http';

import { CatalogService } from './catalog.service';

@Inject(CatalogService)
@Controller('/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}
}
```

사용 가능한 전체 제너레이터 목록:

| 명령 | 생성 결과 |
| :--- | :--- |
| `fluo g module name` | `@Module` 데코레이터가 포함된 모듈 정의 |
| `fluo g controller name` | `@Controller`와 `@Inject`가 포함된 HTTP 컨트롤러 |
| `fluo g service name` | 비즈니스 로직 서비스 클래스 |
| `fluo g repo name` | 데이터 레포지토리 패턴 클래스 |

### 3. 유연한 출력 경로
기본적으로 CLI는 `src/`를 타겟으로 합니다. 프로젝트의 디렉토리 구조에 맞게 `--target-directory` (또는 `-o`) 플래그를 사용할 수 있습니다.

```sh
fluo g module auth --target-directory src/shared
```

이렇게 하면 `src/auth/auth.module.ts` 대신 `src/shared/auth/auth.module.ts`가 생성됩니다.

### 4. 드라이 런을 통한 안전한 실행
변경 사항을 실제로 적용하기 전에 어떤 파일이 수정되거나 생성될지 미리 확인해 보세요.

```sh
fluo g module shop --dry-run
```

파일 시스템을 건드리지 않고 계획된 작업만 출력하므로, 경로와 이름을 생성 전에 확인할 수 있습니다.

### 5. 전체 기능 슬라이스 조합
실제로는 제너레이터를 연속 사용하여 완전한 기능을 구성합니다. 새로운 `orders` 기능을 만드는 전형적인 워크플로우는 다음과 같습니다:

```sh
# 1. 모듈 생성
fluo g module orders

# 2. 컨트롤러와 서비스 추가
fluo g controller orders
fluo g service orders

# 3. 데이터 접근을 위한 레포지토리 추가
fluo g repo orders
```

결과:

```
src/
└── orders/
    ├── orders.module.ts
    ├── orders.controller.ts
    ├── orders.service.ts
    └── orders.repo.ts
```

그런 다음 `orders.module.ts`에서 모든 요소를 연결합니다:

```ts
import { Module } from '@fluojs/core';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepo } from './orders.repo';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepo],
  exports: [OrdersService],
})
export class OrdersModule {}
```

그리고 루트 `AppModule`에서 해당 모듈을 import합니다:

```ts
import { Module } from '@fluojs/core';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule],
})
export class AppModule {}
```

### 왜 CLI를 사용해야 하나요?
- **반복 코드 감소**: 디렉토리 생성, 파일 이름 규칙, 기본 import 구성을 손으로 맞출 필요가 줄어듭니다.
- **일관된 구조**: 생성된 파일은 fluo 레퍼런스 문서가 설명하는 배치 규칙을 따릅니다.
- **조합 가능한 워크플로우**: 모듈로 시작한 뒤 기능이 커질수록 컨트롤러, 서비스, DTO, 이벤트, 레포지토리를 차례대로 추가할 수 있습니다.

### 다음 단계
- **로직 구현하기**: 파일이 준비되었다면 [첫 번째 기능 구현 경로](./first-feature-path.ko.md)를 따라 로직을 추가해 보세요.
- **검증**: 생성된 컴포넌트를 테스트하는 방법은 [테스트 가이드](../operations/testing-guide.ko.md)에서 확인할 수 있습니다.
