# 표준 데코레이터와 빌드 도구의 역할

<!-- book:volume=03-internals;chapter=02 -->

[이전: 주문 요청 하나를 소스 끝까지 따라가기](./ch01-trace-an-order.ko.md) · [3권 목차](./toc.ko.md) · [다음: 메타데이터는 어디에 저장되는가](./ch03-metadata-ownership.ko.md)

## 테스트는 초록인데 주문 경로가 사라졌다

앞 장에서 주문 조회가 선언, 부트스트랩, 요청 실행을 지나가는 경로를 확인했다. 그런데 FluoBlog에 상점을 붙인 뒤 빌드 설정을 정리하면서 이상한 일이 생긴다. 주문 서비스의 단위 테스트는 통과하지만 빌드한 앱에서는 DTO 필드가 바인딩되지 않는다. 개발자는 TypeScript 버전을 올렸으니 데코레이터 지원도 더 좋아졌을 것이라고 생각한다. 다른 개발자는 Node24를 사용하므로 변환 플러그인이 더는 필요 없다고 주장한다. 둘 다 서로 다른 역할을 한 가지 “지원”이라는 말에 넣었다.

TypeScript 타입 검사기가 소스를 이해하는 일, Babel이 데코레이터를 JavaScript로 변환하는 일, Vite가 모듈을 묶는 일, Node가 최종 모듈을 평가하는 일은 별개다. 어느 하나의 버전이 높다는 사실로 나머지 단계의 계약을 증명할 수 없다. 특히 테스트 러너가 사용하는 변환 경로와 배포 앱의 변환 경로가 다르면, 테스트 성공은 배포 변환의 증거가 아니다. 이 장에서는 동일한 주문 서비스를 두고 그 차이를 관찰한다.

Fluo는 `experimentalDecorators`와 `emitDecoratorMetadata`에 의존하는 레거시 모델을 사용하지 않는다. 현재 애플리케이션 빌드 플러그인은 Babel의 `2023-11` 표준 데코레이터 의미를 선택한다. 여기서 날짜는 실제 변환 설정의 값이다. TC39 제안의 진행 단계나 특정 런타임의 네이티브 문법 지원 여부를 대신하는 표현이 아니다. 우리는 Node24와 pnpm10을 실행 기준으로 삼되, 데코레이터가 있는 TypeScript를 문서화된 빌드 경계에서 JavaScript로 바꾼다.

## 데코레이터는 요청 때 호출되는 설정 함수가 아니다

우선 실행 시점을 분리하자. `@Inject(ORDER_LOOKUP)`이라는 표현에서 `Inject(...)` factory는 클래스 선언을 평가하는 과정에서 호출되어 데코레이터 함수를 만든다. 그 함수가 클래스에 적용되어 토큰 메타데이터를 기록한다. 이후 DI 컨테이너가 클래스를 생성할 때 그 기록을 읽는다. 컨트롤러가 주문 하나를 조회할 때마다 `Inject(...)`를 다시 실행하는 것이 아니다.

표준 메서드 데코레이터는 메서드 값과 context를 받는다. context에는 `kind`, `name`, `static`, `private`, `addInitializer`, 메타데이터 통합 지점 등이 있다. 레거시의 `(target, propertyKey, descriptor)`와 호출 규약이 다르다. context를 descriptor로 취급해 `descriptor.value`를 고치는 예제를 그대로 가져오면 구조부터 맞지 않는다. 표준 클래스 데코레이터인 `@Inject`를 생성자 매개변수 위에 붙이는 방식도 현재 Fluo API가 아니다.

아래는 `src/decorators/order-probe.ts`라는 **완전한 실험 파일**이다. 주문의 결제나 배송 로직을 바꾸지 않고, 같은 상품 운영자가 보는 조회 설명을 만든다. `READ_LABEL`은 실제 DI 토큰이고 `OrdersModule`은 provider와 export를 명시한다. `marked()`는 호출 시점과 표준 metadata bag을 관찰하기 위한 애플리케이션 소유 데코레이터다. 재사용 확장의 완성 설계는 4장에서 다루므로 여기서는 public instance method만 허용한다.

```ts
import { Inject, Module, Scope } from '@fluojs/core';

export const events: string[] = [];
export const MARKS = Symbol.for('fluo.book-build-probe.marks');
export const READ_LABEL = Symbol('READ_LABEL');

function marked(label: string) {
  events.push(`factory:${label}`);
  return function <This, Args extends unknown[], Result>(
    value: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Result
    >,
  ) {
    if (context.static || context.private) {
      throw new TypeError('Only public instance methods are supported');
    }
    if (!context.metadata) {
      throw new Error('Metadata preload is required');
    }
    events.push(`apply:${label}:${String(context.name)}`);
    const previous = context.metadata[MARKS];
    const marks: readonly string[] = Array.isArray(previous) ? previous : [];
    context.metadata[MARKS] = Object.freeze([...marks, label]);
    return value;
  };
}

@Scope('singleton')
@Inject(READ_LABEL)
export class OrdersService {
  constructor(private readonly label: string) {
    events.push('construct:OrdersService');
  }

  @marked('outer')
  @marked('inner')
  describe(id: string): string {
    events.push(`call:${id}`);
    return `${this.label}:${id}`;
  }
}

@Module({
  providers: [
    { provide: READ_LABEL, useValue: 'order-summary' },
    OrdersService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
```

`marked()`가 기존 메서드를 그대로 반환하므로 호출 결과나 `this`가 바뀌지 않는다. 관찰하려는 것은 래퍼 비용이 아니라 평가 순서와 metadata 보존이다. factory는 소스에 적힌 순서대로 평가되지만, 같은 메서드에 쌓인 데코레이터는 안쪽부터 적용된다. 이 예제의 기대 순서는 `factory:outer`, `factory:inner`, `apply:inner:describe`, `apply:outer:describe`다. 데코레이터가 추가로 달리면 모든 전역 이벤트를 이 네 개로 고정할 수 없으므로, 이 실험 파일의 데코레이터만 기록한다.

표준 메타데이터 객체는 클래스 선언에 연결되는 자료이지 서비스 인스턴스마다 따로 생성하는 요청 저장소가 아니다. 그래서 이 코드에 주문 ID나 고객 계정을 metadata로 쓰지 않았다. 런타임 요청값을 클래스 메타데이터에 기록하면 여러 요청과 인스턴스가 같은 기록을 덮어쓸 수 있다. `describe()` 안의 배열 기록은 테스트 전용 장치이며, 실제 감사 로그나 운영 telemetry로 확장할 대상이 아니다.

## ESM에서는 준비 코드를 어디에 두는가

`@fluojs/core`를 import하는 행위만으로 전역 `Symbol.metadata`가 설치되지는 않는다. 내장 core 데코레이터의 framework-owned 저장소와, 사용자 데코레이터가 `context.metadata`로 접근하는 표준 통합 지점을 구분해야 한다. 사용자 데코레이터가 표준 bag을 필요로 한다면 decorated module을 평가하기 전에 `ensureMetadataSymbol()`을 실행한다.

아래 `src/decorators-main.ts`는 **완전한 실험 진입점**이다. `OrdersService`를 static import하지 않는 이유는 ESM 평가 순서 때문이다. static import의 의존 모듈은 현재 모듈 본문보다 먼저 평가된다. 따라서 같은 파일에서 import 아래에 초기화 함수를 적는 것으로 순서가 보장되지 않는다. dynamic import는 초기화가 끝난 뒤에만 decorated module을 평가하게 한다.

```ts
import assert from 'node:assert/strict';
import { ensureMetadataSymbol, getModuleMetadata } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';

const metadataSymbol = ensureMetadataSymbol();
const { events, MARKS, OrdersModule, OrdersService } =
  await import('./decorators/order-probe.js');

assert.deepEqual(events, [
  'factory:outer',
  'factory:inner',
  'apply:inner:describe',
  'apply:outer:describe',
]);
assert.ok(getModuleMetadata(OrdersModule)?.exports?.includes(OrdersService));

const bag: unknown = Reflect.get(OrdersService, metadataSymbol);
assert.ok(typeof bag === 'object' && bag !== null);
assert.deepEqual(Reflect.get(bag, MARKS), ['inner', 'outer']);

const app = await FluoFactory.createApplicationContext(OrdersModule);
try {
  const orders = await app.get(OrdersService);
  assert.equal(orders.describe('order-1001'), 'order-summary:order-1001');
  assert.equal(await app.get(OrdersService), orders);
  assert.equal(
    events.filter((event) => event === 'construct:OrdersService').length,
    1,
  );
  assert.equal(events.filter((event) => event.startsWith('call:')).length, 1);
  console.log('decorator probe assertions passed');
} finally {
  await app.close();
}
```

이 실험은 초기화와 호출 사이의 시간을 고정된 대기로 측정하지 않는다. dynamic import가 settle된 시점에 선언 단계의 이벤트를 검사하고, 명시적 `get()`과 메서드 호출 뒤 생성 및 호출 횟수를 검사한다. runtime이 singleton을 bootstrap 중에 해석할 수도 있으므로 “생성자는 첫 get 직전에만 실행된다”는 더 강한 가정을 두지 않았다. 필요한 관찰은 import만으로 DI 서비스가 생성되지 않았으며, 같은 애플리케이션의 singleton 조회가 같은 인스턴스를 돌려준다는 것이다.

일반 `new OrdersService('manual')`는 DI를 사용하지 않는 수동 생성이다. `@Inject`가 JavaScript의 `new` 동작을 가로채 인수를 채워 주는 것은 아니다. 또한 `@Scope('singleton')`을 붙였다고 클래스가 자바스크립트 전역 singleton이 되지 않는다. scope는 컨테이너가 해석할 때 읽는 선언이다. 이 구분을 놓치면 데코레이터 자체에 네트워크 연결이나 서비스 생성 코드를 넣어 import 시점부터 자원을 확보하는 설계로 흐르기 쉽다.

## Vite 앞단에 Babel을 두는 이유

아래 `vite.decorators.config.ts`는 **실험 전용의 완전한 설정 파일**이다. 실제 앱의 `vite.config.ts`를 대체하지 않는다. 이 파일을 사용하면 주문 probe의 진입점만 별도 디렉터리에 빌드하므로 블로그의 정상 `src/main.ts`와 산출물을 혼동하지 않는다.

```ts
import { fluoDecoratorsPlugin } from '@fluojs/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [fluoDecoratorsPlugin()],
  build: {
    ssr: 'src/decorators-main.ts',
    target: 'node24',
    outDir: '.lab-dist/standard-decorators',
    emptyOutDir: false,
    sourcemap: true,
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
```

프로젝트에는 `@fluojs/core`, `@fluojs/runtime`과 그 실행 의존성이 설치되어 있어야 한다. 빌드 경계의 직접 의존성은 `@fluojs/vite`, Vite 및 Babel peer들이다. 현재 생성되는 non-Deno starter는 Vite `^8.2.2`를 사용하지만, `@fluojs/vite`의 배포 peer 범위 자체는 `vite >=6.2.0`이다. 특정 starter 버전과 플러그인의 지원 범위를 같은 숫자로 설명하지 않는다. 새 실험 환경에 필요한 개발 의존성과 실행 명령은 다음과 같다.

```bash
pnpm add -D @fluojs/vite vite@^8.2.2 @babel/core @babel/plugin-proposal-decorators @babel/preset-typescript
pnpm exec vite build --config vite.decorators.config.ts
node .lab-dist/standard-decorators/main.js
```

이 명령은 독자 프로젝트에서 실행하는 절차다. 이번 원고 작성에서 새 의존성을 설치했다거나 모든 독자 환경의 빌드가 통과했다고 뜻하지 않는다. 마지막 출력의 기대값은 다음과 같고, 그 앞에 runtime이 출력하는 시작 로그가 있을 수 있다.

```text
decorator probe assertions passed
```

`src/decorators-plugin.ts`를 보면 플러그인의 `enforce: 'pre'`가 핵심이다. Babel이 Vite의 일반 변환 단계보다 먼저 데코레이터를 처리해야 한다. Oxc나 esbuild가 원래 구문을 먼저 바꾼 뒤 Babel에 넘기면, Babel이 지켜야 할 metadata 의미를 복원할 수 있다고 보장할 수 없다. `plugins` 배열에서 먼저 적었다는 것만으로 이 경계를 설명하지 말고, 플러그인 단계까지 확인해야 한다.

실제 변환 옵션에는 `babelrc: false`, `configFile: false`, `@babel/plugin-proposal-decorators`의 `{ version: '2023-11' }`, `@babel/preset-typescript`의 `{ allowDeclareFields: true }`가 있다. Babel 설정 파일을 주변 디렉터리에서 우연히 읽어 결과가 바뀌지 않게 하며, 문서화된 표준 의미를 명시적으로 선택한다. 플러그인은 타입을 제거하고 데코레이터를 변환하지만 타입 안전성을 증명하지 않는다. `number` 자리에 문자열을 전달하는 오류를 잡으려면 별도의 TypeScript 검사도 필요하다.

빌드 산출물에서 `@marked`가 사라진 것만 보면 부족하다. 문법을 제거하는 것은 여러 변환기가 할 수 있다. 더 중요한 증거는 산출물을 실행한 결과 `context.metadata`에 기록한 값이 남고, 데코레이터 적용 순서와 `this`를 사용하는 서비스 동작이 유지되는지다. 그래서 probe는 출력 코드의 helper 이름을 비교하지 않는다. helper 이름이나 생성 코드 형태는 Babel 버전에 따라 달라져도 의미가 유지될 수 있다.

## 어떤 파일이 이 변환을 통과하는가

플러그인은 모든 파일을 변환하지 않는다. Vite의 query나 hash suffix를 제거하고 경로 구분자를 정규화한 뒤, 애플리케이션 `.ts`만 허용한다. `.d.ts`, `*.test.ts`, `*.spec.ts`, `node_modules` 안의 파일, `.tsx`를 포함한 다른 확장자는 건너뛴다. `/app/src/orders.ts?import`는 변환 대상이고 `/app/src/orders.test.ts?import`는 아니다. suffix를 먼저 제거하는 이유는 개발 서버가 붙인 표시 때문에 같은 실제 파일의 소유 경계가 바뀌지 않게 하기 위해서다.

이 규칙은 주문 조회 코드의 배치에도 영향을 준다. React 화면인 `src/page.tsx`에 데코레이터가 붙은 서비스 선언을 같이 넣으면 현재 애플리케이션 플러그인의 대상이 아니다. 렌더링은 `.tsx`에, 데코레이터가 있는 선언은 `src/app.ts`나 `src/orders/*.ts`에 둔다. 이것은 JSX와 백엔드를 한 파일에 넣을 수 없다는 일반 언어 규칙이 아니라, 현재 Fluo가 제공하는 변환 경계다.

테스트 파일을 제외하는 것도 누락이 아니다. 생성된 테스트 환경은 `@fluojs/testing/vitest`의 별도 변환을 사용한다. 애플리케이션 Vite 플러그인을 테스트 파일까지 무조건 확장하면 두 변환기가 같은 선언을 처리하거나 테스트 전용 의미를 깨뜨릴 수 있다. 반대로 Vitest 설정만 올바르게 남겨 두고 앱 플러그인을 삭제하면 테스트는 계속 성공할 수 있다. 첫 사고의 조사 순서는 바로 여기서 갈라진다. 실패한 파일의 실제 ID와 그 ID를 처리한 transform을 확인하자.

decorated DTO 필드에는 초기값을 주거나 optional 필드를 사용한다. 예를 들어 앞 장의 `id = ''`는 지원되는 형태다. `id!: string`은 단지 타입 검사기에게 초기화를 믿으라고 하는 문법처럼 보이지만, Fluo가 사용하는 Babel 설정에서는 decorated definite-assignment field가 거부된다. 에러를 없애려고 레거시 decorator 모드를 켜는 대신 지원되는 필드 선언을 사용해야 한다. field의 초기값이 바인딩과 검증을 대신하지 않는다는 점도 그대로다.

## 변환 경계의 실패를 재현하는 방법

첫 번째 실패 실험은 preload 순서다. 별도의 깨끗한 프로세스에서 metadata 심벌이 없는 조건을 확인하고, `order-probe`를 먼저 평가하도록 진입점을 바꾸면 `Metadata preload is required`가 발생해야 한다. 다만 런타임이 이미 `Symbol.metadata`를 제공하는 환경에서는 같은 변경이 실패하지 않을 수 있다. 그 경우 성공했다는 사실로 잘못된 import 순서가 모든 환경에서 안전하다고 결론 내리지 않는다. 기존 전역 상태에 기대는지를 확인하는 실험이므로 테스트 프로세스의 상태가 조건에 포함된다.

두 번째는 플러그인 단계다. 소유 패키지의 `vite8-rolldown.test.ts`는 정상 Vite build를 실행하며 일반 단계 probe에 아직 field decorator 구문이 남아 있으면 실패한다. 이어서 산출물을 실행하고 field binding metadata를 검사한다. 이 테스트는 `enforce` 문자열 하나만 검사하는 단위 테스트와 역할이 다르다. 순서를 잘못 바꿨을 때 실제 pipeline이 metadata를 잃는지 검출한다.

세 번째는 파일 경계다. `transform-boundary.test.ts`는 `.test.ts?import`, `.d.ts#hash`, Windows 형식 `node_modules` 경로까지 제외되는지 확인한다. 주문 probe를 `.tsx`로 바꿔 놓고 변환이 왜 사라졌는지 조사할 때 이 테스트가 기대 계약을 알려 준다. 경계 밖 파일이 null을 반환하는 것은 플러그인 실패가 아니라 다른 변환기의 책임을 침범하지 않는 동작이다.

네 번째는 의존성 로딩 시점이다. `@fluojs/vite`의 root import나 `fluoDecoratorsPlugin()` 호출만으로 Babel을 로드하지 않는다. 첫 eligible transform에서 lazy load하고, 빠진 Babel peer는 변환 중인 파일 경로를 포함한 진단으로 보고한다. 따라서 “플러그인 import가 성공했으니 Babel 설치는 정상”이라는 점검은 충분하지 않다. 반대로 플러그인 목록만 검사하는 도구가 Babel을 설치하지 않았다는 이유로 즉시 실패할 필요도 없다. 설정 관찰과 실제 소스 변환의 비용을 나눈 설계다.

다음 명령은 저장소에서 관련 회귀만 선택하는 재현 절차다. 루트 전체 빌드나 모든 governance 검사를 대신 실행할 필요는 없다. 파일 경계와 실제 Vite pipeline을 함께 확인하려는 선택이며, 원고의 문장을 문자열로 고정하는 테스트가 아니다.

```bash
pnpm --filter @fluojs/vite exec vitest run -c vitest.config.ts src/transform-boundary.test.ts src/transform-options.test.ts src/plugin-stage.test.ts src/vite8-rolldown.test.ts
```

## 더 단순한 선택과 다음 경계

작은 데이터 변환 함수에 데코레이터가 필요하지는 않다. 주문 총액의 산술 규칙은 일반 함수로 두는 편이 입력과 출력을 시험하기 쉽다. 데코레이터는 모듈 등록, DI 선언, 라우트처럼 선언을 수집하여 나중에 실행 계획을 만드는 데 가치가 있다. 모든 도메인 규칙을 데코레이터로 감싸면 평가 시점과 호출 시점이 멀어져 오류를 설명하기 어려워진다.

반대로 설정을 전부 수동 호출로 바꾸는 것도 공짜가 아니다. 모듈마다 토큰과 provider를 중복해서 적으면 선언과 실제 생성 로직이 어긋날 수 있다. 선택의 기준은 문법의 짧음이 아니라 책임이 한 곳에 모이는지다. Babel의 역할은 표준 데코레이터 의미를 보존하는 것이고, runtime의 역할은 그 선언을 실제 컨테이너와 HTTP 실행에 연결하는 것이다. 빌드 도구가 DI 타입을 추론하거나 누락된 providers를 알아서 등록해 주리라고 기대하지 않는다.

이제 주문 서비스의 선언이 언제 평가되고, 무엇을 거쳐 배포 가능한 JavaScript가 되는지 확인했다. 다음 장에서는 그 선언이 남긴 데이터의 수명을 살핀다. `Object.freeze`를 봤다고 모든 값이 불변인지, 같은 클래스를 두 번 import한 것과 이름이 같은 새 클래스를 만든 것이 같은지, 자식 클래스가 부모의 어떤 메타데이터를 이어받는지가 새로운 질문이다.

## 소스와 계약 근거

- [core README의 표준 데코레이터·preload 계약](../../packages/core/README.ko.md), [클래스 데코레이터 구현](../../packages/core/src/decorators.ts), [metadata 심벌 경계](../../packages/core/src/metadata/shared.ts)
- [Vite README의 peer·파일 경계](../../packages/vite/README.ko.md), [공개 export](../../packages/vite/src/index.ts), [Babel transform 구현](../../packages/vite/src/decorators-plugin.ts)
- [파일 경계 테스트](../../packages/vite/src/transform-boundary.test.ts), [proposal·source map 옵션 테스트](../../packages/vite/src/transform-options.test.ts), [pre 단계 테스트](../../packages/vite/src/plugin-stage.test.ts)
- [실제 Vite8·Rolldown 산출물 실험](../../packages/vite/src/vite8-rolldown.test.ts), [core 표준 metadata 변환 테스트](../../packages/core/src/decorator-transform.test.ts)
- [HTTP README의 DTO 필드 선언 제약](../../packages/http/README.ko.md), [확장 데코레이터 계약](../../docs/contracts/third-party-extension-contract.ko.md)
