# package folder structure (패키지 폴더 구조)

<p><a href="./package-folder-structure.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 참조 가이드는 Konekti 모노레포 내 패키지들의 표준 폴더 구조를 정의합니다. `packages/` 내의 모든 패키지는 일관성과 유지보수성을 위해 이 규칙을 따라야 합니다.

## 표준 루트 파일

다음 파일들은 `src/` 디렉토리 바로 아래에 위치해야 합니다.

| 파일 | 책임 |
| --- | --- |
| **`index.ts`** | 공개 API 진입점입니다. re-export 전용이며 구현 코드를 작성하지 않습니다. |
| **`module.ts`** | 런타임 모듈 정의 및 프로바이더 등록입니다. |
| **`service.ts`** | 복잡도가 낮은 패키지의 기본 서비스입니다. |
| **`types.ts`** | 공개적으로 내보내는 타입 및 인터페이스입니다. |
| **`tokens.ts`** | 의존성 주입 토큰 (심볼 또는 상수)입니다. |
| **`errors.ts`** | 패키지 전용 예외 클래스입니다. |
| **`status.ts`** | 헬스 지시자 및 준비 상태 체크입니다. |

## 예약된 폴더 이름

패키지에서 특정 책임에 대해 여러 파일이 필요한 경우, 다음 예약된 폴더 이름을 사용하세요.

### `decorators/`
사용자 대상 데코레이터 및 메타데이터 리더입니다.
- *예시*: `@konekti/serialization`, `@konekti/validation`.

### `transports/`
교차 프로토콜 지원을 위한 플러그형 전송 구현체입니다.
- *예시*: `@konekti/microservices` (Kafka, RabbitMQ 등).

### `stores/`
플러그형 저장소 백엔드입니다.
- *예시*: `@konekti/cache-manager` (Memory, Redis).

### `adapters/`
서드파티 라이브러리와 내부 인터페이스 간의 브릿지입니다.
- *예시*: `@konekti/cli`, `@konekti/passport`.

### `node/` / `web/`
Node.js 전용 로직과 웹 표준 로직을 분리하기 위해 사용되는 플랫폼별 코드입니다.
- *예시*: `@konekti/runtime`, `@konekti/websockets`.

### `internal/`
프레임워크 내부 구현 상세입니다. 이 파일들은 `index.ts`에서 **내보내지 않아야(re-export)** 합니다.

## 파일 배치 결정 트리

```text
새 파일을 어디에 놓아야 할까요?
│
├─ 공개 API의 일부인가요?
│  ├─ 예 → 루트 파일(index, module, types 등)과 일치하나요?
│  │      ├─ 예 → src/ 루트에 배치합니다.
│  │      └─ 아니오 → 예약된 폴더 이름을 확인합니다.
│  └─ 아니오 → internal/ 에 배치합니다.
│
├─ 이미 같은 책임을 가진 파일이 2개 이상인가요?
│  ├─ 예 → 해당 폴더를 생성하거나 사용합니다.
│  └─ 아니오 → 복잡도가 커질 때까지 src/ 루트에 유지합니다.
```

## 불변 규칙

1.  **안정적인 공개 API**: `src/` 내에서 파일을 이동해도 `index.ts`의 re-export 시그니처가 변경되어서는 안 됩니다.
2.  **테스트 근접성**: 테스트 파일(`*.test.ts`)은 해당 구현 파일과 동일한 폴더에 위치해야 합니다.
3.  **스냅샷**: `__snapshots__` 디렉토리는 항상 해당 테스트와 함께 위치합니다.
4.  **단일 파일 폴더 금지**: 파일이 하나뿐인 경우 폴더를 생성하지 마세요.

---

전체 패키지 목록에 대해서는 [package-surface.ko.md](./package-surface.ko.md)를 참조하세요.
