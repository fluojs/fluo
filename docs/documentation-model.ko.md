# 문서화 모델

<p><a href="./documentation-model.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 문서는 단계별 계획 문서들을 활성 소스에서 은퇴시킨 후, `konekti`가 지향하는 문서화 모델을 정의합니다.

## 목표

- 현재 제품의 실제 동작 원리를 구현 레포 내에 유지함
- 활발한 계획 및 후속 작업은 GitHub Issues로 이동함
- 루트 `README.md`를 단계별 기록이 아닌 프로젝트 진입점으로 만듦
- 주제별 프레임워크 가이드는 `docs/`를 사용함
- 패키지 로컬 API, 예시 및 주의 사항은 패키지 README를 사용함
- 레포 문서와 과거 계획 문서 간의 권위 중복을 줄임

## 권위 모델

### 1. 루트 `README.md`

루트 README는 다음 질문에 답해야 합니다:

- Konekti란 무엇인가?
- 누구를 위한 것인가?
- 가장 빠르게 시작하는 방법은?
- 어떤 패키지들이 공개 프레임워크 외형을 구성하는가?
- `docs/`의 다음 단계는 어디인가?
- 현재 프레임워크 형태 뒤에 숨겨진 짧은 결정 내러티브

루트 README는 단계별 상태, 하위 단계 완료 여부 또는 백로그 상태를 추적하지 않습니다.

### 2. `docs/`

`docs/`는 여러 패키지에 걸친 사용자용 프레임워크 문서를 보관합니다.

예시:

- 시작하기 및 부트스트랩 흐름
- 프레임워크 아키텍처 개요
- HTTP 런타임 동작
- 인증 및 JWT 전략 모델
- OpenAPI 동작
- 메트릭, 헬스 체크 및 준비성(readiness)
- 테스트 및 릴리스 워크플로
- 공개 툴체인 계약

`docs/`는 시스템 수준에서 "프레임워크가 오늘날 어떻게 작동하는지"를 담는 영구적인 공간입니다.

### 3. `packages/*/README.md` 및 `README.ko.md`

각 패키지 README는 패키지 고유의 정보를 관리합니다:

- 설치 지침
- 빠른 시작 예제
- 공개 export 및 계약
- 패키지별 주의 사항
- 주제가 여러 패키지에 걸쳐 있을 경우 상위 문서로의 링크

패키지 README가 프레임워크 전체의 소유권 경계를 상세히 재설명해서는 안 됩니다.

### 4. GitHub Issues

GitHub Issues는 활발한 계획 수립을 담당합니다:

- 백로그 항목
- 후속 작업
- 기능 제안
- 문서 부채
- 릴리스 작업
- 안정적인 문서 세트에 아직 반영되지 않은 디자인 논의

현재 동작이 아닌 미래의 작업을 설명하는 내용은 `docs/`가 아닌 Issue에 속합니다.

## 대상 디렉터리 모델

```text
konekti/
├── README.md                         # 프로젝트 진입점
├── docs/
│   ├── getting-started/
│   │   ├── quick-start.md
│   │   ├── bootstrap-paths.md
│   │   └── generator-workflow.md
│   ├── concepts/
│   │   ├── architecture-overview.md
│   │   ├── http-runtime.md
│   │   ├── di-and-modules.md
│   │   ├── auth-and-jwt.md
│   │   ├── openapi.md
│   │   ├── observability.md
│   │   └── transactions.md
│   ├── operations/
│   │   ├── testing-guide.md
│   │   ├── release-governance.md
│   │   └── manifest-decision.md
│   └── reference/
│       ├── package-surface.md
│       ├── toolchain-contract-matrix.md
│       ├── support-matrix.md
│       └── naming-and-file-conventions.md
└── packages/*/README*.md             # 패키지 레벨 정보
```

상세 파일명은 바뀔 수 있지만, 소유권 분할은 안정적으로 유지되어야 합니다:

- `README.md` -> 프로젝트 진입 및 결정 요약
- `docs/` -> 패키지 공통의 현재 동작 원리
- `packages/*/README*` -> 패키지 정보
- Issues -> 계획

## 마이그레이션 규칙

### `docs/`로 이동

`konekti-plan`의 내용이 다음을 설명할 때 `docs/`로 이동합니다:

- 안정적인 아키텍처 경계
- 사용자가 기여자가 지금 이해해야 할 런타임 동작
- 패키지 상호작용 규칙
- 문서화된 공개 툴체인 계약
- 정식 부트스트랩 및 생성기 흐름

### 패키지 README로 이동

다음 내용을 설명할 때는 패키지 README로 이동합니다:

- 단일 패키지의 API
- 특정 패키지의 설정 단계
- 특정 패키지에 국한된 예시
- 패키지별 에러, 기본값 또는 주의 사항

### GitHub Issues로 이동

다음 내용을 설명할 때는 Issue로 생성합니다:

- 아직 출시되지 않은 작업
- 개선 후보
- 릴리스 후속 조치
- 작성이 필요한 문서 공백
- 순서 지정 또는 백로그 순위

### 아카이브 또는 폐기

단계별 문서는 다음과 같은 경우 활성 읽기 경로에서 아카이브하거나 제거합니다:

- 전달 이력(history)
- 대체된 실행 노트
- 이미 출시된 작업에 대한 오래된 수락 기준
- 레포의 현실을 더 이상 반영하지 않는 로드맵 순서

## 즉시 마이그레이션 맵

### 루트 README

`README.md`를 다음 섹션 중심으로 다시 작성합니다:

1. Konekti란 무엇인가?
2. 빠른 시작
3. 공개 패키지 제품군
4. 핵심 사용 흐름 (`konekti new`, 런타임 부트스트랩, 생성기)
5. 프레임워크가 이렇게 형성된 이유
6. 문서 인덱스

### 추가 또는 재구성할 문서

- `docs/concepts/architecture-overview.md`를 최상위 개념 진입점으로 변환
- `konekti-plan/architecture/*`의 무거운 주제를 `docs/concepts/*`로 분리
- `konekti-plan/reference/*`의 프롬프트/부트스트랩/툴체인 참조를 `docs/getting-started/*` 또는 `docs/reference/*`로 이동
- 릴리스/테스트 가이드는 `docs/operations/*`에 유지

### 패키지 README

- 현재의 패키지 README 소유권 모델 유지
- 패키지 문서에서 프레임워크 전체의 중복 설명을 점진적으로 제거
- 주제가 여러 패키지에 걸쳐 있을 경우 패키지 문서에 관련 `docs/` 가이드 링크 추가

## 마이그레이션 후 읽기 순서

1. `README.md`
2. `docs/getting-started/quick-start.md`
3. `docs/concepts/architecture-overview.md`
4. 사용 중인 패키지의 README
5. `docs/concepts/` 또는 `docs/operations/`의 주제별 문서

## 유지 관리 규칙

- 출시된 동작을 설명하는 문서는 Issue에만 머물러서는 안 됨
- 미래의 작업을 설명하는 문서는 `docs/`에만 머물러서는 안 됨
- 모든 패키지 인터페이스 변경은 동일한 PR에서 패키지 README와 관련 `docs/` 주제를 업데이트해야 함
- 루트 README는 짧고 탐색 위주로 유지하며, 상세 내용은 `docs/`와 패키지 README에 둠

## 비목표

- 동일한 단계 구조를 가진 새로운 프라이빗 계획 레포 생성
- `docs/`를 백로그 트래커로 사용
- 모든 역사적인 단계 세부 사항을 활성 문서 트리로 복사

## 첫 번째 구현 단계

1. 루트 `README.md`를 프로젝트 허브로 재작성
2. `docs/getting-started/`, `docs/concepts/`, `docs/operations/`, `docs/reference/` 생성
3. `konekti-plan/architecture/*` 및 `konekti-plan/reference/*`에서 영구적인 자료 마이그레이션
4. 남은 라이브 후속 조치들을 GitHub Issues로 변환
5. 기본 문서 읽기 경로에서 `execution/` 제거
