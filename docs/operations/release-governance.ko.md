# 릴리스 거버넌스 (Release Governance)

<p>
  <strong>한국어</strong> | <a href="./release-governance.md">English</a>
</p>

이 문서는 fluo 생태계의 릴리스 표준, 안정성 계약 및 버전 관리 정책을 정의합니다. 프레임워크 업데이트가 예측 가능하고, 파괴적 변경 사항이 명확하게 전달되며, 공개 패키지가 높은 품질을 유지할 수 있도록 보장합니다.

## 이 문서가 필요한 경우

- **버전 계획**: 코드 변경 사항이 패키지 버전 관리(Semver)에 미치는 영향을 판단할 때.
- **패키지 승격**: 실험적(Experimental) 또는 미리보기(Preview) 상태의 패키지를 공식 지원 단계로 승격시킬 때.
- **CI/CD 구성**: 동작 계약이나 릴리스 준비도를 강제하는 자동화된 게이트를 업데이트할 때.
- **변경 이력(Changelog) 작성**: 프레임워크 동작의 변화를 정확하게 전달하기 위해 릴리스 주기에 참여할 때.

---

## 안정성 계약 (Stability Contract)

fluo는 패키지의 성숙도를 전달하기 위해 계층화된 안정성 모델을 사용합니다.

| 등급 | 안정성 | 설명 |
| :--- | :--- | :--- |
| **Official** | Stable | 전체 문서화가 완료되었고 프로덕션 준비가 끝났으며, 광범위한 통합 테스트를 통과한 상태입니다. |
| **Preview** | Functional | 기능적으로는 완성되었으나 문서화되지 않은 엣지 케이스가 있을 수 있으며 실무 예시가 제한적일 수 있습니다. |
| **Experimental** | Unstable | 초기 개발 단계로, API는 사전 고지나 마이그레이션 가이드 없이 변경될 수 있습니다. |

### 1.0 승격 기준
패키지가 `1.0` (Stable) 등급으로 승격되려면 다음 조건을 충족해야 합니다.
1.  **문서화**: 공개 API 인터페이스가 영어와 한국어로 모두 완벽하게 문서화되어야 합니다.
2.  **검증**: 유닛, 통합 및 CLI 샌드박스 테스트 커버리지가 CI를 모두 통과해야 합니다.
3.  **마이그레이션 경로**: 모든 주요 `0.x` 파괴적 변경 사항에 대한 명확한 마이그레이션 가이드가 존재해야 합니다.
4.  **LTS 정책**: 패키지에 대한 장기 지원(LTS) 및 보안 패치 정책이 정의되어야 합니다.

---

## 버전 관리 정책 (Versioning Policy)

fluo는 엄격한 **유의적 버전(Semantic Versioning, Semver)**을 따릅니다.

- **Major (`X.0.0`)**: 중대한 파괴적 변경, 아키텍처의 전환 또는 지원 중단된 API의 삭제.
- **Minor (`0.X.0`)**: 새로운 기능 추가, 하위 호환성을 유지하는 개선 또는 문서화된 동작을 보존하는 주요 내부 리팩토링.
- **Patch (`0.0.X`)**: 버그 수정, 보안 패치 및 문서 개선.

### 0.x 단계 (안정화 전)
`0.x` 단계에서는 **Minor** 버전이 파괴적 변경을 위해 사용됩니다. `0.x` 마이너 릴리스의 모든 파괴적 변경은 반드시 `CHANGELOG.md`에 마이그레이션 노트를 동반해야 합니다.

## intended publish surface

- `@fluojs/cache-manager`
- `@fluojs/cli`
- `@fluojs/config`
- `@fluojs/core`
- `@fluojs/cqrs`
- `@fluojs/cron`
- `@fluojs/email`
- `@fluojs/discord`
- `@fluojs/di`
- `@fluojs/drizzle`
- `@fluojs/event-bus`
- `@fluojs/graphql`
- `@fluojs/http`
- `@fluojs/jwt`
- `@fluojs/metrics`
- `@fluojs/microservices`
- `@fluojs/mongoose`
- `@fluojs/notifications`
- `@fluojs/openapi`
- `@fluojs/passport`
- `@fluojs/platform-bun`
- `@fluojs/platform-cloudflare-workers`
- `@fluojs/platform-deno`
- `@fluojs/platform-express`
- `@fluojs/platform-fastify`
- `@fluojs/platform-nodejs`
- `@fluojs/prisma`
- `@fluojs/queue`
- `@fluojs/redis`
- `@fluojs/runtime`
- `@fluojs/serialization`
- `@fluojs/slack`
- `@fluojs/socket.io`
- `@fluojs/studio`
- `@fluojs/terminus`
- `@fluojs/testing`
- `@fluojs/throttler`
- `@fluojs/validation`
- `@fluojs/websockets`

---

## 릴리스 프로세스 및 강제 사항 (Enforcement)

거버넌스는 자동화된 게이트와 수동 체크리스트를 통해 강제됩니다.

### CI/CD 강제 사항
- **`pnpm verify:release-readiness`**: 기본적으로 `CHANGELOG.md`나 release-readiness summary 파일을 변경하지 않고 패키징된 CLI 엔트리포인트, 스타터 스캐폴딩, intended public package manifest dependency range를 검증합니다. canonical release gate의 full-suite 테스트 단계는 main 브랜치 CI의 split workspace Vitest 모델(`pnpm vitest run --project packages`, `apps`, `examples`, `tooling`)을 그대로 재사용하며, monolithic `pnpm test` 경로로 조용히 되돌아가지 않습니다. CI 전용 단건 publish 모드에서는 `--target-package`, `--target-version`, `--dist-tag`를 함께 넘겨 요청한 패키지의 intended publish surface 소속 여부, semver/dist-tag의 프리릴리즈 정합성, 그리고 publish 가능한 내부 `@fluojs/*` dependency shape를 같은 canonical gate에서 강제합니다.
- **`.github/workflows/release-single-package.yml`**: 신뢰된 단건 npm publish를 위한 수동 GitHub Actions 진입점입니다. `package_name`, `package_version`, `dist_tag`, `release_prerelease`를 입력으로 받고, canonical `pnpm verify:release-readiness --target-package --target-version --dist-tag` 게이트를 통과한 뒤에만 git tag와 GitHub Release를 생성합니다.
- **Supervised Release Orchestration**: 릴리스는 `supervised-auto` 정책을 따릅니다. CI 워크플로가 publish 및 태그 생성을 자동화하지만, 리포지토리의 일관성을 위해 최종 리뷰, 머지 및 정리 작업은 중앙 supervisor가 처리합니다.
- **`pnpm generate:release-readiness-drafts`**: 릴리스 노트를 준비할 때 release-readiness summary 산출물과 `CHANGELOG.md` 드래프트 블록을 명시적으로 갱신합니다.

---

## 단건 패키지 릴리스 운영 절차 (Release Operator Flow)

메인테이너는 npm에 개별 패키지를 배포할 때 다음 런북을 따라야 합니다.

### 1. 사전 준비 (Pre-flight)
CI 워크플로를 트리거하기 전에 다음 사항을 확인하십시오.
- `package.json`의 패키지 버전이 업데이트되었으며 의도한 릴리스와 일치하는지 확인하십시오.
- 루트 `CHANGELOG.md`에 일치하는 버전 섹션이 존재하는지 확인하십시오.
- 게이트 실패를 미리 방지하기 위해 로컬에서 `pnpm verify:release-readiness`를 실행하십시오.

### 2. 워크플로 트리거
GitHub의 **Actions** > **Release single package**로 이동하여 **Run workflow**를 클릭하십시오.

| 입력값 | 설명 | 예시 |
| :--- | :--- | :--- |
| `package_name` | 패키지 전체 이름. | `@fluojs/cli` |
| `package_version` | `package.json`에 명시된 정확한 버전. | `0.1.0` |
| `dist_tag` | npm 배포 태그. | `latest` (안정 버전) 또는 `next` |
| `release_prerelease` | 버전명에 하이픈이 포함된 경우 `true`여야 함. | `false` |

### 3. 실행 및 중단 지점 (Stop Points)
워크플로는 다음 단계를 순차적으로 실행합니다.
1. **검증**: 입력값으로 `pnpm verify:release-readiness`를 실행합니다. 패키지가 intended publish surface에 없거나 버전/태그가 일치하지 않으면 실패합니다.
2. **Publish**: OIDC를 통해 npm에 배포합니다 (provenance 활성화). **배포에 실패하면 워크플로가 중단됩니다.**
3. **태깅**: git 태그(예: `@fluojs/cli@0.1.0`)를 생성하고 푸시합니다.
4. **GitHub Release**: 릴리스 요약 산출물(summary artifact)과 changelog 노트를 포함한 릴리스를 생성합니다.

### 4. 롤백 및 재시도 (Rollback & Retry)
- **배포 실패**: 원인(빌드 오류, 매니페스트 범위 등)을 수정하고 동일한 버전으로 워크플로를 재시도하십시오.
- **태그/릴리스 실패**: 패키지가 이미 npm에 올라갔으나 태그/릴리스에 실패한 경우, 수동으로 태그를 생성하거나 워크플로를 다시 실행하십시오. (이미 배포된 버전인 경우 `pnpm publish`가 안전하게 처리하는지 확인하십시오.)

---

## 관련 문서

- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [Public Export TSDoc 기준선](./public-export-tsdoc-baseline.ko.md)
- [NestJS 기능 격차 (NestJS Parity Gaps)](./nestjs-parity-gaps.ko.md)
- [플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)](./platform-conformance-authoring-checklist.ko.md)
- [테스트 가이드 (Testing Guide)](./testing-guide.ko.md)
