# 제3자 확장 기능 계약 (Third-Party Extension Contract)

<p>
  <strong>한국어</strong> | <a href="./third-party-extension-contract.md">English</a>
</p>

이 계약은 Konekti 프레임워크를 위한 제3자 확장 기능, 플랫폼 어댑터, 커뮤니티 통합 패키지를 작성할 때 준수해야 할 기술적 요구사항과 아키텍처 관례를 정의합니다. 이 표준을 따름으로써 크로스 런타임 호환성을 보장하고 메타데이터 충돌을 방지할 수 있습니다.

## 이 문서가 필요한 경우

- **확장 기능 개발**: Konekti의 DI 또는 메타데이터 시스템과 통합되는 재사용 가능한 라이브러리를 구축할 때.
- **플랫폼 어댑터**: Konekti를 새로운 HTTP 런타임(예: Lambda, Cloudflare Workers 또는 커스텀 내부 서버)으로 포팅할 때.
- **통합 패키지**: 기존 라이브러리(예: Stripe, Auth0 또는 커스텀 SQL 드라이버)를 Konekti 모듈에서 사용할 수 있도록 래핑할 때.

---

## 메타데이터 및 데코레이터 (Metadata and Decorators)

Konekti는 TC39 표준 데코레이터와 `Symbol` 기반 메타데이터 시스템을 사용합니다. 프레임워크와 제3자 확장 기능 간의 충돌을 방지하기 위해 다음의 엄격한 명명 규칙을 따르세요.

### 메타데이터 키 명명 (Metadata Key Naming)
커스텀 메타데이터 키는 생태계 전반에서 유일성을 보장하기 위해 네임스페이스가 포함된 `Symbol.for()` 패턴을 사용해야 합니다.
- **Format**: `Symbol.for('konekti.extension.[package-name].[category]')`
- **Example**: `Symbol.for('konekti.extension.audit-logger.policy')`

### 데코레이터 작성 (Authoring Decorators)
데코레이터 컨텍스트의 `metadata` 속성을 사용하세요. 현재 환경에서 심볼의 존재를 보장하기 위해 항상 `@konekti/core` 호환성 경계(`metadataSymbol`)를 사용해야 합니다.

```ts
import { metadataSymbol } from '@konekti/core';

const AUDIT_KEY = Symbol.for('konekti.extension.audit-logger.policy');

export function Audit(policy: string) {
  return (value: Function, context: ClassDecoratorContext) => {
    // metadataSymbol은 @konekti/core에 의해 존재가 보장됩니다.
    const metadata = context.metadata as Record<symbol, any>;
    metadata[AUDIT_KEY] = policy;
  };
}
```

---

## 플랫폼 어댑터 아키텍처 (Platform Adapter Architecture)

플랫폼 어댑터는 Konekti HTTP 런타임을 특정 전송 계층 구현에 연결합니다.

### `HttpApplicationAdapter` 인터페이스
모든 어댑터는 `@konekti/http`의 핵심 인터페이스를 구현해야 합니다.

- `listen(dispatcher: Dispatcher)`: 전송 계층을 시작하고 트래픽을 프레임워크 `Dispatcher`로 라우팅합니다.
- `close(signal?: string)`: 내부 서버의 정상 종료(Graceful Shutdown)를 수행합니다.
- `getServer()`: (선택 사항) 네이티브 서버 인스턴스(예: `http.Server` 또는 `FastifyInstance`)를 반환합니다.

### 요청/응답 매핑 (Request/Response Mapping)
어댑터는 네이티브 객체를 Konekti의 `FrameworkRequest` 및 `FrameworkResponse` 추상화 계층으로 매핑할 책임이 있습니다.
- **커밋 추적**: 어댑터는 응답의 `committed` 상태를 추적하여 중복 쓰기 오류를 방지해야 합니다.
- **스트림 지원**: 어댑터가 SSE 또는 스트리밍을 지원하는 경우, 원시 Node/Web 스트림을 노출하는 대신 프레임워크의 추상화 계층을 사용하여 `FrameworkResponse.stream`을 구현해야 합니다.

---

## 의존성 주입 (DI) 표준 (Dependency Injection Standards)

### 토큰 명명 (Token Naming)
DI 컨테이너 내에서의 충돌을 방지하기 위해 모든 내보내기용 주입 토큰은 고유하고 서술적이어야 합니다.
- **Format**: `ALL_CAPS_SNAKE_CASE`
- **Prefix**: 패키지 이름을 접두사로 사용합니다.
- **Example**: `REDIS_EXTENSION_CLIENT`, `AUTH0_MODULE_OPTIONS`.

### 모듈 엔트리포인트 (Module Entrypoints)
런타임 모듈 엔트리포인트에 대해 프레임워크 전역의 canonical 명칭을 따르세요.
- `forRoot(options)`: 전역 루트 수준 구성을 위해 사용합니다.
- `forRootAsync(options)`: 팩토리 기반의 비동기 주입이 필요한 구성을 위해 사용합니다.
- `forFeature(options)`: 도메인 특정 또는 스코프가 지정된 구성을 위해 사용합니다.
- `register(options)`: 일회성, 비전역 모듈 등록을 위해 사용합니다.

---

## 안정성 등급 목록 (Stability Tier List)

확장 기능 작성자는 다음 안정성 등급에 따라 의존성의 우선순위를 정해야 합니다.

| 등급 | 안정성 | 패키지/API |
| :--- | :--- | :--- |
| **Tier 1** | Stable | `@konekti/core` (데코레이터, 타입), `HttpApplicationAdapter`. |
| **Tier 2** | Stable | `FrameworkRequest`, `FrameworkResponse`, `Dispatcher`. |
| **Tier 3** | Internal | `WeakMaps`, `Metadata` 내부 (대신 `get*Metadata` 헬퍼 사용). |
| **Tier 4** | Experimental | `@konekti/runtime` 조립 로직, 컴파일러 내부. |

---

## 관련 문서
- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)](./platform-conformance-authoring-checklist.ko.md)
- [릴리스 거버넌스 (Release Governance)](./release-governance.ko.md)
- [테스트 가이드 (Testing Guide)](./testing-guide.ko.md)
