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
- **`pnpm verify:release-readiness`**: 기본적으로 `CHANGELOG.md`나 release-readiness summary 파일을 변경하지 않고 패키징된 CLI 엔트리포인트와 스타터 스캐폴딩을 검증합니다.
- **`pnpm generate:release-readiness-drafts`**: 릴리스 노트를 준비할 때 release-readiness summary 산출물과 `CHANGELOG.md` 드래프트 블록을 명시적으로 갱신합니다.
- **`pnpm verify:platform-consistency-governance`**: 영어와 한국어 문서 간의 구조적 일관성을 강제합니다.
- **`pnpm verify:public-export-tsdoc`**: `packages/*/src` 아래 변경된 public export가 repo-wide TSDoc 최소 기준을 놓치면 실패합니다.
- **`pnpm verify:public-export-tsdoc:baseline`**: 동일한 TSDoc 기준을 전체 governed `packages/*/src` 표면에 적용해 아직 수정되지 않은 누락 파일도 탐지합니다.
- **동작 계약 체크**: `process.env`가 승인된 패턴(`@fluojs/config`) 외부에서 액세스될 경우 릴리스를 차단합니다.

### 변경 이력 표준 (Changelog Standards)
모든 공개 릴리스는 *Keep a Changelog* 형식을 따르는 루트 `CHANGELOG.md`에 일치하는 항목이 있어야 합니다. GitHub 릴리스는 배포 단계에서 이 내용을 바탕으로 자동으로 생성됩니다.

---

## 관련 문서
- [동작 계약 정책 (Behavioral Contract Policy)](./behavioral-contract-policy.ko.md)
- [Public Export TSDoc 기준선](./public-export-tsdoc-baseline.ko.md)
- [NestJS 기능 격차 (NestJS Parity Gaps)](./nestjs-parity-gaps.ko.md)
- [플랫폼 준수 작성 체크리스트 (Platform Conformance Authoring Checklist)](./platform-conformance-authoring-checklist.ko.md)
- [테스트 가이드 (Testing Guide)](./testing-guide.ko.md)
