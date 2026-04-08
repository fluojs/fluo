# 첫 번째 기능 구현 경로

<p><strong><kbd>한국어</kbd></strong> <a href="./first-feature-path.md"><kbd>English</kbd></a></p>

기본 스타터 앱에서 나아가 실제 비즈니스 로직을 구축해 보세요. Konekti는 기술 계층이 아닌 기능별로 관련 로직을 그룹화하는 **슬라이스 기반 아키텍처(Slice-based architecture)**를 권장합니다.

### 대상 독자
[퀵 스타트](./quick-start.ko.md)를 완료하고 첫 번째 API 엔드포인트를 구현할 준비가 된 개발자.

### 1. 기능 경계 정의
기능 슬라이스를 위한 전용 디렉토리를 생성합니다. 여기서는 "catalog" 서비스를 만들어 보겠습니다.

```sh
mkdir -p src/catalog
```

### 2. 프로바이더 생성
프로바이더는 비즈니스 로직이나 데이터 액세스를 처리합니다. Konekti에서는 클래스 상단에 `@Inject` 데코레이터를 사용하여 의존성을 명시적으로 선언합니다.

```ts
// src/catalog/product.service.ts
import { Scope } from '@konekti/core';

@Scope('singleton')
export class ProductService {
  getProducts() {
    return [{ id: 1, name: 'Standard Decorator', price: 99 }];
  }
}
```

### 3. 컨트롤러 생성
컨트롤러는 HTTP 인터페이스를 정의합니다. `ProductService`를 명시적으로 `@Inject`하는 방식에 주목하세요.

```ts
// src/catalog/product.controller.ts
import { Controller, Get } from '@konekti/http';
import { Inject } from '@konekti/core';
import { ProductService } from './product.service';

@Controller('/products')
@Inject([ProductService])
export class ProductController {
  constructor(private readonly service: ProductService) {}

  @Get('/')
  list() {
    return this.service.getProducts();
  }
}
```

### 4. 모듈로 묶기
모듈은 Konekti 애플리케이션 그래프를 구성하는 기본 단위입니다.

```ts
// src/catalog/catalog.module.ts
import { Module } from '@konekti/core';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';

@Module({
  providers: [ProductService],
  controllers: [ProductController],
  exports: [ProductService], // 선택 사항: 다른 모듈에서 이 서비스가 필요한 경우 export 합니다.
})
export class CatalogModule {}
```

### 5. 애플리케이션에 마운트
새로 만든 모듈을 루트 `AppModule`에 추가하여 활성화합니다.

```ts
// src/app.module.ts
import { Module } from '@konekti/core';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [CatalogModule],
})
export class AppModule {}
```

### 확인
개발 서버가 실행 중인 상태에서 새로운 엔드포인트를 확인하세요.
```sh
curl http://localhost:3000/products
```
*기대 결과: `[{"id":1,"name":"Standard Decorator","price":99}]`*

### 왜 이런 방식을 사용하나요?
- **명시적 연결**: `@Inject([ProductService])`를 통해 숨겨진 메타데이터 마법 없이도 클래스가 무엇에 의존하는지 즉시 파악할 수 있습니다.
- **슬라이스 소유권**: "Catalog"와 관련된 모든 로직이 한 곳에 모여 있어 유지보수와 확장이 용이합니다.
- **표준 준수**: 이 모든 흐름은 미래의 ECMAScript 표준과 일치하는 기본 TypeScript 데코레이터를 사용합니다.

### 다음 단계
- **반복 작업 자동화**: `konekti g module catalog` 명령어를 사용하여 이 모든 구조를 단 몇 초 만에 생성해 보세요. [제너레이터 워크플로우](./generator-workflow.ko.md)에서 자세히 알아볼 수 있습니다.
- **유효성 검사 추가**: 안전하고 타입 안정성이 보장된 입력을 위해 DTO와 `@konekti/validation`을 사용하는 방법을 배워보세요.
