# fluo 문서 포털

<p align="center">
  <strong>어떠한 규모에서도 예측 가능한, 표준 우선(Standard-First) 백엔드를 구축하세요.</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <strong>한국어</strong>
</p>

fluo 문서 허브에 오신 것을 환영합니다. 간단한 REST API부터 복잡한 마이크로서비스 아키텍처까지, 이 가이드를 통해 현대적인 TypeScript의 강력한 기능을 최대한 활용할 수 있습니다.

## 🏁 시작하기

fluo가 처음이라면, 몇 분 안에 애플리케이션을 실행할 수 있는 다음 단계부터 시작하세요.

- **[빠른 시작 (Quick Start)](./getting-started/quick-start.ko.md)**: 표준 설치 → `new` → `dev` 경로.
- **[첫 기능 구현 경로](./getting-started/first-feature-path.ko.md)**: 기본 템플릿을 넘어선 실제 도메인 로직 구현.
- **[부트스트랩 및 시작 절차](./getting-started/bootstrap-paths.ko.md)**: fluo가 애플리케이션 수명 주기와 초기화를 처리하는 방식.
- **[CLI 워크플로우](./getting-started/generator-workflow.ko.md)**: 일관성 유지를 위한 제너레이터(Generator) 활용법.
- **[용어 사전 및 멘탈 모델](./reference/glossary-and-mental-model.ko.md)**: 프레임워크의 핵심 개념과 언어.

## 🧠 핵심 개념

fluo의 설계 철학과 그 이면의 "왜"와 "어떻게"를 이해합니다.

### 아키텍처 및 설계

- **[아키텍처 개요](./concepts/architecture-overview.ko.md)**: 패키지 경계와 요청(Request)의 흐름.
- **[표준 데코레이터](./concepts/decorators-and-metadata.ko.md)**: 우리가 TC39 표준을 위해 레거시 플래그를 버린 이유.
- **[의존성 주입 (DI)](./concepts/di-and-modules.ko.md)**: 읽기 쉽고 테스트 가능한 명시적 DI 패턴.
- **[플랫폼 일관성 설계](./concepts/platform-consistency-design.ko.md)**: 모든 공식 패키지가 따라야 하는 범용 계약.
- **[CQRS](./concepts/cqrs.ko.md)**: 확장 가능한 아키텍처를 위한 명령과 쿼리의 분리.

### 런타임 및 HTTP

- **[HTTP 런타임](./concepts/http-runtime.ko.md)**: 라우팅, 미들웨어, 어댑터 독립적인 요청 처리.
- **[수명 주기 및 종료](./concepts/lifecycle-and-shutdown.ko.md)**: 결정론적 시작, 헬스 시그널링, 그레이스풀 종료.
- **[개발 리로드 아키텍처](./concepts/dev-reload-architecture.ko.md)**: 프로세스 재시작과 설정 인프로세스 리로드의 분리.
- **[설정 및 환경](./concepts/config-and-environments.ko.md)**: 환경별로 검증된 타입 안전한 설정 관리.
- **[에러 처리 및 응답](./concepts/error-responses.ko.md)**: 예측 가능한 API 실패 모드를 위한 표준화된 에러 형식.

### 데이터 및 통합

- **[트랜잭션 관리](./concepts/transactions.ko.md)**: Prisma, Drizzle, Mongoose에서의 원자적 연산.
- **[캐싱](./concepts/caching.ko.md)**: HTTP 응답 캐싱 및 프로그래매틱 애플리케이션 레벨 캐싱.
- **[OpenAPI](./concepts/openapi.ko.md)**: 라우트 기반 자동 OpenAPI 3.1.0 문서 생성.

### 보안 및 인증

- **[인증 및 JWT](./concepts/auth-and-jwt.ko.md)**: 전략 독립적인 신원 확인 및 라우트 보호.
- **[보안 미들웨어](./concepts/security-middleware.ko.md)**: API 보호를 위한 최선의 실천 방법.

### 관찰 가능성

- **[관찰 가능성 (Observability)](./concepts/observability.ko.md)**: 메트릭, 헬스 체크, 트레이싱을 위한 내장 패턴.

## 🛠️ 운영 및 거버넌스

fluo 패키지의 유지보수와 릴리스를 위한 표준, 정책, 운영 가이드입니다.

- **[테스트 전략](./operations/testing-guide.ko.md)**: 유닛 테스트부터 전체 통합 테스트 모음까지.
- **[Behavioral Contract Policy](./operations/behavioral-contract-policy.ko.md)**: 문서화된 런타임 동작을 묶는 binding 규칙.
- **[Release Governance](./operations/release-governance.ko.md)**: 릴리스 표준, 버전 정책, 자동화된 게이트.
- **[Public Export TSDoc 기준선](./operations/public-export-tsdoc-baseline.ko.md)**: 변경된 public export에 대한 repo-wide 최소 작성 규칙.
- **[프로덕션 배포](./operations/deployment.ko.md)**: `pnpm dev`에서 실제 운영 환경으로의 전환.
- **[매니페스트 전략 결정](./operations/manifest-decision.ko.md)**: 패키지 매니페스트 구조와 그 이유.
- **[플랫폼 적합성 체크리스트](./operations/platform-conformance-authoring-checklist.ko.md)**: 플랫폼 일관성 패키지 작성 체크리스트.
- **[서드파티 확장 계약](./operations/third-party-extension-contract.ko.md)**: 커뮤니티 패키지가 따라야 하는 계약.
- **[NestJS 차이점 안내](./operations/nestjs-parity-gaps.ko.md)**: fluo가 NestJS와 다른 점과 그 이유에 대한 정직한 문서.

> **팁:** 공개 패키지의 기준 publish surface, release-readiness gate, CI 전용 단건 패키지 릴리스 운영 절차는 [Release Governance](./operations/release-governance.ko.md)를 참조하세요. preflight 검증 경로는 [테스트 전략](./operations/testing-guide.ko.md)과 함께 사용하세요.
>
> 런타임 이식 가능한 이메일 패키지 개요가 필요하다면 패키지 인벤토리의 `@fluojs/email`부터 확인하고, Node 전용 SMTP 경로는 명시적 서브패스 `@fluojs/email/node`를 패키지 문서와 chooser 가이드에서 따라가세요.

## 📚 참조 자료

심층적인 기술 명세 및 비교 자료입니다.

- **[패키지 선택 가이드](./reference/package-chooser.ko.md)**: 특정 작업에 적합한 도구 찾기.
- **[API 요약](./reference/package-surface.ko.md)**: 공개 패키지 패밀리, 런타임 범위, 패키지 책임을 정리한 기준 인벤토리.
- **[패키지 폴더 구조](./reference/package-folder-structure.ko.md)**: 모노레포 패키지의 표준 디렉토리 규칙.
- **[fluo new 지원 매트릭스](./reference/fluo-new-support-matrix.ko.md)**: 현재 스타터 계약과 더 넓게 문서화된 런타임/어댑터 생태계의 구분.
- **[호환성 매트릭스](./reference/toolchain-contract-matrix.ko.md)**: 버전, 런타임, 플랫폼 지원 현황.

## 🔄 fluo로 전환하기

다른 생태계에서 오셨나요? 여러분을 위한 가이드가 준비되어 있습니다.

- **[NestJS 마이그레이션 가이드](./getting-started/migrate-from-nestjs.ko.md)**: NestJS 개발자를 위한 단계별 전환 가이드.

---
### 다른 자료를 찾고 계신가요?
- **[실행 가능한 예제](../examples/README.ko.md)**: 실제 코드를 통해 fluo가 작동하는 모습을 확인하세요.
- **[패키지 README](../packages/)**: 각 모듈에는 자체적인 심층 문서가 포함되어 있습니다.
