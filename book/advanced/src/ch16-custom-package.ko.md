<!-- packages: @fluojs/core, @fluojs/di, @fluojs/runtime -->
<!-- project-state: advanced -->
# Chapter 16. Creating Custom Packages

고수를 위한 여정의 마지막 파트에서, 우리는 단순히 fluo의 소비자를 넘어 생태계 기여자의 역할을 수행하게 됩니다. fluo는 정밀하게 설계된 모듈들의 집합으로 구성되어 있으며, 그 아키텍처는 의도적으로 "확장에 열려 있도록" 설계되었습니다. 조직 내에서 사용할 내부 라이브러리를 구축하든, 커뮤니티를 위한 공개 플러그인을 만들든, fluo 호환 패키지를 구조화하고 설계하는 방법을 이해하는 것은 필수적입니다.

이 장에서는 fluo 모노레포의 내부 패키지 구조를 분석하고, `DynamicModule`의 설계 패턴을 탐구하며, 실전 예제인 기능 플래그(feature-flags) 미니 패키지를 통해 견고하고 표준 중심적인 패키지를 구축하는 방법을 살펴봅니다.

## Monorepo Package Structure

fluo 모노레포는 높은 응집도와 낮은 결합도를 보장하는 엄격한 조직 패턴을 따릅니다. 모든 공식 패키지는 예측 가능한 레이아웃을 따르며, 여러분의 커스텀 패키지에서도 이를 모방하는 것이 좋습니다.

### Public Surface and Internal Seams

fluo에서 가시성(visibility)은 일급 시민입니다. 패키지는 일반적으로 `package.json`의 `exports` 필드에 정의된 특정 엔트리 포인트 세트를 통해 기능을 노출합니다.

```json
{
  "name": "@fluojs/my-package",
  "exports": {
    ".": "./dist/index.js",
    "./internal": "./dist/internal/index.js"
  }
}
```

1. **`index.ts` (공개 루트)**: 이 파일에는 공개 API, 데코레이터 및 타입의 재노출(re-export)만 포함되어야 합니다. 이는 패키지의 "정문" 역할을 합니다.
2. **`module.ts`**: 종종 `Module` 정의를 여기에 격리합니다. 이를 통해 소비자는 단순히 타입이나 유틸리티만 필요한 경우 프레임워크 전용 메타데이터를 가져오지 않고도 로직을 임포트할 수 있습니다.
3. **`internal/`**: 이 디렉토리에는 공개 계약의 일부가 아닌 구현 세부 사항이 포함됩니다. 이를 분리함으로써 사용자에게 이 API들이 유의적 버전(semver) 경고 없이 변경될 수 있음을 알립니다.

### Dependency Declaration

fluo 패키지는 일반적으로 세 가지 핵심 기둥에 의존합니다.
- `@fluojs/core`: 메타데이터 중추(`@Module`, `@Global`, `@Inject`)를 제공합니다.
- `@fluojs/di`: 토큰 기반 컨테이너와 프로바이더 모델을 제공합니다.
- `@fluojs/runtime`: 수동 부트스트랩이나 그래프 조작을 수행하는 경우에만 필요합니다.

라이브러리를 구축할 때, 사용자의 의존성 그래프에서 버전 충돌을 피하기 위해 항상 `@fluojs/core`와 `@fluojs/di`를 `peerDependencies`로 설정하는 것이 좋습니다.

## Designing DynamicModules

`DynamicModule` 패턴은 fluo에서 설정 가능한 기능을 제공하는 주요 방법입니다. 컴파일 타임에 정의되는 정적 모듈과 달리, 동적 모듈은 런타임에 생성되며 종종 설정 객체를 수락합니다.

### The DynamicModule Contract

`DynamicModule`은 `ModuleMetadata` 인터페이스와 `module` 참조를 만족하는 객체(또는 객체를 반환하는 정적 메서드가 있는 클래스)입니다.

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

커뮤니티 표준을 따라, fluo 라이브러리는 정적 설정을 위해 `forRoot`를 사용하고, 다른 프로바이더(예: `ConfigService`)에 의존하는 설정을 위해 `forRootAsync`를 사용합니다.

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
   이는 사용자가 팩토리 함수와 `inject` 배열을 제공할 수 있도록 하는 `AsyncModuleOptions`가 필요합니다.

## The exports Field and Visibility Contract

fluo에서 `@Module`의 `exports` 필드는 단순히 힌트가 아니라 엄격하게 준수되는 계약입니다. 부트스트랩 단계의 `ModuleGraph`는 다른 모듈이 내보낸 토큰에만 액세스할 수 있는지 검증합니다.

### Visibility Rules

1. **로컬 가시성**: 모든 프로바이더는 정의된 모듈 내에서 가시적입니다.
2. **내보낸 가시성**: 프로바이더는 정의 모듈을 `import`하는 모듈에 대해서만 `exports` 배열에 나열된 경우에 가시적입니다.
3. **재노출 (Re-exports)**: 모듈은 다른 모듈을 다시 내보낼 수 있습니다. 이를 통해 임포트된 모듈의 내보내기 항목을 "프록시" 모듈을 임포트하는 누구에게나 사용 가능하게 만듭니다.
4. **전역 모듈**: `@Global()` 데코레이터가 지정된 모듈은 명시적인 임포트가 필요 없지만, 그 프로바이더들이 가시적이려면 여전히 내보내기(export)가 필요합니다.

## Practical Example: Feature-Flags Mini-Package

이러한 개념을 시연하기 위해 간단한 기능 플래그 패키지를 구축해 보겠습니다. 이 패키지는 설정에 따라 기능을 켜고 끌 수 있게 해줍니다.

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
export const FEATURE_FLAGS_OPTIONS = Symbol('FEATURE_FLAGS_OPTIONS');
```

### 3. The Service

서비스는 모듈에서 제공하는 옵션을 소비합니다.

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

여기가 `forRoot` 및 `forRootAsync` 로직을 구현하는 곳입니다.

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

여러분의 패키지는 이상적으로 `@fluojs/core`에만 의존해야 합니다. 플랫폼 어댑터를 직접 작성하는 경우가 아니라면 `@fluojs/platform-*`을 가져오지 마세요. 이는 라이브러리가 Node.js, Bun, Workers 전반에서 이식성을 유지하도록 도와줍니다.

### Explicit Token Naming

설정을 위한 주입 토큰을 정의할 때, 다른 라이브러리와의 충돌을 피하기 위해 명확하고 고유한 명명 규칙을 사용하세요. `Symbol.for('@fluojs/feature-flags:options')`와 같은 패턴이 좋습니다.

### Normalization of Metadata

fluo 런타임은 누락된 메타데이터 필드(예: 생략된 경우 `exports: []`)를 정규화합니다. 그러나 라이브러리 저자로서 이를 명시적으로 작성하는 것은 가독성을 높이고 fluo Studio와 같은 도구가 모듈 그래프를 올바르게 시각화하는 데 도움이 됩니다.

### Handling Circular Dependencies

복잡한 생태계에서는 모듈 간 순환 의존성이 발생할 수 있습니다. DI 컨테이너가 이러한 사이클을 우아하게 해결할 수 있도록 `imports`와 `inject` 배열 모두에서 `forwardRef()`를 사용하세요.

## Conclusion

fluo를 위한 커스텀 패키지를 만드는 것은 모듈 시스템에 의해 정의된 경계를 존중하는 것입니다. `@fluojs/core` 및 `@fluojs/di`에서 발견되는 패턴을 따르고 `forRootAsync` 패턴을 구현함으로써, 여러분의 라이브러리가 모든 fluo 애플리케이션에 완벽하게 통합되도록 보장할 수 있습니다.

다음이자 마지막 장에서는 이러한 패키지와 개선 사항을 fluo 코어 레포지토리 자체에 다시 기여하는 방법을 살펴보겠습니다.

---
<!-- lines: 212 -->

















































































