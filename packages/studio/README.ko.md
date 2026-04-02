# @konekti/studio

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

Konekti 런타임 내보내기의 공유 플랫폼 snapshot을 파일 기반으로 확인하는 뷰어입니다.

## 제공 기능

- `konekti inspect --json`으로 내보낸 JSON 파일 로드
- 공유 런타임 `PlatformShellSnapshot` + `PlatformDiagnosticIssue` 스키마 직접 소비
- snapshot 데이터 기반 플랫폼 컴포넌트 의존 체인/ Mermaid 출력 렌더링
- 컴포넌트 readiness/health/ownership/details 및 의존 관계 표시
- `fixHint`/`dependsOn`을 포함한 diagnostics 이슈를 1급 필드로 표시
- 검색 + 컴포넌트 readiness 필터 + diagnostics severity 필터
- timing 페이로드가 있을 때 부트스트랩 타이밍 표시
- 로드한 JSON/ Mermaid 출력 복사·다운로드 헬퍼 제공

## 실행

```bash
pnpm --dir packages/studio dev
```

빌드:

```bash
pnpm --dir packages/studio build
```
