# fluo 기여 가이드

<p align="center">
  <a href="./CONTRIBUTING.md">English</a>
  &nbsp;&middot;&nbsp;
  <a href="./CONTRIBUTING.ko.md">한국어</a>
</p>

fluo는 표준 TypeScript 데코레이터와 명시적인 계약 규율을 기반으로 구축되었습니다. 이 가이드는 환경 설정, 변경 사항 검증, 그리고 관리자 워크플로우를 설명합니다.

## 로컬 개발 환경 설정

fluo는 `pnpm`으로 관리되는 모노레포 구조를 사용합니다.

1. **사전 요구 사항**: Node.js 20 이상 및 `pnpm`.
2. **의존성 설치**:
   ```sh
   pnpm install
   ```
3. **모든 패키지 빌드**:
   ```sh
   pnpm build
   ```
4. **모노레포 전체 테스트 실행**:
   ```sh
   pnpm test
   ```

## 푸시 전 검증

PR을 생성하거나 업데이트하기 전에 다음 검증 명령어를 실행하세요.

```sh
pnpm verify
```

이 명령어는 `build`, `typecheck`, `lint`, `test`를 순차적으로 실행하며, 이는 CI에서 수행하는 체크와 동일합니다. 각 단계를 개별적으로 실행할 수도 있습니다.

```sh
pnpm build
pnpm typecheck
pnpm lint          # Biome — biome.json 참고
pnpm test
```

## 공개 API 문서화

`packages/*/src` 하위의 공개 API(public exports) 변경 시 저장소 전체의 TSDoc 최소 기준을 따라야 합니다.

- 변경된 모든 내보내기 심볼에 소스 레벨의 요약(summary)을 추가하세요.
- 내보낸 각 함수의 명명된 매개변수에 대해 `@param`을 추가하세요.
- `void`가 아닌 반환 타입을 가진 함수에 대해 `@returns`를 추가하세요.
- 호출자가 알 수 있는 동작, 진입점 사용법, 또는 생명주기 유의사항을 명확히 해야 할 경우 `@throws`, `@example`, `@remarks`를 사용하세요.
- README 예제는 시나리오 중심으로 유지하고, 소스의 `@example` 블록은 짧고 호버(hover) 시 읽기 편하게 유지하세요.

새로운 스타일을 고안하기 전에 다음의 저장소 내 참조 사례를 확인하세요.

- `packages/graphql/src/dataloader/dataloader.ts`
- `packages/cache-manager/src/decorators.ts`
- `packages/di/src/container.ts`
- [docs/contracts/public-export-tsdoc-baseline.ko.md](docs/contracts/public-export-tsdoc-baseline.ko.md)

`pnpm lint`에는 이제 `pnpm verify:public-export-tsdoc`이 포함되어 있어, PR 시점에 변경된 패키지 소스 파일에 대해서만 강제 적용됩니다.
밀린 TSDoc 누락분을 전수 조사해야 할 때는 `pnpm verify:public-export-tsdoc:baseline`을 사용하세요.

릴리스 준비 상태 검증은 이제 기본적으로 읽기 전용입니다.

- `pnpm verify:release-readiness`는 작업 트리를 더럽히지 않고 릴리스 게이트를 검증합니다.
- `pnpm generate:release-readiness-drafts`는 관리자가 쓰기 가능한 결과물이 필요할 때 `CHANGELOG.md` 초안 내용과 릴리스 준비 요약 아티팩트를 명시적으로 갱신합니다.

## 관리자 워크플로우

### 감독 하의 릴리스 오케스트레이션 (Supervised Release Orchestration)

fluo는 릴리스를 위해 `supervised-auto` 정책을 사용합니다.

1. **자동화**: 기여자는 릴리스 의도를 `.changeset/*.md`에 기록합니다. `main`에서는 `.github/workflows/release.yml`이 Version Packages PR을 생성하거나 갱신하고, 해당 PR이 merge된 뒤 변경된 공개 패키지를 npm trusted publishing/provenance와 함께 CI에서 배포합니다.
2. **감독**: 관리자는 Version Packages PR의 생성된 package changelog, package version bump, release-readiness 증거를 merge 전에 검토합니다. 중앙 감독자(supervisor)는 최종 검토와 정리 경계를 처리합니다.
3. **일관성**: 패키지에 수동으로 태그를 지정하거나 배포하지 마세요. 릴리스에 deprecated single-package workflow를 사용하지 마세요. 동작 계약과 릴리스 아티팩트의 무결성을 유지하기 위해 항상 정식 CI 전용 Changesets 흐름을 사용하세요.

### CLI 샌드박스 검증

`@fluojs/cli`나 코어 런타임 패키지를 수정할 때는 샌드박스 스크립트를 사용하여 엔드투엔드 동작을 확인하세요.

`packages/cli/` 내부:
- `pnpm sandbox:create`: 임시 디렉터리에 새로운 스타터 앱을 생성합니다.
- `pnpm sandbox:matrix`: 기본 앱, TCP 마이크로서비스, 혼합 스타터 기준선에 대해 대표적인 생성 프로젝트 스모크 테스트 수트를 실행합니다.
- `pnpm sandbox:verify`: 샌드박스 앱 내부에서 `build`, `typecheck`, `test`를 실행합니다.
- `pnpm sandbox:test`: 샌드박스 앱에 대해 통합 테스트를 실행합니다.
- `pnpm sandbox:clean`: 샌드박스 디렉터리를 제거합니다.

### 예제 검증

`examples/`의 표준 예제들은 워크스페이스의 최우선 구성원이자 검증 대상입니다. 이들은 모노레포 의존성 그래프, TypeScript 타입 체크, 그리고 Vitest 테스트 실행에 참여합니다.

- **타입 체크**: `pnpm typecheck`에는 `tsc -p examples/tsconfig.json --noEmit`이 포함됩니다. 예제들은 경로 매핑된 워크스페이스 패키지를 공유하므로, 에디터와 CI에서 예제 코드의 타입 오류를 포착할 수 있습니다.
- **테스트**: `pnpm test`는 `vitest run`을 실행하며, 여기에는 `vitest.config.ts`에 정의된 `examples` 프로젝트가 포함됩니다. 각 예제는 `src/app.test.ts`에 테스트를 가지고 있습니다.
- **의존성**: 각 예제는 `@fluojs/*` 패키지에 대해 `workspace:*` 의존성을 가진 `package.json`을 가집니다. 예제 의존성을 추가하거나 변경한 후에는 `pnpm install`을 실행하세요.

코어 패키지를 수정할 때는 예제가 여전히 통과하는지 확인하세요.

```sh
pnpm vitest run examples/
pnpm typecheck
```

### 워크트리(worktree) 사용

멀티태스킹이나 이슈 격리 처리를 위해 `git worktree` 사용을 권장합니다.
- 표준 워크트리 경로는 `.worktrees/`입니다.
- `git worktree add -b issue-123 .worktrees/issue-123 origin/main`

## 동작 계약 (Behavioral Contracts)

fluo는 엄격한 동작 계약을 유지합니다. PR을 열기 전에 다음 사항을 확인하세요.

1. 영향을 받는 패키지의 `README.md`를 읽었는지 확인.
2. [docs/contracts/behavioral-contract-policy.ko.md](docs/contracts/behavioral-contract-policy.ko.md)를 확인했는지 확인.
3. 런타임 동작이나 API 표면이 변경된 경우 문서를 업데이트했는지 확인.
4. 계약에 영향을 주는 변경 사항에 대해 회귀 테스트(regression tests)를 추가했는지 확인.

## 이슈 접수

- 프레임워크나 CLI에서 재현 가능한 오류는 **Bug Report**를 사용하세요.
- 개발자 경험 개선이나 리팩토링 제안은 **DX/Maintainability Request**를 사용하세요.
- 기능 요청의 경우, 구현 전에 설계를 논의하기 위해 이슈부터 시작하세요.

## PR 프로세스

- 모든 PR은 `main` 브랜치를 대상으로 해야 합니다.
- `.github/PULL_REQUEST_TEMPLATE.md`의 구조를 따르세요.
- 푸시하기 전에 로컬에서 모든 CI 체크가 통과하는지 확인하세요 — `pnpm verify` 실행.
