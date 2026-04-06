# Package Source Folder Structure

## 개요

Konekti 모노레포의 각 패키지는 `src/` 내에 아래 표준 폴더 구조를 따른다.
모든 폴더가 모든 패키지에 필요한 것은 아니며, 해당 책임이 있는 파일이 2개 이상일 때만 폴더를 생성한다.

## 표준 루트 파일

`src/` 바로 아래에 위치하는 파일들:

| 파일 | 책임 |
|------|------|
| `index.ts` | 공개 API 진입점. `re-export` 전용, 구현 금지 |
| `module.ts` | NestJS `DynamicModule` 설정 |
| `service.ts` | 단일 핵심 서비스 (복잡도가 낮은 패키지) |
| `types.ts` | 공개 타입 정의 |
| `tokens.ts` | DI 토큰 |
| `errors.ts` | 에러 클래스 |
| `status.ts` | 헬스/상태 지시자 |

## 표준 하위 폴더

아래 폴더명은 예약된 책임 이름이다. 해당 책임의 파일이 생기면 반드시 이 이름을 사용한다.

### `decorators/`

사용자 facing 데코레이터와 metadata reader.

- `decorators.ts` → `decorators/decorators.ts` 또는 `decorators/index.ts`
- `metadata.ts` → `decorators/metadata.ts`

이미 `decorators/` 를 사용하는 패키지: `serialization`, `dto`

### `transports/`

교환 가능한 전송 구현체. 패키지가 여러 transport 백엔드를 지원할 때 사용.

이미 이 패턴을 사용하는 패키지: `microservices` (grpc, kafka, mqtt, nats, rabbitmq, redis, tcp)

### `stores/`

교환 가능한 저장소 백엔드. 패키지가 여러 store 구현체를 제공할 때 사용.

이 패턴을 사용하는 패키지: `cache-manager` (memory, redis)

### `buses/`

메시지 버스 구현체. CQRS 패턴의 command/event/query/saga bus.

이 패턴을 사용하는 패키지: `cqrs`

### `providers/`

Provider 구현체 (팩토리 포함). 주로 metrics, telemetry 계열 패키지.

이 패턴을 사용하는 패키지: `metrics`

### `adapters/`

외부 라이브러리 어댑터/심. 서드파티 라이브러리를 패키지 내부 인터페이스에 맞게 감싸는 코드.

이미 `adapters/` 를 사용하는 패키지: `dto`, `cli`

### `middleware/`

HTTP 미들웨어 함수. `http` 패키지 전용.

### `dispatch/`

HTTP 디스패치 파이프라인. `http` 패키지 전용.

### `node/`

Node.js 플랫폼 전용 구현체. 웹 표준 런타임과 분리할 때 사용.

이 패턴을 사용하는 패키지: `runtime`, `websocket`

### `internal/`

패키지 내부 전용 구현. `index.ts` 에서 re-export 금지.

`internal/` 내 파일은 패키지 외부에서 직접 import하면 안 된다.

## 파일 배치 결정 트리

```
새 파일을 어디에 놓을까?
│
├─ 공개 API에 노출되는가?
│   ├─ YES → src/ 루트 표준 파일 목록과 비교
│   │         (index, module, service, types, tokens, errors, status)
│   │         → 해당하면 루트, 아니면 아래 계속
│   └─ NO → internal/ 
│
├─ 같은 책임의 파일이 이미 1개 이상 있는가?
│   ├─ YES → 그 파일이 어느 폴더에 있는지 확인 → 같은 폴더
│   └─ NO → 아래 계속
│
├─ 표준 폴더명 매핑 확인
│   ├─ 데코레이터/메타데이터 → decorators/
│   ├─ transport 구현체 → transports/
│   ├─ store 구현체 → stores/
│   ├─ bus 구현체 → buses/
│   ├─ provider/factory → providers/
│   ├─ 외부 라이브러리 어댑터 → adapters/
│   ├─ HTTP 미들웨어 → middleware/
│   ├─ HTTP 디스패치 → dispatch/
│   ├─ Node.js 전용 → node/
│   └─ 위 어느 것도 아님 → src/ 루트
```

## 불변 규칙

1. **`index.ts` 공개 API는 폴더 재구조화 시 변경 금지** — 파일을 이동해도 `index.ts`의 re-export 시그니처는 그대로 유지한다.
2. **테스트 파일은 구현 파일과 같은 폴더에 위치** — `foo.ts`가 `transports/foo.ts`로 이동하면 `foo.test.ts`도 `transports/foo.test.ts`로 이동한다.
3. **`__snapshots__`는 테스트 파일과 같은 폴더** — 자동 생성 경로를 유지한다.
4. **단일 파일이면 폴더 불필요** — 해당 책임의 파일이 1개뿐이면 루트에 유지한다.

## 이미 잘 구조화된 패키지 예시

### `cli`
```
src/
├── commands/
├── generators/
├── transforms/
├── new/
├── fixtures/
└── cli.ts, index.ts, types.ts, ...
```

### `core`
```
src/
├── metadata/
└── decorators.ts, types.ts, ...
```

### `serialization`
```
src/
├── decorators/
└── serialize.ts, serializer-interceptor.ts, ...
```

### `terminus`
```
src/
├── indicators/
└── health-check.ts, module.ts, ...
```
