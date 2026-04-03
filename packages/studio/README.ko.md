# @konekti/studio

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 내보내기의 공유 플랫폼 snapshot을 파일 기반으로 확인하는 뷰어입니다.

## 관련 문서

- `../cli/README.ko.md`
- `../../docs/concepts/platform-consistency-design.ko.md`
- `../../docs/concepts/observability.ko.md`
- `../../docs/getting-started/first-feature-path.ko.md`

## 제공 기능

- `konekti inspect --json`으로 내보낸 JSON 파일 로드
- 공유 런타임 `PlatformShellSnapshot` + `PlatformDiagnosticIssue` 스키마 직접 소비
- snapshot 데이터 기반 플랫폼 컴포넌트 의존 체인/ Mermaid 출력 렌더링
- 컴포넌트 readiness/health/ownership/details 및 의존 관계 표시
- `fixHint`/`dependsOn`을 포함한 diagnostics 이슈를 1급 필드로 표시
- 검색 + 컴포넌트 readiness 필터 + diagnostics severity 필터
- timing 페이로드가 있을 때 부트스트랩 타이밍 표시
- 로드한 JSON/ Mermaid 출력 복사·다운로드 헬퍼 제공

## Inspect -> Studio 워크플로우

`@konekti/studio`는 실행 중인 앱을 직접 크롤링하지 않습니다. 공식 경로는 file-first입니다.

1. 확인하려는 앱에서 runtime snapshot을 export합니다.
2. Studio를 로컬에서 실행합니다.
3. export한 JSON snapshot(필요하면 timing JSON도 함께)을 Studio에 로드합니다.

예시:

```bash
konekti inspect ./src/app.module.mjs --json > ./tmp/platform-snapshot.json
konekti inspect ./src/app.module.mjs --timing > ./tmp/platform-timing.json
pnpm --dir packages/studio dev
```

Studio에서는 `--json`으로 만든 파일을 기본 snapshot으로 불러오고, `--timing` 파일이 있다면 선택적으로 함께 로드합니다.

## 무엇부터 봐야 하나

snapshot을 열었다면 먼저 아래를 확인하세요.

- 전체 readiness / health
- component dependency chain
- `fixHint`와 `dependsOn`이 포함된 diagnostics
- 외부 리소스 ownership details
- 복사 가능한 dependency graph가 필요할 때 Mermaid 출력

## 실행

```bash
pnpm --dir packages/studio dev
```

빌드:

```bash
pnpm --dir packages/studio build
```
