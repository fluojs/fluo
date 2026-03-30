# 생성기 워크플로우 (generator workflow)

<p><a href="./generator-workflow.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 가이드는 Konekti의 CLI 생성기 시스템과 사용 가능한 스키매틱(schematics)에 대해 설명합니다.

## 명령어 구문

```sh
konekti generate <schematic> <name>
konekti g <schematic> <name>
```

## 사용 가능한 스키매틱

| 스키매틱 | 별칭 (Alias) |
| --- | --- |
| `controller` | `co` |
| `guard` | `gu` |
| `interceptor` | `in` |
| `middleware` | `mi` |
| `module` | `mo` |
| `repository` | `repo` |
| `request-dto` | `req` |
| `response-dto` | `res` |
| `service` | `s` |

## 생성 규칙

- **언어**: 모든 파일은 TypeScript로 생성됩니다.
- **명명**: 파일명은 kebab-case를, 클래스명은 PascalCase를 사용합니다.
- **위치**: 스타터 애플리케이션에서 파일은 기본적으로 `src/` 디렉토리에 작성됩니다.
- **모듈 업데이트**: 생성기는 새 컴포넌트를 적절한 모듈에 자동으로 등록합니다.

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

## 추가 정보

- `./quick-start.ko.md`
- `./bootstrap-paths.ko.md`
- `../reference/toolchain-contract-matrix.ko.md`
