# 릴리즈 후보 요약

<p><a href="./release-candidate-summary.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>


- [x] 정식 부트스트랩 문서 — 빠른 시작 가이드에서 공개 `pnpm add -g @konekti/cli` + `konekti new` 경로를 문서화함.
- [x] 레포 로컬 스모크 경로 문서 — 레포 로컬 부트스트랩 경로를 테스트 지원 전용으로 문서화함.
- [x] 스타터 형태 및 런타임 소유권 — 생성된 스타터는 런타임 소유의 부트스트랩 헬퍼를 사용하며 헬스 체크, 메트릭, OpenAPI 인터페이스를 포함함.
- [x] 지원 등급 문구 일치 — 프롬프트 코드와 공개 문서에서 동일한 권장(recommended)/공식(official)/프리뷰(preview) 등급 용어를 사용함.
- [x] 툴체인 계약 고정 — 툴체인 계약 매트릭스를 공개(public)/생성됨(generated)/내부전용(internal) 상태로 고정함.
- [x] 매니페스트 벤치마크 증거 — 릴리스 문서가 여전히 벤치마크 기반의 매니페스트 결정 스냅샷을 가리킴.
- [x] Dist 기반 패키지 엔트리포인트 — CLI 매니페스트와 바이너리가 dist 기반의 공개 엔트리포인트를 증명함.

- 실행된 명령: `pnpm typecheck`, `pnpm build`, `pnpm test`
