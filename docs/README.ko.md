# docs

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


이 디렉토리는 Konekti의 패키지 통합 문서 홈입니다.

여러 패키지에 걸쳐 있는 프레임워크 수준의 정보는 이곳을 사용하세요. 패키지 로컬 API, 예제, 주의사항은 `packages/*/README.md` 및 `README.ko.md`에 속합니다.

## 읽기 순서

1. `getting-started/quick-start.md`
2. `getting-started/bootstrap-paths.md`
3. `getting-started/generator-workflow.md`
4. `concepts/architecture-overview.md`
5. `concepts/http-runtime.md`
6. `concepts/di-and-modules.md`
7. `concepts/decorators-and-metadata.md`
8. `concepts/config-and-environments.md`
9. `concepts/lifecycle-and-shutdown.md`
10. `concepts/auth-and-jwt.md`
11. `concepts/openapi.md`
12. `concepts/observability.md`
13. `concepts/security-middleware.md`
14. `concepts/transactions.md`
15. `concepts/error-responses.md`
16. `reference/package-surface.md`
17. `reference/toolchain-contract-matrix.md`
18. `operations/testing-guide.md`
19. `operations/release-governance.md`

## 섹션 (Sections)

### getting-started/

- 부트스트랩 경로 및 시작 구조
- CLI 생성기 워크플로우
- 새 앱을 위한 빠른 시작

### concepts/

- 런타임 흐름 및 패키지 경계
- DI 및 모듈 가시성 규칙
- 데코레이터 및 메타데이터 소유권
- 설정 및 환경 계약
- 라이프사이클 및 셧다운 모델
- 인증 소유권
- HTTP 동작 및 패키지 간 계약
- OpenAPI 생성 모델
- 관측 가능성 및 상태 확인/준비성 의미론
- 보안 미들웨어 기본값 및 경계
- 통합 전반의 트랜잭션 의미론
- 표준 에러 응답 및 노출 규칙

### operations/

- 테스트 정책
- 릴리스 거버넌스
- 현재 동작에 영향을 주는 벤치마크/결정 사항 노트

### reference/

- 패키지 외부 인터페이스 (Surface)
- 명명 규칙
- 툴체인 계약
- 재사용 가능한 예시 슬라이스

## 권한 규칙

- 문서가 출시된 동작을 설명한다면, 이곳이나 패키지 README에 속합니다.
- 문서가 향후 작업을 설명한다면, GitHub Issue에 속합니다.
- 주제를 하나의 패키지가 소유하고 있다면, 이곳에 중복 작성하기보다 패키지 README를 우선하세요.
