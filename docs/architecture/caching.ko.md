# 캐시 계약

<p><a href="./caching.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 `@fluojs/cache-manager`, `@fluojs/http`, 그리고 선택적인 Redis 저장소 경로 전반의 현재 캐시 계약을 정의합니다.

## 모듈 및 저장소 모델

| 표면 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 모듈 진입점 | 애플리케이션은 `CacheModule.forRoot(...)`로 캐시 지원을 등록합니다. 공개 옵션에는 `store`, `ttl`, `httpKeyStrategy`, `principalScopeResolver`, `redis`, `isGlobal`이 포함됩니다. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/module.ts` |
| 캐시 서비스 | `CacheService`는 `get`, `set`, `remember`, `del`, `reset`을 제공하는 직접 애플리케이션 캐시 파사드입니다. | `packages/cache-manager/src/service.ts` |
| HTTP 통합 | `CacheInterceptor`는 GET read-through 캐싱과 쓰기 후 eviction을 수행합니다. | `packages/cache-manager/src/interceptor.ts` |
| 메모리 저장소 | `MemoryStore`는 캐시 엔트리를 프로세스 내부에 보관하고, 접근 시점에 만료를 지연 정리하며, 가장 오래된 키부터 제거하면서 라이브 엔트리를 `1,000`개로 제한합니다. | `packages/cache-manager/src/stores/memory-store.ts` |
| Redis 저장소 | `RedisStore`는 JSON 직렬화된 엔트리를 prefix가 붙은 키 공간에 저장하고, 양수 TTL에는 `EX`를 사용하며, 설정된 prefix를 scan해서 reset을 수행합니다. | `packages/cache-manager/src/stores/redis-store.ts` |

## 캐시 키 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 기본 키 소스 | `@CacheKey(...)`가 없으면 `CacheInterceptor`가 `httpKeyStrategy`에서 키를 계산합니다. | `packages/cache-manager/src/interceptor.ts`, `packages/cache-manager/src/types.ts` |
| 내장 전략 | 지원되는 전략 값은 `'route'`, `'route+query'`, `'full'`, 사용자 정의 함수입니다. 인터셉터 구현은 `'route'`를 path-only로 처리하고, 그 외의 내장 값은 path와 정렬된 query string 조합으로 처리합니다. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/interceptor.ts` |
| query 정규화 | query를 포함하는 키에서는 query 항목을 키 기준으로 정렬하고 반복 값도 정렬한 뒤 직렬화하므로, 순서만 다른 query string은 동일한 키로 매핑됩니다. | `packages/cache-manager/src/interceptor.ts` |
| principal 격리 | 내장 키 전략은 `principalScopeResolver`가 값을 반환하면 `|principal:<scope>`를 추가합니다. 사용자 정의 resolver가 없으면 인증된 요청은 `requestContext.principal`의 `issuer`와 `subject`를 추가합니다. | `packages/cache-manager/src/interceptor.ts` |
| 명시적 override | `@CacheKey(...)`는 정적 문자열 또는 resolver 함수를 저장할 수 있으며, 해당 핸들러의 계산된 GET 키를 덮어씁니다. | `packages/cache-manager/src/decorators.ts` |

## TTL 및 쓰기 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 기본 TTL 해석 | `CacheService.set(...)`는 TTL을 `ttlSeconds ?? options.ttl`로 해석합니다. | `packages/cache-manager/src/service.ts` |
| 쓰기 비활성화 | TTL이 유한하지 않거나 `0`보다 작으면 캐시 쓰기를 수행하지 않습니다. | `packages/cache-manager/src/service.ts` |
| 무기한 엔트리 | `ttl: 0`은 만료 없음 의미입니다. 메모리 저장소는 이런 엔트리에 `expiresAt`을 두지 않고, Redis 저장소는 `EX` 없이 기록합니다. | `packages/cache-manager/src/service.ts`, `packages/cache-manager/src/stores/memory-store.ts`, `packages/cache-manager/src/stores/redis-store.ts` |
| GET 전용 응답 캐싱 | `CacheInterceptor`는 `GET` 요청에 대해서만 read-through 캐싱을 수행합니다. GET이 아닌 요청은 캐시 읽기와 쓰기를 건너뜁니다. | `packages/cache-manager/src/interceptor.ts` |
| 캐시 가능한 응답 형태 | 인터셉터는 핸들러가 `undefined`, `SseResponse`, 이미 커밋된 응답을 반환한 경우 캐싱하지 않습니다. | `packages/cache-manager/src/interceptor.ts` |
| read-through 중복 제거 | `CacheService.remember(...)`는 key별 in-flight promise 맵으로 동시 miss를 중복 제거합니다. | `packages/cache-manager/src/service.ts` |

## 무효화 규칙

| 규칙 | 현재 계약 | 소스 기준 |
| --- | --- | --- |
| 데코레이터 경로 | `@CacheEvict(...)`는 쓰기 후 eviction을 위한 단일 키, 키 목록, 또는 resolver 함수를 저장합니다. | `packages/cache-manager/src/decorators.ts` |
| eviction 시점 | GET이 아닌 핸들러에서는 downstream 핸들러가 성공한 뒤에만 eviction이 실행됩니다. HTTP 응답이 아직 커밋되지 않았다면 `response.send(...)` 또는 fallback timer까지 eviction을 지연합니다. | `packages/cache-manager/src/interceptor.ts` |
| 실패 격리 | `safeGet`, `safeSet`, `safeDel`은 저장소 오류를 삼킵니다. 캐시 실패가 다른 정상 핸들러를 실패시키지 않습니다. | `packages/cache-manager/src/interceptor.ts` |
| 진행 중 로드 무효화 | `CacheService.del(...)`은 아직 로딩 중인 키를 표시하여, 같은 로드 주기 중 무효화된 키가 `remember(...)`에 의해 다시 채워지지 않도록 합니다. | `packages/cache-manager/src/service.ts` |
| 전체 reset | `CacheService.reset()`은 내부 reset version을 증가시키고, 진행 중/대기 중인 load bookkeeping과 진행 중 무효화 마커를 지운 뒤, 하위 저장소를 reset합니다. | `packages/cache-manager/src/service.ts` |
| 저장소 teardown | 애플리케이션 종료 중 `CacheService`는 custom store의 `close()` hook을 호출하고, `close()`가 없으면 `dispose()`를 호출하므로 리소스를 소유한 store가 socket, pool, timer 또는 기타 외부 handle을 해제할 수 있습니다. | `packages/cache-manager/src/types.ts`, `packages/cache-manager/src/service.ts` |

## 제약 사항

- 기본 메모리 저장소는 프로세스 로컬이며 클러스터 안전하지 않습니다. 다중 인스턴스 배포는 Redis 저장소나 다른 공유 custom store가 필요합니다.
- Redis 저장소 값은 `RedisStore`가 `JSON.stringify(...)`와 `JSON.parse(...)`를 사용하므로 JSON 호환 형태여야 합니다.
- 캐시 무효화는 키 기반만 지원합니다. 기본 계약은 interceptor 계층에서 tag 기반이나 wildcard 무효화를 제공하지 않습니다.
- 메모리 저장소의 TTL 강제는 타이머 기반이 아니라 접근 기반의 lazy 방식입니다.
- 캐시 패키지는 `CacheStore` 인터페이스로 확장을 정의합니다. custom store는 `get`, `set`, `del`, `reset`을 구현해야 하며, 리소스를 소유하는 store는 optional `close()` 또는 `dispose()` teardown도 구현하는 것이 좋습니다.
