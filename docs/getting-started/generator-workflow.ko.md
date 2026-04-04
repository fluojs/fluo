# 생성기 워크플로우 (generator workflow)

<p><a href="./generator-workflow.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 Konekti의 CLI 생성기 시스템과 사용 가능한 스키매틱(schematics)에 대해 설명합니다.

## 명령어 구문

```sh
konekti generate <schematic> <name>
konekti g <schematic> <name>
```

## 사용 가능한 스키매틱

| 스키매틱 | 별칭 (Alias) | 와이어링 |
| --- | --- | --- |
| `controller` | `co` | auto |
| `guard` | `gu` | auto |
| `interceptor` | `in` | auto |
| `middleware` | `mi` | auto |
| `module` | `mo` | manual |
| `repository` | `repo` | auto |
| `request-dto` | `req` | manual |
| `response-dto` | `res` | manual |
| `service` | `s` | auto |

### 와이어링 동작 (wiring behavior)

생성기는 두 가지 와이어링 동작 중 하나를 따릅니다:

- **auto** — 생성된 클래스가 도메인 모듈에 자동 등록됩니다. 모듈 파일이 아직 없으면 CLI가 새로 생성합니다. 모듈의 `controllers`, `providers`, 또는 `middleware` 배열이 자동으로 업데이트됩니다.
- **manual** — 파일만 생성됩니다. 생성된 클래스는 어디에도 자동 등록되지 않습니다. 모듈이나 컨트롤러에 직접 연결해야 합니다. CLI는 생성 후 구체적인 다음 단계 힌트를 출력합니다.

생성기를 실행하면 CLI 출력에 다음이 포함됩니다:
1. 생성된 각 파일에 대한 `CREATE` 라인.
2. 클래스가 자동 등록되었는지 수동 와이어링이 필요한지를 나타내는 **Wiring** 상태 라인.
3. 권장 후속 작업(예: `pnpm typecheck` 실행, DTO import 등)이 포함된 **Next steps** 힌트.

## 생성 규칙

- **언어**: 모든 파일은 TypeScript로 생성됩니다.
- **명명**: 파일명은 kebab-case를, 클래스명은 PascalCase를 사용합니다.
- **위치**: 스타터 애플리케이션에서 파일은 기본적으로 `src/` 디렉토리에 작성됩니다.
- **모듈 업데이트**: `auto` 와이어링을 가진 생성기는 새 컴포넌트를 적절한 모듈에 자동 등록합니다. `manual` 와이어링을 가진 생성기는 파일만 생성하며, 직접 연결해야 합니다.

### 예시 출력

- `user.controller.ts`
- `user.service.ts`
- `user.repo.ts`
- `user.request.dto.ts`
- `user.response.dto.ts`

## 구현 철학

- **세분화된 생성**: 개별 생성기를 사용하여 애플리케이션 컴포넌트를 구축합니다.
- **DTO 분리**: 명확한 API 계약을 위해 요청(request) 및 응답(response) DTO를 별개로 유지합니다.
- **단일 리소스 지양**: 단순함을 유지하기 위해 현재 CLI는 복잡한 "resource" 생성기(예: `g resource`)를 피하고 있습니다.
- **중립성**: 스캐폴딩은 패키지 매니저 전용 락파일과 명령어를 제외하고는 패키지 매니저 중립적(neutral)으로 유지됩니다.

## 모듈 엔트리포인트 네이밍 거버넌스

생성된 스니펫과 마이그레이션 힌트는 저장소 전역 공개 모듈 문법 계약을 따릅니다.

- 런타임 모듈 엔트리포인트: `forRoot(...)`, 필요 시 `forRootAsync(...)`, `register(...)`, `forFeature(...)`
- helper/builder 전용: `create*`

CLI 사용자 노출 네이밍 가이드를 추가/수정할 때는 `../reference/package-surface.ko.md`를 단일 기준(source-of-truth)으로 사용하세요.

## 추가 정보

- `./quick-start.ko.md`
- `./bootstrap-paths.ko.md`
- `../reference/toolchain-contract-matrix.ko.md`
