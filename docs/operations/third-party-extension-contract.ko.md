# Third-Party Extension Contract

<p><strong><kbd>한국어</kbd></strong> <a href="./third-party-extension-contract.md"><kbd>English</kbd></a></p>

이 문서는 Konekti 프레임워크를 위한 제3자 확장 기능, 플랫폼 어댑터, 커뮤니티 통합 패키지를 작성할 때 지켜야 할 계약과 관습을 정의합니다.

## Metadata Category Extension

Konekti는 TC39 표준 데코레이터와 `Symbol` 기반 메타데이터 시스템을 사용합니다. 프레임워크가 소유한 카테고리와 충돌하지 않으면서 커스텀 메타데이터 카테고리를 정의하려면 `Symbol.for()` 명명 규칙을 따르세요.

### Token Naming Convention

커스텀 메타데이터 키는 네임스페이스가 포함된 `Symbol.for()` 패턴을 사용해야 합니다:

- **Format**: `Symbol.for('konekti.extension.[package-name].[category]')`
- **Example**: `Symbol.for('konekti.extension.my-audit.log-policy')`

### Authoring Custom Decorators

메타데이터를 저장하려면 데코레이터 컨텍스트의 `metadata` 속성을 사용하세요. `@konekti/core` 호환성 경계(`ensureMetadataSymbol()` / `metadataSymbol`)를 통해 이 속성에 접근할 수 있습니다.

```typescript
import { metadataSymbol } from '@konekti/core';

const MY_AUDIT_KEY = Symbol.for('konekti.extension.my-audit.log-policy');

export function AuditLog(policy: string) {
  return (value: Function, context: ClassDecoratorContext) => {
    const metadata = context.metadata as Record<symbol, any>;
    metadata[MY_AUDIT_KEY] = policy;
  };
}
```

이 방식을 사용하면 데코레이터 평가 단계에서 메타데이터가 클래스에 연결되어, 나중에 확장 기능의 런타임 로직에서 이를 조회할 수 있습니다.

## Platform Adapter Authoring

플랫폼 어댑터는 Konekti HTTP 런타임을 특정 전송 계층이나 서버 구현(예: Node.js `http`, Fastify, 서버리스 런타임 등)에 연결하는 역할을 합니다.

### HttpApplicationAdapter Interface

어댑터는 `@konekti/http`의 `HttpApplicationAdapter` 인터페이스를 구현해야 합니다:

```typescript
export interface HttpApplicationAdapter {
  getServer?(): unknown;
  listen(dispatcher: Dispatcher): MaybePromise<void>;
  close(signal?: string): MaybePromise<void>;
}
```

- **`getServer()`**: 선택 사항. 내부 서버 인스턴스(예: `http.Server`)를 반환합니다.
- **`listen(dispatcher)`**: 서버를 시작하고 들어오는 요청을 `Dispatcher`에 전달하기 시작합니다. 어댑터는 네이티브 요청/응답 객체를 `FrameworkRequest`와 `FrameworkResponse` 형태로 변환할 책임이 있습니다.
- **`close(signal)`**: 서버를 정상적으로 종료합니다.

트랜스포트 패키지가 `@konekti/runtime/internal`의 공유 런타임 어댑터 부트스트랩 경로(`runHttpAdapterApplication(...)`)를 조합할 때, shutdown signal 등록은 별도의 런타임 소유 concern입니다. 공유 헬퍼는 더 이상 모든 어댑터를 대신해 Node 전역에 접근하지 않습니다. 관리형 signal 연결이 필요한 런타임 패키지는 명시적인 shutdown-registration 전략을 제공해야 하며, 프로세스 signal을 소유하지 않는 트랜스포트는 이를 생략할 수 있습니다.

#### 0.x 마이그레이션 노트

- 이전에 공유 헬퍼의 암묵적 Node signal 등록에 의존하던 런타임/어댑터 패키지는 이제 자신이 소유한 런타임 패키지에서 shutdown signal을 명시적으로 등록해야 합니다.

### Request/Response Bridging

어댑터는 네이티브 객체를 다음 계약에 맞게 매핑해야 합니다:

- **`FrameworkRequest`**: method, path, url, headers, query, cookies, params, body, rawBody를 포함해야 합니다.
- **`FrameworkResponse`**: `setStatus`, `setHeader`, `redirect`, `send` 메서드를 제공해야 합니다. 또한 중복 쓰기를 방지하기 위해 `committed` 상태를 추적해야 합니다.
- **`FrameworkResponse.stream`**: 선택 사항이지만, 어댑터가 SSE 또는 스트리밍 HTTP 응답 지원을 주장한다면 필수입니다. 이 capability는 raw Node response 객체를 덕타이핑하게 만들지 말고, 프레임워크 계약(`write`, `close`, `closed`, optional `flush`, optional `waitForDrain`, optional `onClose`) 뒤에 전송 계층별 writable 세부 구현을 숨겨야 합니다.

## DI Token Naming Conventions

제3자 패키지 간의 충돌을 방지하기 위해, 모든 내보내기용 주입 토큰은 일관된 명명 규칙을 따라야 합니다.

- **Format**: `ALL_CAPS_SNAKE_CASE`
- **Namespacing**: 패키지 이름을 접두사로 사용합니다.
- **Example**: `MY_PACKAGE_CACHE_CLIENT`, `STRIPE_INTEGRATION_OPTIONS`.

```typescript
// @my-org/konekti-cache
export const MY_CACHE_CLIENT = Symbol.for('MY_CACHE_CLIENT');
```

`CLIENT`나 `CONFIG`와 같이 너무 짧거나 일반적인 이름은 피하세요.

## Module Authoring Conventions

런타임 모듈 엔트리포인트는 마이그레이션 가이드, 스캐폴드, 패키지 README가 일관되도록 저장소 전역 canonical 문법(`forRoot(...)`, 필요 시 `forRootAsync(...)`, `register(...)`, `forFeature(...)`)을 사용해야 합니다.

`create*` 네이밍은 **런타임 모듈 엔트리포인트가 아닌** helper/builder에 유지하세요(예: `createTestingModule(...)` 같은 테스트 빌더, `createHealthModule()` 같은 작은 런타임 헬퍼).

이 네이밍 정책의 단일 기준(source-of-truth)은 `../reference/package-surface.ko.md`입니다.

### 런타임 모듈 엔트리포인트 패턴 (`forRoot`)

정적 `forRoot(...)` 엔트리포인트를 가진 모듈 클래스를 노출하고, 해당 메서드가 구성된 런타임 모듈 타입을 반환하도록 작성하세요.

```typescript
import { defineModuleMetadata } from '@konekti/core';

export class MyExtensionModule {
  static forRoot(options: MyExtensionOptions): new () => MyExtensionModule {
    class MyExtensionRuntimeModule extends MyExtensionModule {}

    defineModuleMetadata(MyExtensionRuntimeModule, {
      global: true,
      exports: [MyExtensionService],
      providers: [
        { provide: MY_EXTENSION_OPTIONS, useValue: options },
        MyExtensionService,
      ],
    });

    return MyExtensionRuntimeModule;
  }
}
```

## Stability Guarantees

확장 기능 작성자는 프레임워크의 마이너 업데이트 시에도 호환성을 유지할 수 있도록 안정적인(Stable) API에만 의존해야 합니다. 전체 등급 목록은 `release-governance.ko.md`를 참조하세요.

| Category | Stability | Note |
|---|---|---|
| `@konekti/core` types | Stable | `Constructor`, `Token`, `MaybePromise` 등 기본 프리미티브. |
| `@konekti/core` decorators | Stable | `@Module`, `@Inject`, `@Scope`, `@Global`. |
| `HttpApplicationAdapter` | Stable | 서버 어댑터를 위한 핵심 계약. |
| `FrameworkRequest` / `FrameworkResponse` | Stable | 내부 요청/응답 추상화 계층. |
| Metadata WeakMaps | Internal | 프레임워크 내부 WeakMap을 직접 읽지 마세요. 제공된 `get*Metadata` 헬퍼를 사용하세요. |
| `@konekti/runtime` Internals | At-Risk | 컴파일러 및 모듈 그래프 조립 로직은 변경될 수 있습니다. |

안정적인 API의 변경은 `1.0` 정식 버전 이후 메이저 버전 업데이트를 통해서만 이루어집니다. `0.x` 단계에서는 마이너 릴리스마다 제공되는 마이그레이션 노트를 확인하세요.
