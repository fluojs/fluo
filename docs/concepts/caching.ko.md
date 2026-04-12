# 캐싱

<p><a href="./caching.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

성능은 fluo의 핵심 원칙 중 하나입니다. fluo의 캐싱 시스템은 **투명한 HTTP 응답 캐싱**과 **프로그래밍 방식의 애플리케이션 레벨 캐싱**을 위한 통합 인터페이스를 제공하며, 인메모리(In-memory) 및 분산 Redis 백엔드를 모두 지원합니다.

## 왜 fluo의 캐싱인가요?

- **투명한 성능 향상**: 단일 인터셉터 설정만으로 비용이 많이 드는 `GET` 요청의 응답 시간을 개선할 수 있습니다.
- **신원 인식(Identity-Aware) 캐싱**: 인증된 사용자(`principal.subject`)별로 캐시된 응답을 자동 격리하여 사용자 간 데이터 유출을 방지합니다.
- **스마트 무효화**: 데이터가 변경되는 시점(POST/PUT/DELETE)에 `@CacheEvict()`를 사용하여 특정 키를 자동으로 삭제함으로써, 수동 작업 없이도 캐시 신선도를 유지합니다.
- **"Remember" 패턴**: "데이터가 없으면 조회 후 캐싱"하는 복잡한 워크플로우를 한 줄로 단순화하는 `cache.remember()` API를 내장하고 있습니다.

## 책임 분담

- **`@fluojs/cache-manager` (파사드)**: 수동 작업을 위한 `CacheService`와 HTTP를 위한 `CacheInterceptor`를 정의합니다. 플러그형 저장소 아키텍처를 관리합니다.
- **`@fluojs/http` (후크)**: 요청 처리 과정에서 인터셉터가 캐시를 읽고 쓸 수 있도록 필요한 수명 주기 후크(Lifecycle hooks)를 제공합니다.
- **`@fluojs/redis` (분산 저장소)**: 여러 애플리케이션 인스턴스에 걸쳐 캐시를 유지할 수 있게 해주는 선택적 패키지입니다. `CacheModule`은 기본 Redis 경로를 그대로 사용할 수도 있고, 캐시 트래픽을 전용 연결로 분리해야 할 때 `redis.clientName`으로 이름 있는 등록을 가리킬 수도 있습니다.

## 일반적인 워크플로우

### 1. 투명한 HTTP 캐싱
제품 카탈로그나 공개 프로필과 같이 트래픽이 많은 엔드포인트의 경우, 비즈니스 로직을 전혀 수정하지 않고도 캐싱을 활성화할 수 있습니다.

```typescript
@Get('/')
@UseInterceptors(CacheInterceptor)
@CacheTTL(600) // 10분 동안 캐싱
async getProducts() {
  return this.service.findAll(); // 캐시 미스 발생 시에만 실행됨
}
```

### 2. 수동 애플리케이션 캐싱
복잡한 계산이나 외부 API 호출의 경우, 서비스 내에서 직접 `CacheService`를 사용하세요.

```typescript
async getExchangeRates() {
  return this.cache.remember('rates:usd', async () => {
    return this.externalApi.fetchRates();
  }, 3600); // 1시간 동안 캐싱
}
```

### 3. 신원 바인딩 키 (Identity-Bound Keys)
fluo의 기본 키 생성 전략은 보안을 최우선으로 합니다. `RequestContext.principal`이 존재하는 경우, 캐시 키에 사용자의 식별자(Subject)가 자동으로 포함됩니다.
- **기본 키**: `라우트 경로 + 쿼리 파라미터(활성화된 경우) + principal_subject`
- **결과**: 사용자 A와 사용자 B는 동일한 URL에 접근하더라도 서로의 캐시된 응답을 절대 볼 수 없습니다.

## 핵심 경계

- **지연 만료 (Lazy Expiry)**: 성능 극대화를 위해 TTL(Time-To-Live) 만료는 백그라운드 타이머 대신 액세스 시점에 확인됩니다 (메모리 저장소 기준).
- **클러스터 안전성**: 다중 인스턴스 배포 환경에서는 **반드시** Redis 저장소를 사용해야 합니다. 메모리 저장소는 각 프로세스에 로컬로 존재하며 동기화되지 않습니다.
- **기본적으로 GET 전용**: 안전하고 멱등(Idempotent)한 동작을 보장하기 위해 `CacheInterceptor`는 `GET` 요청만 캐싱합니다.

## 다음 단계

- **구현 세부 사항**: [Cache Manager 패키지](../../packages/cache-manager/README.ko.md)에서 더 깊이 있게 알아보세요.
- **확장성**: [Redis 패키지](../../packages/redis/README.ko.md)를 사용하여 분산 캐싱을 구성해 보세요.
