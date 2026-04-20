<!-- packages: @fluojs/core -->
<!-- project-state: T14 REPAIR: Standard-first analysis depth expansion (200+ lines) -->

# 2. Metadata System and Reflect

## 2.1 The role of Reflect API
표준 JavaScript 세계에서 `Reflect` API는 객체에 대한 저수준 연산을 가로채고 수행하기 위한 정적 메서드들의 집합입니다. `Reflect.get`, `Reflect.set`, `Reflect.apply`와 같은 메서드들을 제공하지만, 데코레이터 맥락에서 가장 중요한 역할은 메타데이터를 관리하는 표준화된 방법을 촉진하는 것입니다. Fluo에서 `Reflect`는 레거시 프레임워크에서 볼 수 있는 무거운 "마법 같은" 리플렉션을 위해 사용되는 것이 아니라, 클래스 수준의 메타데이터 가방(bag) 및 내부 저장 메커니즘과 상호작용하기 위한 정밀한 도구로 사용됩니다.

`Reflect` API는 내부 언어 의미론을 따르는 속성 액세스 및 할당을 가능하게 하는 `Reflect.get` 및 `Reflect.set` 메서드를 제공하기 때문에 기본적입니다. Fluo의 메타데이터 시스템에서 이는 특히 `Symbol.metadata`와 상호작용할 때 중요하며, 메타데이터 액세스가 일관되고 대상 객체에 대한 의도하지 않은 게터 실행과 같은 부수 효과를 트리거하지 않도록 보장합니다.

레거시 `reflect-metadata` 폴리필에서 사용되는 전역 `Reflect.defineMetadata`와 달리, Fluo는 지역화된 메타데이터 저장소를 우선시합니다. 우리는 주로 대상 객체 자체와 상호작용하기 위한 표준화된 인터페이스로 `Reflect`를 사용합니다. 이는 전역 레지스트리의 부담 없이 객체의 구조와 상태를 들여다보기 위해 API를 사용하는 "인트로스펙션으로서의 Reflect(Reflect-as-Introspection)" 패턴과 일치합니다.

프레임워크 개발의 고급 단계에서는 `Reflect.construct` 및 `Reflect.apply` 또한 DI 컨테이너에서 중요한 역할을 합니다. 이를 통해 Fluo는 올바른 `this` 컨텍스트를 유지하고 대상의 내부 슬롯을 존중하면서 클래스를 인스턴스화하고 메서드를 호출할 수 있습니다. 표준 JavaScript 내부와의 이러한 깊은 통합은 Fluo가 다양한 환경에서 우수한 성능과 예측 가능한 동작을 가질 수 있게 하는 원동력입니다.

## 2.2 Symbolic metadata: The modern approach
현대적인 메타데이터 접근 방식은 이름 충돌을 일으킬 수 있는 문자열 기반 키를 피합니다. Fluo는 클래스 생성자에 직접 메타데이터 가방을 연결하기 위한 표준 제안인 `Symbol.metadata`를 활용합니다. 이 가방은 프레임워크가 소유한 심볼(symbol)들을 키로 사용하는 평범한 객체입니다. 이를 통해 Fluo의 메타데이터가 다른 라이브러리나 사용자 코드로부터 격리되도록 보장합니다. `Symbol.metadata`가 네이티브로 지원되지 않는 환경을 위해, Fluo는 모든 환경에서 일관된 API를 유지할 수 있도록 폴리필을 제공합니다.

`path:packages/core/src/metadata/shared.ts:13-34`
`ensureMetadataSymbol` 함수는 `Symbol.metadata`의 폴리필 처리를 담당합니다. 문자열 키 대신 심볼을 사용함으로써 Fluo는 메타데이터 저장소가 열거 불가능(non-enumerable)하며 표준 객체 속성 열거에서 숨겨지도록 보장합니다. 이는 종종 `__metadata__`와 같은 속성으로 클래스를 오염시켰던 레거시 접근 방식에 비해 상당한 개선입니다.

심볼은 고유성이 보장되기 때문에 메타데이터의 키로서 완벽합니다. 동일한 런타임에 여러 버전의 Fluo나 여러 프레임워크가 공존하더라도, 자신만의 프라이빗 심볼을 사용하는 한 메타데이터가 충돌하지 않습니다. 이러한 "위생적인 메타데이터(hygienic metadata)" 패턴은 Fluo 설계의 핵심 원칙입니다. 이는 프레임워크의 내부 관리가 사용자의 도메인으로 유출되지 않도록 보장합니다.

또한, 심볼릭 메타데이터는 효율적인 조회를 가능하게 합니다. 심볼은 문자열이 아니기 때문에 엔진은 내부 슬롯을 사용하여 속성 액세스를 최적화할 수 있습니다. 이는 전통적인 속성 조회와 관련된 문자열 파싱 및 해시 맵 오버헤드를 피하게 해줍니다. Fluo에서는 내부 레코드를 구성하기 위해 `path:packages/core/src/metadata/shared.ts:75-84`에 정의된 것과 같은 canonical 심볼 세트(`metadataKeys.module` 또는 `metadataKeys.classDi` 등)를 사용하여, 모든 검색이 표준 속성 액세스만큼 빠르도록 보장합니다.

## 2.3 Type-safe metadata storage
메타데이터는 그 조회가 신뢰할 수 있을 때에만 유용합니다. Fluo는 모든 메타데이터 레코드(예: `ModuleMetadata`, `ClassDiMetadata`, `RouteMetadata`)에 대해 엄격한 인터페이스를 정의하여 타입 안전성을 보장합니다. 이러한 레코드들은 `WeakMap` 기반의 저장소에 저장되어, 메타데이터가 설명하는 클래스나 객체가 가비지 컬렉션될 때 함께 제거됨으로써 메모리 누수를 방지합니다. 강력한 타입의 키와 읽기/쓰기 연산 시의 방어적 복제(defensive cloning)를 사용함으로써, Fluo는 리플렉션이 과도한 시스템에서 흔히 발생하는 다양한 런타임 오류를 제거합니다.

`path:packages/core/src/metadata/store.ts:16-33`
`createClonedWeakMapStore` 유틸리티는 Fluo의 불변 메타데이터 관리의 핵심 엔진입니다. `cloneValue` 루틴을 사용함으로써 Fluo는 저장소에서 검색된 모든 메타데이터가 사본임을 보장하며, 중앙 메타데이터 레지스트리의 실수에 의한 변형을 방지합니다. 이는 프레임워크의 서로 다른 부분들이 동일한 메타데이터를 읽고 해석할 수 있는 멀티 모듈 환경에서 매우 중요합니다.

`WeakMap`의 사용은 장기 실행 프로세스에서의 성능과 메모리 관리 측면에서 특히 중요합니다. 표준 `Map`이나 전역 객체와 달리, `WeakMap`은 키(클래스 또는 객체)가 가비지 컬렉션되는 것을 방해하지 않습니다. 이는 모듈이나 컨트롤러가 동적으로 언로드될 경우 연결된 메타데이터도 엔진에 의해 자동으로 정리됨을 의미하며, Fluo의 메모리 사용량이 시간이 지나도 가볍게 유지되도록 보장합니다.

타입 안전성은 TypeScript 제네릭과 런타임 검증의 조합을 통해 달성됩니다. Fluo의 모든 메타데이터 저장소는 특정 타입과 연결되어 있으며, 우리의 내부 헬퍼(`path:packages/core/src/metadata/module.ts:60-62`의 `getModuleMetadata` 등)는 프레임워크의 나머지 부분에 강력한 타입의 API를 제공하기 위해 이 타입들을 사용합니다. 이를 통해 DI 컨테이너나 HTTP 런타임이 메타데이터를 읽을 때 정확히 어떤 형상을 기대해야 하는지 알 수 있으며, 방어적인 null 체크나 타입 캐스팅의 필요성을 줄여줍니다.

## 2.4 Reflect API examples in Fluo
Fluo는 언어의 내부 메커니즘을 존중하는 방식으로 객체와 상호작용하기 위해 `Reflect` 메서드들을 사용합니다. 주요 사례는 대상 클래스에서 메타데이터 가방을 조회하는 것입니다.
`path:packages/core/src/metadata/shared.ts:151-159`
```ts
export function getStandardMetadataBag(target: object): StandardMetadataBag | undefined {
  const metadata = Reflect.get(target, metadataSymbol);

  if (typeof metadata !== 'object' || metadata === null) {
    return undefined;
  }

  return metadata as StandardMetadataBag;
}
```
이 패턴을 통해 Fluo는 표준 데코레이터를 통해 첨부된 메타데이터를 읽을 수 있습니다. `Reflect.get(target, metadataSymbol)`을 사용함으로써 Fluo는 TC39 제안에 의해 정의된 메타데이터 가방을 명시적으로 타겟팅합니다. 이 메서드는 선언적 데코레이터 구문과 명령형 런타임 초기화 로직 사이의 간극을 메우기 위해 core 패키지에서 광범위하게 사용됩니다.

Fluo에서 `Reflect`를 사용하는 또 다른 예는 `applyDecorators` 유틸리티 내에 있습니다. 이 유틸리티는 일련의 데코레이터들을 대상에 수동으로 적용합니다. 여기서 `Reflect` 메서드들은 속성 서술자와 클래스 정의가 사양에 따라 처리되도록 보장하여, 데코레이트된 요소의 무결성을 유지하는 데 사용됩니다. 이는 메서드의 반환 값이나 속성의 서술자를 수정할 수 있는 데코레이터들을 합성할 때 특히 중요합니다.

우리는 또한 메타데이터 병합 로직에서 `Reflect.ownKeys`를 사용합니다. 이를 통해 심볼을 포함한 메타데이터 가방의 모든 키를 검색하여 깊은 병합(deep merge)과 중복 제거를 수행할 수 있습니다. `Object.keys` 대신 `Reflect.ownKeys`를 사용함으로써, Fluo 구성의 핵심을 이루는 심볼릭 메타데이터를 하나도 놓치지 않도록 보장합니다.

DI 컨테이너에서는 프로바이더를 인스턴스화하기 위해 `Reflect.construct`가 사용됩니다. 이는 대상의 생성자 로직을 존중하면서 인자 배열을 동적으로 전달할 수 있게 해주므로 `new` 연산자보다 선호됩니다. 또한 요청 범위 프로바이더(request-scoped providers)나 transient 수명 주기와 같은 기능을 지원하는 데 필수적인 "프록시된 생성자(proxied constructors)"와 같은 고급 패턴을 사용자에게 구현 세부 정보를 노출하지 않고도 가능하게 해줍니다.

## 2.5 Metadata inheritance patterns
메타데이터 관리에서 가장 복잡한 도전 중 하나는 클래스 상속을 처리하는 것입니다. 자식 클래스가 부모의 DI 토큰을 상속받아야 할까요? 라우트 가드나 검증 규칙은 어떨까요? Fluo는 메타데이터를 해결하기 위해 정교한 "계보 순회(lineage walk)"를 구현합니다. 베이스 클래스부터 시작하여 리프(leaf) 클래스로 내려오면서 메타데이터 레코드를 병합하며, 이를 통해 자식 클래스는 원본 정의를 손상시키지 않으면서 부모의 구성을 선택적으로 덮어쓰거나 확장할 수 있습니다.

`path:packages/core/src/metadata/class-di.ts:51-73`
`getInheritedClassDiMetadata` 함수는 특히 의존성 주입 메타데이터에 대해 이 로직을 보여줍니다. `Object.getPrototypeOf`를 사용하여 프로토타입 체인을 순회하고 계보의 각 생성자로부터 메타데이터를 수집합니다. 이를 통해 DI 컨테이너는 추상 베이스 클래스나 제네릭 서비스 템플릿에 정의된 토큰을 포함하여 클래스의 요구 사항에 대한 완전한 그림을 가질 수 있습니다.

이 상속 모델은 검증 규칙과 같은 것들에 대해서는 기본적으로 "누적(accumulative)"되지만, 생명주기 스코프와 같은 것들에 대해서는 "덮어쓰기(overriding)" 방식입니다. 이러한 뉘앙스는 각 메타데이터 모듈의 전문화된 병합 루틴을 통해 관리되어, 동작이 항상 개발자의 직관과 일치하도록 보장합니다. 예를 들어, 자식 클래스의 `@Scope('request')`는 부모의 `@Scope('singleton')`을 완전히 대체해야 하는 반면, 새 `@Inject` 토큰을 추가하는 자식 클래스는 이상적으로 부모의 요구 사항을 보완해야 합니다.

이러한 다양한 병합 전략을 처리하기 위해 Fluo는 `path:packages/core/src/metadata/shared.ts`에 정의된 `mergeUnique` 및 `cloneCollection`과 같은 일련의 내부 유틸리티를 사용합니다. 이 헬퍼들은 가드나 인터셉터 배열이 상대적 순서를 유지하면서 중복 제거되도록 보장합니다. 이는 실행 순서가 요청 결과에 큰 영향을 미칠 수 있는 미들웨어 파이프라인의 무결성을 유지하는 데 매우 중요합니다.

마지막으로, Fluo의 상속 로직은 "지연(lazy)" 방식으로 설계되었습니다. 우리는 시작 시 모든 클래스에 대해 상속된 메타데이터를 미리 계산하지 않습니다. 대신, 메타데이터가 처음 요청될 때 온디맨드로 계보를 해결합니다. 이를 통해 초기 부팅 시간을 빠르게 유지하고 프레임워크가 실제 애플리케이션 실행 경로에 필요한 작업만 수행하도록 보장합니다.

## 2.6 Advanced Metadata Examples: Custom Providers
Fluo가 복잡한 프로바이더 구성을 지원하기 위해 메타데이터 시스템을 어떻게 사용하는지 살펴보겠습니다. 일반적인 시나리오에서 프로바이더는 주입되는 컨텍스트에 따라 다르게 해결되어야 할 수 있습니다. 커스텀 메타데이터를 사용함으로써 Fluo는 이러한 요구 사항을 기록한 다음 DI 해결 프로세스 중에 이를 사용하여 올바른 인스턴스를 제공할 수 있습니다.

```ts
// 커스텀 프로바이더 메타데이터 기록을 위한 내부 헬퍼
function defineProviderOptions(target: Function, options: ProviderOptions) {
  const store = getOrCreatePropertyMap(customProviderStore, target);
  store.set(METADATA_OPTIONS_KEY, options);
}

// 데코레이터에서의 사용 예
export function Provider(options: ProviderOptions): StandardClassDecoratorFn {
  return (target, context) => {
    defineProviderOptions(target, options);
    defineClassDiMetadata(target, { scope: options.scope });
  };
}
```

이 예제는 Fluo의 메타데이터 프리미티브를 사용하여 고수준 프레임워크 기능을 구축하는 방법을 보여줍니다. `WeakMap` 저장소와 표준 TC39 메타데이터를 결합함으로써 유연하면서도 고성능인 시스템을 구축할 수 있습니다. 이러한 접근 방식은 개별 컴포넌트가 간섭 없이 자신의 메타데이터를 관리할 수 있게 하므로 프레임워크가 모듈식으로 유지되도록 보장합니다.

## 2.7 Debugging Metadata in Fluo
메타데이터 문제를 디버깅하는 것은 어려울 수 있지만, Fluo는 이를 돕기 위해 여러 도구를 제공합니다. `@fluojs/core/internal` 패키지에는 `getModuleMetadata` 및 `getClassDiMetadata`와 같은 헬퍼가 포함되어 있어, 코드 내에서 또는 디버깅 세션 중에 프레임워크 내부 레코드의 현재 상태를 검사할 수 있습니다.

또한, `metadataSymbol`을 사용하여 모든 클래스의 표준 TC39 메타데이터 가방을 수동으로 검사할 수 있습니다. 브라우저 콘솔이나 Node.js REPL에서 `Reflect.get(MyClass, Symbol.metadata)`를 사용하여 이 가방에 접근할 수 있습니다. 이는 Fluo의 데코레이터가 기록한 데이터에 대한 직접적인 창을 제공하여, 구성이 런타임에 의해 올바르게 해석되고 있는지 확인할 수 있게 해줍니다.

Fluo는 내부 저장소의 상당 부분에 `WeakMap`을 사용하므로 시스템의 모든 메타데이터를 "열거(enumerate)"할 수는 없다는 점을 기억하십시오. 이는 메모리 누수를 방지하고 메타데이터의 범위가 적절하게 지정되도록 보장하기 위한 의도적인 설계 선택입니다. 대신, 문제가 의심되는 특정 클래스와 객체를 검사하는 데 집중해야 합니다.

## 2.8 Summary: The Metadata Lifecycle
1. **선언(Declaration)**: 클래스 정의 중에 데코레이터가 평가되고 메타데이터를 기록합니다.
2. **기록(Recording)**: 메타데이터는 표준 `Symbol.metadata` 가방이나 내부 `WeakMap` 저장소에 저장됩니다.
3. **해결(Resolution)**: 프레임워크(DI 컨테이너, HTTP 런타임)는 필요한 시점(예: 모듈 그래프 컴파일 중)에 메타데이터를 해결합니다.
4. **실행(Execution)**: 해결된 메타데이터는 애플리케이션의 런타임 동작을 구동하는 데 사용됩니다.
5. **정리(Cleanup)**: 연결된 클래스나 객체가 더 이상 사용되지 않으면 메타데이터는 자동으로 가비지 컬렉션됩니다.

이 생명주기를 이해하는 것이 Fluo의 내부 아키텍처를 마스터하는 열쇠입니다. 표준 우선(standard-first) 접근 방식을 따름으로써 Fluo는 생명주기의 모든 단계가 효율적이고 예측 가능하며 JavaScript 언어의 미래와 일치하도록 보장합니다.

## 2.9 Deeper Dive: The Metadata Provider Registry
Fluo의 의존성 주입 컨테이너는 우리가 논의한 메타데이터 시스템을 기반으로 구축된 전문화된 프로바이더 레지스트리를 사용합니다. 이 레지스트리는 토큰과 프로바이더 기술자(descriptor) 사이의 매핑을 유지하며, 여기에는 클래스 생성자, 팩토리 함수, 그리고 필요한 주입 토큰들이 포함됩니다. 클래스 기반 프로바이더의 기본 키로 `Symbol.metadata`를 사용함으로써 Fluo는 레지스트리가 매우 효율적으로 작동하도록 보장하며 레거시 DI 구현에서 흔히 발생하는 성능 병목 현상을 피합니다.

모듈이 컴파일될 때 Fluo 런타임은 `@Module` 메타데이터에 정의된 `providers` 리스트를 순회합니다. 각 프로바이더에 대해 (`getInheritedClassDiMetadata`를 사용하여) 관련 `ClassDiMetadata`를 읽어 의존성과 수명 주기 범위를 파악합니다. 이 정보는 DI 컨테이너가 프로바이더와 그 의존성들을 올바른 순서로 인스턴스화하기 위해 실행할 수 있는 "해결 계획(resolution plan)"을 만드는 데 사용됩니다.

## 2.10 Handling Edge Cases: Dynamic Metadata
일부 고급 시나리오에서는 런타임에 동적으로 메타데이터를 첨부하거나 수정해야 할 수도 있습니다. Fluo는 선언적이고 데코레이터 기반의 구성을 우선시하지만, 우리의 메타데이터 시스템은 이러한 경우를 위해 명령형 API도 지원합니다. `defineModuleMetadata`나 `defineClassDiMetadata` 헬퍼를 사용하면 프로그래밍 방식으로 클래스와 모듈을 구성할 수 있으며, 이는 동적 플러그인이나 전문화된 테스트 환경을 구축할 때 특히 유용합니다.

하지만 이러한 명령형 API는 가급적 자제하여 사용할 것을 권장합니다. Fluo 아키텍처의 강점은 애플리케이션 구조를 이해하고 감사하기 쉽게 만드는 선언적 특성에 있습니다. 동적 메타데이터는 선언적 접근 방식이 진정으로 불가능할 때만 사용해야 하며, 그 경우에도 나중에 코드를 접할 다른 개발자들의 혼란을 피하기 위해 신중하게 문서화해야 합니다.

## 2.11 The Role of WeakRef in Future Metadata Iterations
Fluo 메타데이터 시스템의 미래를 내다보며, 우리는 메모리 효율성을 더욱 개선하기 위해 `WeakRef`와 `FinalizationRegistry`의 사용을 탐구하고 있습니다. `WeakMap`은 객체와 메타데이터를 연결하는 데 탁월하지만, `WeakRef`는 메타데이터 레코드 자체에 대해 "약한" 참조를 가질 수 있게 하여 매우 동적이거나 대규모인 애플리케이션에서 훨씬 더 세밀한 가비지 컬렉션을 가능하게 할 것입니다.

이는 `WeakRef`의 성능 특성이 JavaScript 엔진마다 크게 다를 수 있기 때문에 아직 실험 단계에 있습니다. 하지만 이는 항상 표준과 성능에 중점을 두면서 메타데이터 기반 프레임워크로 가능한 것의 한계를 밀어붙이려는 우리의 약속을 나타냅니다.

## 2.12 Summary: Master the Engine
- **Reflect API**: 저수준의 사양 준수 객체 상호작용을 위해 사용하십시오.
- **Symbol.metadata**: 클래스 수준 구성을 위한 표준 준수 저장소입니다.
- **WeakMap Stores**: 복잡한 메타데이터 모델을 위한 고성능의 메모리 안전한 내부 저장소입니다.
- **상속 순회(Inheritance Walk)**: 프로토타입 체인을 통해 전체 구성 계보를 해결합니다.
- **명시성**: 암묵적이고 마법 같은 리플렉션보다 명시적인 토큰과 메타데이터를 선호하십시오.

메타데이터 엔진을 마스터함으로써 Fluo를 효과적으로 사용할 뿐만 아니라 특정 애플리케이션 요구 사항에 맞게 확장하고 커스터마이징할 수 있는 힘을 얻게 됩니다. 커스텀 런타임 어댑터를 구축하든 복잡한 DI 플러그인을 구축하든, 메타데이터 시스템은 솔루션을 구축할 토대가 됩니다.

고급 독자에게 중요한 핵심은 Fluo에 **하나의** 메타데이터 메커니즘만 있는 것이
아니라는 점입니다.
Fluo는 의도적으로 층을 나눈 모델을 사용하며,
각 층은 서로 다른 책임을 맡습니다.

- `path:packages/core/src/metadata/shared.ts:13-34`는 전역 심볼 훅을 해결합니다.
- `path:packages/core/src/metadata/shared.ts:63-84`는 canonical 심볼 키를 정의합니다.
- `path:packages/core/src/metadata/shared.ts:103-115`는 대상별 맵을 필요 시 생성합니다.
- `path:packages/core/src/metadata/store.ts:16-33`은 clone-on-read/write 저장소를 제공합니다.
- `path:packages/core/src/metadata/class-di.ts:56-72`는 상속된 최종 DI 상태를 계산합니다.

이 분리는 중요합니다.
서로 다른 메타데이터 문제는 서로 다른 실패 양상을 가지기 때문입니다.
`Symbol.metadata` 가방은 표준 데코레이터 상호운용성에 적합하고,
`WeakMap` 저장소는 방어적 복제가 필요한 프레임워크 소유 레코드에 더 적합하며,
계보 순회는 상속 의미론이 개입할 때만 필요합니다.
Fluo는 이 세 관심사를 하나의 마법 같은 레지스트리로 뭉개지 않습니다.

`path:packages/core/src/metadata/shared.ts:20-31`의 `ensureMetadataSymbol`을 보면
그 태도가 잘 드러납니다.
먼저 네이티브 `Symbol.metadata`를 우선하고,
필요할 때만 `Symbol`에 한 번 정의합니다.
작은 구현이지만 큰 설계 원칙을 담고 있습니다.
표준 표면을 폴리필할 뿐,
독자적인 API를 영구히 도입하지 않는다는 원칙입니다.
이는 생태계 전체에 새로운 `Reflect.*Metadata` 동사를 의존하게 만들던
레거시 리플렉션 라이브러리와 정반대의 방향입니다.

다음 층은 이름 짓기 규율입니다.
`path:packages/core/src/metadata/shared.ts:63-84`에서 Fluo는
`standardMetadataKeys`와 `metadataKeys`를 분리합니다.
이 구분은 작아 보이지만 매우 중요합니다.
전자는 표준 메타데이터 가방에 쓰일 키이고,
후자는 Fluo 전용 저장소 키입니다.
이 차이를 놓치면 모든 메타데이터가 하나의 컨테이너에 사는 것처럼 보이지만,
실제 소스는 상호운용 데이터와 프레임워크 내부 관리 데이터를 의도적으로 나눕니다.

생성 헬퍼도 그 분리를 강화합니다.
`path:packages/core/src/metadata/shared.ts:103-115`의
`getOrCreatePropertyMap`은 필요할 때만 대상별 `Map`을 만듭니다.
즉, 라우트 수준이나 속성 수준 메타데이터가 없는 클래스는
미리 할당된 구조체 비용을 지불하지 않습니다.
팬아웃이 큰 애플리케이션에서는 이런 지연 할당이 추상적인
"메타데이터 성능" 주장보다 훨씬 실질적입니다.
실제로 부팅 시점 할당 압력을 줄이기 때문입니다.

중복 제거도 명시적으로 처리합니다.
`path:packages/core/src/metadata/shared.ts:127-143`의 `mergeUnique`는
삽입 순서와 참조 동일성으로 동작합니다.
사소해 보이지만 이것 역시 프레임워크 정책을 인코딩합니다.
가드와 인터셉터는 선언 순서를 유지해야 하고,
같은 참조가 중복되어 체인이 비대해지면 안 되며,
Fluo는 임의 사용자 객체에 대해 깊은 구조 동등성을 시도하지 않습니다.
즉 이 헬퍼는 단순 유틸리티가 아니라 정책 경계이기도 합니다.

`path:packages/core/src/metadata/store.ts:16-33`의 clone 저장소는
소스 수준의 엄밀함을 가장 잘 보여주는 예입니다.
`read()`는 꺼낼 때 복제하고,
`write()`는 넣을 때 복제하며,
`update()`는 updater 적용 후 다시 복제합니다.
이 세 방향 복제 규율 덕분에 공유 가변 참조가 메타데이터 계층을
주변 상태(ambient state)로 오염시키지 못합니다.
프레임워크 코드에서는 이런 특성이 단순 편의성보다 훨씬 더 중요합니다.
메타데이터 경쟁 상태를 디버깅하기 쉬워지기 때문입니다.

`class-di.ts`는 이런 저수준 부품이 런타임 동작으로 바뀌는 지점을 보여줍니다.
`path:packages/core/src/metadata/class-di.ts:13-25`는 생성자 계보를 계산하고,
순서를 뒤집은 뒤,
`path:packages/core/src/metadata/class-di.ts:56-72`에서 베이스에서 리프까지
메타데이터를 접어 넣습니다.
이 reverse는 장식이 아닙니다.
상속된 기본값이 먼저 보이고,
자식 정의가 마지막 결정권을 가지도록 보장하는 핵심 규칙입니다.
리플렉션 중심 시스템에서는 흐릿하게 보일 규칙이,
Fluo처럼 작고 명시적인 메타데이터 엔진에서는 소스만 읽어도 드러납니다.

`shared.ts`에는 또 하나의 고급 포인트가 숨어 있습니다.
`path:packages/core/src/metadata/shared.ts:151-193`은
`getStandardMetadataBag`, `getStandardConstructorMetadataBag`,
그리고 constructor 메타데이터 record/map reader를 제공합니다.
이는 Fluo가 메타데이터를 **어디서 읽는지**를 매우 조심스럽게 구분한다는 뜻입니다.
어떤 정보는 객체 자체에 있고,
어떤 정보는 생성자에 있으며,
헬퍼들은 이 선택을 거대한 "전부 가져오기" API 뒤에 숨기지 않습니다.

키 병합 루틴도 같은 테마를 이어갑니다.
`path:packages/core/src/metadata/shared.ts:202-223`은 stored key와 standard key를
first-seen order를 유지하며 병합합니다.
메타데이터가 WeakMap 저장소와 표준 bag 양쪽에서 올 수 있을 때
이 규칙은 결정적입니다.
두 세계가 완전히 같은 척하는 대신,
Fluo는 화해 규칙을 소스에 명시합니다.
바로 그 예측 가능성 덕분에 표준 데코레이터와 내부 런타임 저장소를 함께 써도
비결정적 동작으로 무너지지 않습니다.

조금 멀리서 보면 일관된 설계 휴리스틱이 드러납니다.

- 언어가 안정된 훅을 제공하면 표준을 사용합니다.
- 사용자 공간과 충돌하면 안 되는 이름에는 심볼을 사용합니다.
- 소유권과 가비지 컬렉션을 함께 가야 할 때는 `WeakMap`을 사용합니다.
- 읽기/쓰기 쪽이 변이 권한을 공유하면 안 될 때는 값을 복제합니다.
- 상속이 중요할 때만 지연 계보 순회를 수행하고, 모든 것을 미리 계산하지 않습니다.
- 배열과 키의 병합은 숨은 마법이 아니라 명시적 순서 규칙으로 처리합니다.

이 휴리스틱들이 Fluo를 작게 유지하면서도 복잡한 상위 패키지를 가능하게 합니다.
`@fluojs/http`, `@fluojs/openapi`, `@fluojs/validation` 같은 패키지는
별도의 리플렉션 우주를 만들 필요가 없습니다.
같은 메타데이터 프리미티브를 재사용하고,
자신들의 심볼 키와 읽기/쓰기 헬퍼만 특화하면 됩니다.
그래서 생태계가 통합되어 보이는 이유는 하나의 거대한 레지스트리가 모든 관심사를
소유해서가 아니라,
공유된 메타데이터 계약 위에서 각 패키지가 조립되기 때문입니다.

실무 관점의 결론도 분명합니다.
직접 확장 패키지를 설계할 때는 데코레이터를 쓰기 전에 세 가지를 물어야 합니다.

- 이 데이터는 상호운용성을 위해 표준 메타데이터 bag에 있어야 하는가?
- 이 데이터는 수명 주기를 프레임워크가 소유하므로 `WeakMap` 저장소에 있어야 하는가?
- 상속 시 병합 규칙이 필요한가, 아니면 own metadata만으로 충분한가?

이 질문들에 명확히 답할 수 있다면,
이미 Fluo 코어와 같은 메타데이터 모델로 사고하고 있는 것입니다.
바로 그 정렬이 커스텀 통합을 덧댄 느낌이 아니라 native extension처럼 보이게 만듭니다.

---
*End of Chapter 2*
