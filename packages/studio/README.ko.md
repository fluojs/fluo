# @fluojs/studio

<p><a href="./README.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

fluo 런타임 내보내기의 공유 플랫폼 snapshot을 파일 기반으로 확인하는 뷰어입니다.

## 목차

- [설치](#설치)
- [릴리스 정책](#릴리스-정책)
- [사용 시점](#사용-시점)
- [빠른 시작](#빠른-시작)
- [주요 패턴](#주요-패턴)
- [공개 API 개요](#공개-api-개요)
- [관련 패키지](#관련-패키지)
- [예제 소스](#예제-소스)

## 설치

```bash
pnpm add @fluojs/studio
```

배포된 패키지는 두 가지 caller-facing entrypoint를 제공합니다.

- `@fluojs/studio` / `@fluojs/studio/contracts`: snapshot 파싱, 필터링, Mermaid 내보내기 헬퍼
- `@fluojs/studio/viewer`: 패키징된 브라우저 뷰어 HTML 진입 파일

## 릴리스 정책

- `@fluojs/studio`는 fluo의 intended public publish surface에 포함되는 공개 배포 패키지입니다.
- Studio의 npm 설치 계약은 `pnpm add @fluojs/studio`이며, 저장소 내부 개발 경로는 계속 `pnpm --dir packages/studio dev`를 사용합니다.
- 이번 릴리스에서 지원하는 공개 패키지 표면은 파일 기반 뷰어와 문서화된 snapshot 소비 계약까지입니다. 내부 workspace 연결 방식은 지원되는 설치 경로가 아닙니다.

## 사용 시점

- **시각화**: 애플리케이션의 모듈 그래프와 의존성 체인을 탐색할 때.
- **진단**: 가이드된 힌트를 사용하여 플랫폼 수준의 설정 문제를 식별하고 해결할 때.
- **성능 분석**: 부트스트랩 타이밍을 분석하고 초기화 병목 지점을 찾을 때.
- **문서화**: 애플리케이션 아키텍처의 Mermaid 다이어그램을 생성할 때.

## 빠른 시작

Studio는 fluo CLI에서 내보낸 JSON 파일을 소비합니다.

1. **Snapshot 내보내기**:
   ```bash
   fluo inspect ./src/app.module.ts --json > snapshot.json
   ```

2. **Studio 실행**:
   ```bash
   pnpm --dir packages/studio dev
   ```

3. **파일 로드**: Studio 웹 인터페이스에 `snapshot.json` 파일을 드래그 앤 드롭합니다.

## 주요 패턴

### 초기화 문제 해결
**Diagnostics** 탭을 사용하여 런타임 부트스트랩 과정에서 수집된 이슈들을 확인합니다.
- 심각도(Error, Warning)별로 필터링합니다.
- `fixHint`를 통해 문제를 해결하기 위한 구체적인 조치 방법을 확인합니다.
- `dependsOn`을 통해 어떤 컴포넌트가 실패 지점을 차단하고 있는지 확인합니다.

### 아키텍처 다이어그램 내보내기
1. **Graph** 뷰로 이동합니다.
2. 시각화하려는 모듈이나 컴포넌트를 선택합니다.
3. **Export to Mermaid** 버튼을 사용하여 문서에 사용할 수 있는 텍스트 기반 다이어그램을 가져옵니다.

## 공개 API 개요

Studio는 주로 웹 애플리케이션이지만, 배포된 패키지는 도구/자동화가 사용할 수 있는 snapshot 소비 헬퍼도 함께 공개합니다.

| 규격 | 설명 |
|---|---|
| `PlatformShellSnapshot` | 애플리케이션 상태를 나타내는 핵심 데이터 구조입니다. |
| `PlatformDiagnosticIssue` | 플랫폼 오류 보고 및 수정을 위한 스키마입니다. |
| `parseStudioPayload(rawJson)` | CLI/export JSON을 Studio snapshot/timing envelope로 검증합니다. |
| `applyFilters(snapshot, filter)` | 원본 snapshot을 변경하지 않고 readiness/severity/query 필터를 적용합니다. |
| `renderMermaid(snapshot)` | 로드된 플랫폼 그래프를 Mermaid 텍스트로 변환합니다. |

### 배포 패키지 entrypoint

- `@fluojs/studio`: snapshot 파싱/필터링/렌더링용 루트 헬퍼 배럴
- `@fluojs/studio/contracts`: 계약 헬퍼를 직접 가져오고 싶은 도구용 명시적 서브패스
- `@fluojs/studio/viewer`: 브라우저 뷰어 번들의 `dist/index.html` 진입 파일

## 관련 패키지

- **[@fluojs/cli](../cli/README.ko.md)**: Studio 호환 데이터를 생성하기 위한 `inspect` 명령을 제공합니다.
- **[@fluojs/runtime](../runtime/README.ko.md)**: 진단 및 snapshot 데이터를 생성하는 엔진입니다.

## 예제 소스

- [main.ts](./src/main.ts) - 애플리케이션 진입점.
- [contracts.ts](./src/contracts.ts) - snapshot 소비를 위한 타입 정의.
