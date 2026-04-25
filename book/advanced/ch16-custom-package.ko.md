<!-- packages: @fluojs/core, @fluojs/di, @fluojs/runtime -->
<!-- project-state: advanced -->

# Chapter 16. Creating Custom Packages

이 장은 fluo 생태계 안에서 재사용 가능한 패키지를 설계하고 공개 표면을 안정적으로 정의하는 방법을 설명합니다. Chapter 15가 내부 구조를 관찰하는 도구를 다뤘다면, 이 장은 그 구조 위에 새로운 확장 단위를 만드는 실전으로 넘어갑니다.

## Learning Objectives
- fluo 모노레포 패키지가 공개 표면과 내부 구현을 어떻게 나누는지 이해합니다.
- `exports` 필드와 엔트리포인트 설계가 패키지 안정성에 미치는 영향을 배웁니다.
- `DynamicModule`, `forRoot`, `forRootAsync` 패턴을 패키지 API에 적용하는 방법을 익힙니다.
- 옵션 토큰과 프로바이더 구성을 통해 확장 가능한 모듈을 설계하는 흐름을 살펴봅니다.
- 기능 플래그 예제로 패키지 구조, 서비스, 모듈 조합 방식을 분석합니다.
- 가시성 계약과 순환 의존성 대응 같은 라이브러리 설계 원칙을 정리합니다.

## Prerequisites
- Chapter 13부터 Chapter 15까지 완료.
- TypeScript 패키지 구조와 `package.json`의 `exports` 필드에 대한 기초 이해.
- fluo 모듈 시스템, DI, 동적 모듈 패턴에 대한 기본 이해.

## Monorepo Package Structure

fluo 모노레포는 높은 응집도와 낮은 결합도를 유지하기 위해 엄격한 조직 패턴을 따릅니다. 모든 공식 패키지는 예측 가능한 레이아웃을 사용하며, 커스텀 패키지도 같은 구조를 따르는 편이 좋습니다. 이 구조는 단순한 정리가 아니라, 생태계 전반의 일관된 품질을 유지하기 위해 빌드 도구가 확인하는 계약입니다.

### Public Surface and Internal Seams

fluo에서 가시성(visibility)은 일급 설계 요소입니다. 패키지는 보통 `package.json`의 `exports` 필드에 정의된 특정 엔트리 포인트 세트를 통해 기능을 노출합니다. 이 방식은 내부 파일에 대한 "심층 임포트(deep imports)"를 막고, 소비자가 안정적인 공개 API에만 의존하게 합니다.

```json
{
  "name": "@fluojs/my-package",
  "exports": {
    ".": "./dist/index.js",
    "./internal": "./dist/internal/index.js"
  }
}
```

1. **`index.ts` (공개 루트)**: 이 파일에는 공개 API, 데코레이터, 타입의 재노출(re-export)만 포함되어야 합니다. 패키지의 "정문" 역할을 합니다.
2. **`module.ts`**: `Module` 정의를 이 파일에 격리하는 경우가 많습니다. 그러면 소비자가 타입이나 유틸리티만 필요할 때 프레임워크 전용 메타데이터를 가져오지 않고 로직을 임포트할 수 있습니다.
3. **`internal/`**: 이 디렉토리에는 공개 계약의 일부가 아닌 구현 세부 사항이 들어갑니다. 이렇게 분리하면 해당 API가 유의적 버전(semver) 경고 없이 바뀔 수 있음을 명확히 알릴 수 있습니다.

### Dependency Declaration

fluo 패키지는 일반적으로 세 가지 핵심 기둥에 의존합니다.
- `@fluojs/core`: 메타데이터 중추(`@Module`, `@Global`, `@Inject`)를 제공합니다.
- `@fluojs/di`: 토큰 기반 컨테이너와 프로바이더 모델을 제공합니다.
- `@fluojs/runtime`: 수동 부트스트랩이나 그래프 조작을 수행하는 경우에만 필요합니다.

라이브러리를 만들 때는 사용자 의존성 그래프에서 버전 충돌을 피하기 위해 `@fluojs/core`와 `@fluojs/di`를 `peerDependencies`로 두는 편이 좋습니다. 특히 `@fluojs/di`는 여러 주입 엔진 인스턴스가 공존하면 토큰 확인 중 예상치 못한 동작이 생길 수 있으므로 주의해야 합니다.

## Designing DynamicModules

`DynamicModule` 패턴은 fluo에서 설정 가능한 기능을 제공하는 주요 방식입니다. 컴파일 타임에 정의되는 정적 모듈과 달리, 동적 모듈은 런타임에 생성되며 보통 설정 객체를 받습니다.

### The DynamicModule Contract

`DynamicModule`은 `ModuleMetadata` 인터페이스와 `module` 참조를 만족하는 객체(또는 객체를 반환하는 정적 메서드가 있는 클래스)입니다. 정적 모듈과 같은 메타데이터 형태를 유지하면서도, 호출 시점에 옵션과 프로바이더 구성을 함께 만들어낼 수 있다는 점이 핵심입니다.

```ts
export interface DynamicModule extends ModuleMetadata {
  module: Type<any>;
}
```

동적 모듈의 구성 요소:
- `imports`: 이 동적 인스턴스에 필요한 다른 모듈들.
- `providers`: 설정 객체를 포함한 커스텀 프로바이더들.
- `exports`: 임포트하는 모듈에 노출할 프로바이더들.
- `global`: 모듈을 전역적으로 표시하기 위한 불리언 플래그.

### The forRoot and forRootAsync Pattern

커뮤니티 표준에 맞춰 fluo 라이브러리는 정적 설정에는 `forRoot`를 사용하고, 다른 프로바이더(예: `ConfigService`)에 의존하는 설정에는 `forRootAsync`를 사용합니다. 이 이름을 따르면 사용자는 모듈이 동기 설정을 받는지, DI를 통해 비동기 설정을 해석하는지 곧바로 이해할 수 있습니다.

#### Implementation Strategy

1. **옵션 인터페이스 정의**: 모듈 설정에 대한 명확한 인터페이스를 만듭니다.
2. **주입 토큰 생성**: DI 컨테이너에서 옵션을 나타낼 `unique symbol`이나 문자열을 사용합니다.
3. **정적 `forRoot`**:
   ```ts
   static forRoot(options: MyModuleOptions): DynamicModule {
     return {
       module: MyModule,
       providers: [
         { provide: MY_OPTIONS, useValue: options },
         MyService,
       ],
       exports: [MyService],
     };
   }
   ```
4. **팩토리 기반 `forRootAsync`**:
   사용자가 `useFactory`, `useClass`, 또는 `useExisting` 전략을 제공할 수 있게 하려면 `AsyncModuleOptions`가 필요합니다. `inject` 배열은 팩토리가 실행되기 전에 `ConfigService` 같은 의존성을 해석하는 데 중요합니다.

## The exports Field and Visibility Contract

fluo에서 `@Module`의 `exports` 필드는 단순한 힌트가 아니라 엄격히 지켜지는 계약입니다. 부트스트랩 단계의 `ModuleGraph`는 다른 모듈이 내보낸 토큰에만 액세스할 수 있는지 검증합니다.

### Visibility Rules

1. **로컬 가시성**: 모든 프로바이더는 정의된 모듈 내에서 가시적입니다.
2. **내보낸 가시성**: 프로바이더는 정의 모듈을 `import`하는 모듈에 대해서만 `exports` 배열에 나열된 경우에 가시적입니다.
3. **재노출 (Re-exports)**: 모듈은 다른 모듈을 다시 내보낼 수 있습니다. 이를 통해 임포트된 모듈의 내보내기 항목을 "프록시" 모듈을 임포트하는 모든 모듈에서 사용할 수 있게 합니다.
4. **전역 모듈**: `@Global()` 데코레이터가 지정된 모듈은 명시적인 임포트가 필요 없지만, 그 프로바이더가 전체 애플리케이션 그래프에서 가시적이려면 여전히 내보내기(export)가 필요합니다.

## Practical Example: Feature-Flags Mini-Package

이 개념을 확인하기 위해 간단한 기능 플래그 패키지를 구성해 봅니다. 이 패키지는 설정에 따라 기능을 켜고 끌 수 있게 합니다. 예제가 작기 때문에 공개 표면, 옵션 토큰, 서비스, 동적 모듈이 서로 어떻게 맞물리는지 한눈에 볼 수 있습니다.

### 1. Structure

```text
packages/feature-flags/
├── src/
│   ├── index.ts
│   ├── feature-flags.module.ts
│   ├── feature-flags.service.ts
│   ├── constants.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

### 2. Defining the Types and Tokens

```ts
// types.ts
export interface FeatureFlagsOptions {
  flags: Record<string, boolean>;
}

// constants.ts
export const FEATURE_FLAGS_OPTIONS = Symbol.for('@fluojs/feature-flags:options');
```

### 3. The Service

서비스는 모듈에서 제공하는 옵션을 소비합니다. 옵션은 주입 토큰을 통해 전달되므로, 서비스는 설정이 정적 `forRoot`에서 왔는지 비동기 팩토리에서 왔는지 알 필요가 없습니다.

```ts
@Inject(FEATURE_FLAGS_OPTIONS)
export class FeatureFlagsService {
  constructor(private readonly options: FeatureFlagsOptions) {}

  isEnabled(feature: string): boolean {
    return !!this.options.flags[feature];
  }
}
```

### 4. The Dynamic Module

이 모듈에서 `forRoot` 및 `forRootAsync` 로직을 구현합니다. 두 메서드는 같은 서비스를 내보내지만, 옵션 값을 준비하는 방식만 다르게 두어 소비자 설정 방식의 차이를 흡수합니다.

```ts
@Module({})
export class FeatureFlagsModule {
  static forRoot(options: FeatureFlagsOptions): DynamicModule {
    return {
      module: FeatureFlagsModule,
      providers: [
        { provide: FEATURE_FLAGS_OPTIONS, useValue: options },
        FeatureFlagsService,
      ],
      exports: [FeatureFlagsService],
    };
  }

  static forRootAsync(options: AsyncModuleOptions<FeatureFlagsOptions>): DynamicModule {
    return {
      module: FeatureFlagsModule,
      imports: options.imports || [],
      providers: [
        {
          provide: FEATURE_FLAGS_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        FeatureFlagsService,
      ],
      exports: [FeatureFlagsService],
    };
  }
}
```

## Best Practices for Library Design

### Minimize Core Dependencies

패키지는 가능하면 `@fluojs/core`에만 의존해야 합니다. 플랫폼 어댑터를 직접 작성하는 경우가 아니라면 `@fluojs/platform-*`을 가져오지 마세요. 그래야 라이브러리가 Node.js, Bun, Cloudflare Workers 전반에서 플랫폼 독립성을 유지할 수 있습니다.

### Explicit Token Naming

설정을 위한 주입 토큰을 정의할 때는 다른 라이브러리와의 충돌을 피하기 위해 명확하고 고유한 명명 규칙을 사용하세요. `Symbol.for('@fluojs/feature-flags:options')` 패턴을 권장합니다. 이 패턴은 전역 심볼 레지스트리 안에서 심볼을 고유하게 유지하면서도 설명적인 이름을 남깁니다.

### Normalization of Metadata

fluo 런타임은 누락된 메타데이터 필드(예: 생략된 경우 `exports: []`)를 정규화합니다. 다만 라이브러리 저자는 이를 명시적으로 작성하는 편이 좋습니다. 가독성이 좋아지고 **fluo Studio** 같은 도구가 모듈 그래프를 올바르게 시각화하는 데 도움이 됩니다. 명확한 `exports` 배열은 모듈의 "공개 표면(public surface)"을 전달하는 가장 직접적인 방법입니다.

### Handling Circular Dependencies

복잡한 생태계에서는 모듈 간 순환 의존성이 생길 수 있습니다. DI 컨테이너가 이런 사이클을 지연 해석할 수 있도록 `imports`와 `inject` 배열 모두에서 `forwardRef()`를 사용하세요. 두 모듈이 엄격한 캡슐화를 유지하면서 프로바이더를 공유해야 할 때 자주 필요한 패턴입니다. 다만 순환을 숨기는 도구로만 쓰기보다, 공통 책임을 별도 모듈로 분리할 수 있는지도 함께 검토해야 합니다.

## Conclusion

fluo를 위한 커스텀 패키지를 만든다는 것은 모듈 시스템이 정의한 경계를 존중한다는 뜻입니다. `@fluojs/core` 및 `@fluojs/di`에서 쓰는 패턴을 따르고 `forRootAsync` 패턴을 구현하면, 라이브러리가 fluo 애플리케이션의 모듈 그래프와 자연스럽게 맞물립니다.

다음이자 마지막 장에서는 공식 기여 가이드와 행동 계약 정책에 따라 이러한 패키지와 개선 사항을 fluo 코어 레포지토리 자체에 다시 기여하는 방법을 살펴보겠습니다.
