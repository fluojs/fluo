<!-- packages: @fluojs/core -->
<!-- project-state: T14 REPAIR: Standard-first analysis depth expansion (200+ lines) -->

# 3. Custom Decorators

## 3.1 Crafting your own decorators
프레임워크의 힘은 확장성에서 나오며, Fluo에서 이러한 확장성은 주로 커스텀 데코레이터를 통해 달성됩니다. Fluo는 TC39 표준을 기반으로 구축되었기 때문에, 커스텀 데코레이터를 만드는 것은 `StandardDecoratorFn`을 반환하는 함수를 정의하는 것만큼이나 간단합니다. 이러한 일관성 덕분에 사용자의 커스텀 로직은 Fluo의 내장 데코레이터와 완벽하게 통합되며, 동일한 성능 특성과 타입 안전성 보장을 누릴 수 있습니다.

레거시 데코레이터와 달리, 표준 데코레이터는 단순히 대상을 전달받는 함수가 아니라 매우 구조화된 트랜스포머입니다. 예를 들어 클래스에 대한 표준 데코레이터는 `(value: Function, context: ClassDecoratorContext) => void | Function` 시그니처를 가집니다. 이러한 구조를 통해 클래스를 관찰하는 것뿐만 아니라 클래스를 완전히 대체하거나 클래스가 정의될 때 실행되는 초기화 루틴을 등록할 수 있습니다.

이러한 형식화된 구조는 레거시 데코레이터와 관련된 추측(guesswork)을 제거합니다. TC39 사양이 명확하고 예측 가능한 평가 순서를 정의하고 있으므로, 더 이상 서로 다른 요소에 데코레이터가 적용되는 순서에 대해 걱정할 필요가 없습니다. 커스텀 데코레이터 작성자에게 이는 복잡한 조합으로 사용될 때도 변환이 더 신뢰할 수 있고 추론하기 쉽다는 것을 의미합니다.

표준 접근 방식의 또 다른 장점은 `context.addInitializer` 메서드입니다. 이를 통해 커스텀 데코레이터는 클래스당 또는 인스턴스당 정확히 한 번 실행되는 설정 작업(예: 중앙 레지스트리에 클래스 등록 또는 데이터베이스 연결 설정)을 수행할 수 있습니다. 이는 레거시 데코레이터 구현에서 종종 요구되던 전역 상태 관리보다 더 깔끔하고 통합된 대안을 제공합니다.

## 3.2 Metadata-driven custom logic
커스텀 데코레이터의 핵심 유용성은 종종 가드, 인터셉터 또는 커스텀 프로바이더에 의해 나중에 소비될 메타데이터를 기록하는 능력에 있습니다. Fluo의 내부 메타데이터 헬퍼를 사용하면 클래스, 메서드 또는 속성에 특정 구성 페이로드를 첨부하는 데코레이터를 만들 수 있습니다. 이러한 메타데이터 중심 접근 방식은 비즈니스 로직을 깔끔하고 선언적으로 유지하며, 인프라적 관심사를 전문화된 프레임워크 훅으로 이동시킵니다.

Fluo의 메타데이터 시스템은 커스텀 데코레이터가 접근할 수 있도록 설계되었습니다. (TC39 메타데이터 가방에 매핑되는) `context.metadata` 객체와 상호작용함으로써 자신만의 프라이빗 심볼을 사용하여 데이터를 저장할 수 있습니다. 이를 통해 사용자의 커스텀 메타데이터는 동일한 클래스나 메서드에 첨부되더라도 프레임워크의 내부 메타데이터와 충돌하지 않도록 보장됩니다.

이러한 격리는 확장 가능하고 모듈화된 생태계를 구축하는 데 핵심입니다. Fluo에서 우리는 "도메인 특화" 메타데이터의 사용을 권장합니다. 예를 들어, Fluo를 위한 캐싱 라이브러리를 구축하는 경우 `CACHE_METADATA_KEY` 심볼 아래에 구성을 저장하는 `@Cacheable()` 데코레이터를 만들 수 있습니다. 이를 통해 라이브러리는 동일한 통합 메타데이터 모델에 참여하면서도 프레임워크 코어의 DI나 라우팅 로직과는 독립적으로 작동할 수 있습니다.

메타데이터 중심 로직은 또한 테스트 가능성을 향상시킵니다. 복잡한 내부 상태를 모킹(mocking)하는 대신, 클래스나 메서드에 첨부된 메타데이터를 검사하는 것만으로 데코레이터가 올바르게 적용되었는지 간단히 확인할 수 있습니다. Fluo는 단위 및 통합 테스트 중에 이 메타데이터를 읽고 검증하는 데 도움이 되는 내부 유틸리티(`@fluojs/core/internal`을 통해 사용 가능)를 제공합니다.

## 3.3 Implementation: @CurrentUser()
`@CurrentUser()` 데코레이터는 컨트롤러 로직을 간소화하는 데 사용되는 파라미터 데코레이터의 전형적인 예입니다. HTTP 요청 컨텍스트에서 어떤 파라미터가 인증된 사용자 객체를 전달받아야 하는지를 식별합니다.
```ts
// @CurrentUser()의 개념적 구현
export function CurrentUser(): StandardParameterDecoratorFn {
  return (value, context) => {
    // 표준 파라미터 데코레이터는 아직 메서드 컨텍스트에 직접 접근하기 어렵기 때문에
    // Fluo의 내부 주입 메타데이터 저장소를 사용합니다.
    defineInjectionMetadata(context, {
      source: 'request',
      key: 'user',
      index: context.index
    });
  };
}
```
런타임에 Fluo의 HTTP 파이프라인은 이 메타데이터를 읽습니다. 컨트롤러 메서드가 호출되기 직전에 프레임워크는 현재 요청 컨텍스트에서 "user" 객체를 찾아 지정된 인덱스의 인자 리스트에 주입합니다. 이 패턴은 모든 컨트롤러 메서드에서 수동으로 사용자를 추출할 필요를 없애주어, 훨씬 더 깔끔하고 테스트 가능한 코드로 이어집니다.

더 발전된 구현에서 `@CurrentUser()`는 선택적 검증이나 필터링도 지원할 수 있습니다. 예를 들어 데코레이터에 옵션을 전달하여 사용자 객체의 특정 속성만 주입하도록 지정하거나, 주입 전에 사용자 객체에 특정 검증 규칙을 적용하도록 할 수 있습니다. 이러한 유연성은 파라미터 데코레이터를 Fluo 도구함에서 매우 강력한 도구로 만들어줍니다.

또한, Fluo의 주입 시스템은 표준 기반이므로 `@CurrentUser()`는 다양한 HTTP 어댑터(Node.js, Bun, Cloudflare Workers)에서 원활하게 작동합니다. 어댑터가 요청 컨텍스트를 올바르게 채우는 한, 데코레이터는 사용자 객체를 찾아 올바르게 주입할 것이며 프레임워크의 "한 번 작성하여 어디서나 실행(Write Once, Run Anywhere)" 약속을 지켜줍니다.

## 3.4 Implementation: @Roles()
`@Roles()` 데코레이터는 일반적으로 권한 부여(authorization)에 사용됩니다. 개발자가 특정 엔드포인트에 액세스할 수 있는 사용자 역할을 지정할 수 있게 해줍니다.
```ts
// @Roles()의 개념적 구현
const ROLES_KEY = Symbol('roles');

export function Roles(...roles: string[]): StandardMethodDecoratorFn {
  return (value, context) => {
    // 메서드의 메타데이터 가방에 필요한 역할들을 저장
    // TC39에서 context.metadata는 클래스를 위한 공유 가방입니다.
    context.metadata[ROLES_KEY] = roles;
  };
}
```
이후 가드에서 메타데이터로부터 `ROLES_KEY`를 읽을 수 있습니다. 메타데이터가 메서드의 메타데이터 가방과 연결되어 있기 때문에, 가드는 고성능 조회를 수행하여 (요청에서 가져온) 현재 사용자가 진행에 필요한 역할을 보유하고 있는지 결정할 수 있습니다.

`@Roles()`의 아름다움은 단순함에 있습니다. 권한 부여 요구 사항을 한 줄의 설명적인 코드로 캡슐화합니다. 이는 애플리케이션의 보안 정책이 소스 코드 수준에서 직접 가시화되고 감사 가능하도록 만듭니다. 또한 변경이 용이합니다. 엔드포인트에서 역할을 추가하거나 제거하는 것은 데코레이터 인자를 업데이트하는 것만큼이나 간단합니다.

더 복잡한 시나리오에서는 계층적 역할이나 동적 역할 체크를 지원하고 싶을 수 있습니다. `@Roles()`는 단지 메타데이터를 저장할 뿐이므로 권한 부여 가드에서 필요한 모든 로직을 구현할 수 있습니다. 데이터베이스를 확인하거나, 외부 인증 프로바이더를 참고하거나, 필요한 역할들에 대해 복잡한 논리 연산(AND/OR)을 수행할 수 있습니다. 데코레이터는 "무엇(what)"을 제공하고, 프레임워크의 런타임은 "어떻게(how)"를 제공합니다.

## 3.5 Implementation: @ApiDoc()
문서화는 Fluo에서 일급 시민입니다. `@ApiDoc()` 데코레이터는 핵심 로직을 오염시키지 않으면서도 HTTP 엔드포인트에 설명적인 메타데이터를 풍부하게 추가할 수 있게 해줍니다.
```ts
// @ApiDoc()의 개념적 구현
export function ApiDoc(options: ApiDocOptions): StandardMethodDecoratorFn {
  return (value, context) => {
    // 문서 생성기에서 사용할 OpenAPI 스키마 조각을 기록
    // 이는 종종 새 옵션을 기존 메타데이터와 병합하는 과정을 포함합니다.
    const existing = context.metadata[API_DOC_KEY] || {};
    context.metadata[API_DOC_KEY] = { ...existing, ...options };
  };
}
```
이 메타데이터는 이후 `@fluojs/openapi` 패키지에 의해 수집되어, 코드와 완벽하게 동기화된 포괄적이고 인터랙티브한 API 문서(예: Swagger)를 생성하는 데 사용됩니다. 문서 메타데이터를 엔드포인트 정의와 가깝게 유지함으로써 Fluo는 API의 모든 변경 사항이 생성된 문서에 즉각적으로 반영되도록 보장합니다.

`@ApiDoc()`은 응답 타입, 요청 스키마, 그리고 보안 요구 사항을 정의하는 데에도 사용될 수 있습니다. 이는 모든 OpenAPI 관련 구성의 중앙 허브가 됩니다. 표준 데코레이터를 사용하기 때문에 문서 생성 프로세스가 빠르고 신뢰할 수 있으며, 레거시 OpenAPI 라이브러리들이 사용하는 느리고 종종 버그가 많은 리플렉션 방식을 피할 수 있습니다.

대규모 프로젝트에서 `@ApiDoc()`은 더 세분화될 수 있습니다. 특정 유형의 작업에 대한 공통 문서화 패턴을 캡슐화하는 `@GetUsersDoc()` 또는 `@CreateUserDoc()` 데코레이터를 만들 수 있습니다. 이는 보일러플레이트를 더욱 줄여주고 모든 엔드포인트가 일관된 문서화 스타일을 따르도록 보장하여, API 표면의 전반적인 품질을 향상시킵니다.

## 3.6 Advanced decorator composition
애플리케이션이 커짐에 따라 동일한 4~5개의 데코레이터를 여러 메서드에 반복적으로 적용하게 될 수 있습니다. Fluo는 데코레이터 합성을 지원하여, 여러 데코레이터를 하나의 응집력 있는 단위로 묶을 수 있게 합니다.
```ts
export function Auth(roles: string[]) {
  // applyDecorators 유틸리티는 실행 순서와 컨텍스트 전달을 처리합니다.
  return applyDecorators(
    Roles(...roles),
    ApiDoc({ security: [{ bearerAuth: [] }] }),
    UseGuards(JwtAuthGuard, RolesGuard)
  );
}
```
(`@fluojs/core`에서 제공하는) `applyDecorators` 유틸리티는 각 데코레이터가 표준 JavaScript 의미론을 따라 올바른 순서로 실행되도록 보장합니다. 이러한 관행은 보일러플레이트를 줄이고 서비스 전체에서 횡단 관심사(cross-cutting concerns)가 일관되게 적용되도록 합니다.

더 나아가, 합성을 통해 인자에 따라 유동적으로 적응하는 "스마트 데코레이터"를 만들 수도 있습니다. 예를 들어 Fluo의 단일 `@Controller()` 데코레이터는 실제로는 라우트 프리픽싱, 의존성 주입 등록, 메타데이터 초기화를 한 번에 처리하는 합성체입니다. 이러한 프리미티브들을 합성하는 방법을 이해하는 것이 Fluo의 고급 아키텍처 패턴을 마스터하는 열쇠입니다.

합성은 또한 "프레임워크 키트(Framework Kits)"의 생성을 촉진합니다. 일련의 합성된 데코레이터들을 라이브러리로 패키징하여 특정 도메인(예: `@fluojs/crud` 또는 `@fluojs/microservices`)을 위한 고수준 API를 제공할 수 있습니다. 이를 통해 다른 개발자들은 데코레이터가 어떻게 구현되었는지에 대한 저수준 세부 정보를 이해하지 않고도 여러분의 아키텍처적 선택과 패턴을 활용할 수 있습니다.

마지막으로, 합성은 단지 묶는 것이 아님을 기억하십시오. 이는 애플리케이션의 동작을 설명하기 위한 더 높은 수준의 언어를 만드는 것에 관한 것입니다. 데코레이터들을 신중하게 선택하고 합성함으로써 코드를 더 표현력 있게 만들고, 유지보수하기 쉽게 만들며, 궁극적으로 함께 작업하기 더 즐거운 DSL(Domain Specific Language)을 구축할 수 있습니다.

## 3.7 Debugging Custom Decorators
커스텀 데코레이터는 클래스 평가 단계에서 실행되기 때문에 디버깅이 다소 까다로울 수 있습니다. 이를 돕기 위해 `context.addInitializer` 훅을 사용하여 생명주기의 특정 시점에 정보를 로깅할 수 있습니다.

```ts
export function Debug(tag: string): StandardClassDecoratorFn {
  return (value, context) => {
    console.log(`[Debug] Decorating ${context.name} with tag: ${tag}`);
    context.addInitializer(() => {
      console.log(`[Debug] Initializing ${context.name}`);
    });
  };
}
```

이 간단한 데코레이터는 변환이 언제 적용되고 클래스가 언제 초기화되는지에 대한 창을 제공합니다. 또한 Fluo의 내부 메타데이터 리더를 사용하여 커스텀 메타데이터가 올바르게 기록되고 있는지 확인할 수 있습니다. Fluo는 표준 데코레이터를 사용하므로 데코레이터 함수 내부에서 직접 `debugger` 문과 같은 표준 JavaScript 디버깅 도구를 사용할 수도 있습니다.

## 3.8 Best Practices for Custom Decorators
Fluo를 위한 커스텀 데코레이터를 구축할 때는 다음의 모범 사례를 염두에 두십시오.

1. **명시성(Be Explicit)**: 데코레이터와 메타데이터 키에 대해 명확하고 설명적인 이름을 사용하십시오. 이는 코드를 읽고 유지보수하기 쉽게 만듭니다.
2. **심볼 사용(Use Symbols)**: 다른 라이브러리나 코어 프레임워크와의 충돌을 피하기 위해 항상 커스텀 메타데이터 키에 프라이빗 심볼을 사용하십시오.
3. **가볍게 유지(Keep it Lean)**: 데코레이터 함수 내부에서 무거운 계산을 수행하지 마십시오. 대신 필요한 메타데이터를 기록하고 로직은 런타임 중에 수행하십시오.
4. **타입 지정(Type Your Decorators)**: 데코레이터 함수와 그 인자에 대해 강력한 타입을 제공하십시오. 이는 데코레이터가 올바르게 사용되도록 보장하고 더 나은 개발자 경험을 제공합니다.
5. **상속 처리(Handle Inheritance)**: 클래스 상속 중에 커스텀 메타데이터가 어떻게 동작해야 하는지 생각하십시오. 누적되어야 할까요, 덮어써야 할까요, 아니면 무시되어야 할까요?

이러한 모범 사례를 따름으로써 견고하고 고성능이며 사용하기 쉬운 커스텀 데코레이터를 만들 수 있습니다. 이는 여러분의 코드 품질을 향상시킬 뿐만 아니라 Fluo 생태계의 전반적인 건강성과 확장성에도 기여합니다.

## 3.9 Summary: Mastering Extensibility
- **표준 시그니처**: 최대의 호환성과 타입 안전성을 위해 항상 TC39 `(value, context)` 시그니처를 따르십시오.
- **메타데이터 저장**: 클래스 수준 구성에는 `context.metadata`를 사용하고, 파라미터/속성 주입에는 Fluo의 내부 저장소를 사용하십시오.
- **실전 패턴**: `@CurrentUser()`, `@Roles()`, `@ApiDoc()`과 같은 일반적인 패턴을 활용하여 깔끔하고 선언적인 API를 구축하십시오.
- **합성**: `applyDecorators`를 사용하여 강력하고 재사용 가능한 추상화를 만들고 보일러플레이트를 줄이십시오.
- **검증**: 내부 메타데이터 리더와 디버깅 훅을 사용하여 커스텀 로직이 의도한 대로 작동하는지 확인하십시오.

커스텀 데코레이터를 마스터하는 것은 Fluo 전문가가 되기 위한 첫 번째 단계입니다. 기본 프리미티브를 이해하고 프레임워크의 아키텍처 원칙을 따름으로써, 코어 프레임워크만큼이나 강력하고 신뢰할 수 있는 확장을 구축할 수 있습니다.

## 3.10 Case Study: Building a Custom @Loggable() Decorator
이 모든 개념들을 하나로 모아, 메서드 실행 시간과 인자를 자동으로 로깅하는 `@Loggable()` 데코레이터를 구축하는 방법을 살펴보겠습니다. 이 데코레이터는 표준 메서드 데코레이터 시그니처를 사용하고 설정을 수행하기 위해 `context.addInitializer`를 활용할 것입니다.

```ts
export function Loggable(options: LogOptions = {}): StandardMethodDecoratorFn {
  return (originalMethod, context) => {
    const methodName = String(context.name);
    
    // 메서드가 데코레이트되었음을 로깅하기 위해 addInitializer 사용
    context.addInitializer(() => {
      if (options.verbose) {
        console.log(`[Loggable] Method ${methodName} is ready for telemetry`);
      }
    });

    // 원본을 로깅 로직으로 래핑하는 대체 메서드를 반환
    return function (this: any, ...args: any[]) {
      const start = performance.now();
      try {
        const result = originalMethod.apply(this, args);
        // 동기 및 비동기 결과 모두 처리
        if (result instanceof Promise) {
          return result.finally(() => {
            const end = performance.now();
            console.log(`[Loggable] ${methodName} took ${(end - start).toFixed(2)}ms (async)`);
          });
        }
        const end = performance.now();
        console.log(`[Loggable] ${methodName} took ${(end - start).toFixed(2)}ms (sync)`);
        return result;
      } catch (error) {
        const end = performance.now();
        console.error(`[Loggable] ${methodName} failed after ${(end - start).toFixed(2)}ms`);
        throw error;
      }
    };
  };
}
```

이 구현은 표준 데코레이터의 몇 가지 주요 기능을 보여줍니다.
1. **대체 값(Replacement Value)**: 데코레이터는 원본을 래핑하는 새 함수를 반환합니다.
2. **컨텍스트 정보**: 데코레이트된 메서드를 식별하기 위해 `context.name`을 사용합니다.
3. **초기화 로직**: 일회성 설정 작업을 위해 `addInitializer`를 사용합니다.
4. **성능 효율성**: 요청당이 아니라 클래스 정의 중에 래퍼를 한 번만 생성합니다.

이 패턴을 따름으로써, Fluo 프레임워크의 깔끔하고 선언적인 스타일을 유지하면서 애플리케이션 로직과 깊게 통합되는 강력한 횡단 관심사(cross-cutting) 데코레이터를 구축할 수 있습니다.

## 3.11 Looking Ahead: The Future of Custom Decorators
TC39 데코레이터 제안이 계속 발전하고 더 널리 채택됨에 따라, 사양에 훨씬 더 강력한 기능들이 추가될 것으로 기대합니다. 여기에는 추가적인 요소들에 대한 데코레이팅 지원, 더 정교한 메타데이터 API, 그리고 JavaScript 엔진에서의 훨씬 더 나은 성능 최적화가 포함될 수 있습니다.

표준에 대한 Fluo의 약속은 우리의 커스텀 데코레이터 모델이 언어와 함께 계속 진화할 것임을 의미합니다. 우리는 데코레이터 사양에 관한 논의에 적극적으로 참여하고 있으며 항상 사용자들에게 최신의 발전을 제공할 방법을 찾고 있습니다. `context` 객체의 새로운 훅을 통해서든 네이티브 메타데이터 가방과의 더 나은 통합을 통해서든, 우리는 TypeScript 세계에서 가장 앞서가고 미래에 대비된 데코레이터 생태계를 제공하기 위해 최선을 다하고 있습니다.

## 3.12 Final Thoughts on Part 1
이 고급 책의 첫 번째 부분에서 많은 내용을 다루었습니다. 데코레이터의 역사부터 메타데이터 시스템의 깊은 내부 구조, 그리고 커스텀 확장 작성 기술에 이르기까지, 이제 Fluo를 구동하는 기초 기술들에 대해 탄탄한 이해를 갖게 되었습니다. 이러한 개념들은 단지 이론적인 것이 아니라, 모든 고성능 Fluo 애플리케이션의 빌딩 블록입니다.

Part 2에서는 선언적 구성 레이어를 벗어나 프레임워크의 심장부인 의존성 주입(Dependency Injection) 컨테이너로 이동할 것입니다. 우리가 논의한 메타데이터가 어떻게 실제 인스턴스로 해결되는지, 서로 다른 프로바이더 스코프가 어떻게 관리되는지, 그리고 프레임워크가 순환 의존성과 동적 모듈 구성의 복잡성을 어떻게 처리하는지 살펴볼 것입니다.

데코레이터와 메타데이터를 마스터하는 것은 Fluo의 잠재력을 완전히 끌어내는 열쇠입니다. 표준 우선 접근 방식을 받아들이고 아키텍처 선택 뒤에 숨겨진 "이유"를 이해함으로써, 이제 정교하고 확장 가능하며 미래에 대비된 백엔드 애플리케이션을 구축할 준비가 되었습니다. Part 2에서 뵙겠습니다!

마지막으로 소스에 근거한 관찰 하나가 이 챕터를 마무리해 줍니다.
Fluo의 실제 패키지 생태계는 이 챕터가 권장한 커스텀 데코레이터 스타일을 이미
직접 보여주고 있습니다.

- `path:packages/http/src/decorators.ts:181-188`의 `@Controller()`는 레거시 descriptor 없이 컨트롤러 메타데이터에 기록합니다.
- `path:packages/http/src/decorators.ts:197-205`의 `@Version()`은 `context.kind`를 기준으로 class/method 범위를 나눕니다.
- `path:packages/http/src/decorators.ts:414-426`의 `@UseGuards()`는 메타데이터를 무조건 덮어쓰지 않고 병합합니다.
- `path:packages/openapi/src/decorators.ts:259-345`의 OpenAPI 데코레이터들은 `context.name`을 키로 쓰는 method-scoped `Map`을 구축합니다.
- `path:packages/openapi/src/decorators.ts:477-503`은 응답 메타데이터 누적이 리플렉션 마법이 아니라 평범한 bag 조작임을 보여줍니다.

즉 고급 패턴의 핵심은 이것입니다.
Fluo에서 잘 설계된 커스텀 데코레이터는 크고 복잡한 실행기가 아니라,
작고 조합 가능한 메타데이터 writer입니다.
진짜 런타임의 힘은 나중에 다른 패키지들이 그 레코드를 읽고
HTTP 동작, 문서화, DI 정책으로 변환할 때 나타납니다.
