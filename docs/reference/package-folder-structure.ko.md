# package folder structure

<p><strong><kbd>한국어</kbd></strong> <a href="./package-folder-structure.md"><kbd>English</kbd></a></p>

저장소 규약에 따라 `packages/*/src`에서 사용하는 표준 레이아웃과 경로 역할을 정리한 참조 문서입니다.

## canonical tree

```text
src/
├── index.ts
├── module.ts
├── service.ts
├── types.ts
├── tokens.ts
├── errors.ts
├── status.ts
├── decorators/
├── transports/
├── stores/
├── adapters/
├── node/
├── web/
└── internal/
```

## path roles

| path | role |
| --- | --- |
| `src/index.ts` | 공개 export 표면만 두며, 엔트리포인트에 구현 코드를 넣지 않습니다. |
| `src/module.ts` | 모듈 정의, 프로바이더 등록, 패키지 wiring을 담당합니다. |
| `src/service.ts` | 복잡도가 낮은 패키지의 기본 서비스 진입점입니다. |
| `src/types.ts` | 공개 타입과 인터페이스를 둡니다. |
| `src/tokens.ts` | DI 토큰과 관련 상수를 둡니다. |
| `src/errors.ts` | 패키지 전용 예외와 오류 타입을 둡니다. |
| `src/status.ts` | 헬스, readiness, 상태 보조 로직을 둡니다. |
| `src/decorators/` | 사용자 대상 데코레이터와 관련 헬퍼를 둡니다. |
| `src/transports/` | 프로토콜 변형별 전송 구현을 둡니다. |
| `src/stores/` | 저장소 백엔드 구현을 둡니다. |
| `src/adapters/` | 서드파티 API와 fluo 계약 사이의 브릿지를 둡니다. |
| `src/node/` | Node 전용 런타임 코드를 둡니다. |
| `src/web/` | 웹 표준 또는 edge-safe 런타임 코드를 둡니다. |
| `src/internal/` | 공개 re-export가 금지된 내부 구현 상세를 둡니다. |

## placement rules

| condition | placement |
| --- | --- |
| 공개 API 파일이 예약된 루트 파일명과 일치함 | `src/` 루트에 둡니다. |
| 공개 API 책임이 여러 파일로 늘어남 | 대응하는 예약 폴더를 사용합니다. |
| 구현이 패키지 내부 전용임 | `src/internal/`에 둡니다. |
| 현재 책임이 작은 파일 하나뿐임 | 그룹이 커질 때까지 루트에 둡니다. |
| 코드가 런타임 전용임 | `src/node/` 또는 `src/web/`으로 분리합니다. |
| 테스트나 스냅샷 보조 파일임 | 대응 구현 옆에 함께 둡니다. |

## constraints

- `src/` 내부에서 파일을 이동해도 `index.ts`의 공개 re-export 계약은 바뀌면 안 됩니다.
- 명확한 그룹화 이유 없이 단일 파일 폴더를 만들지 않습니다.
- Root package entrypoint는 runtime-specific Node builtin을 eager import하면 안 됩니다. 해당 의존성은 `src/node/`에 두거나 runtime-specific 실행 경로 안에서 lazy resolution 뒤에 둡니다.
- `__snapshots__/`는 해당 테스트 옆에 유지합니다.
- 정식 패키지 목록은 [package-surface.ko.md](./package-surface.ko.md)를 따릅니다.
