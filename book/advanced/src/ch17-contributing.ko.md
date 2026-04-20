<!-- packages: fluo-repo -->
<!-- project-state: advanced -->
# Chapter 17. fluo Contributing Guide

fluo 시리즈의 마지막 장에 오신 것을 축하드립니다. 여기까지 오셨다면 표준 데코레이터의 복잡성, 의존성 주입, 그리고 고급 런타임 아키텍처를 완전히 마스터하셨다는 뜻입니다. 고급 fluo 개발자로서 논리적인 다음 단계는 프레임워크 자체를 형성하는 데 도움을 주는 것입니다.

fluo에 기여하는 것은 단순히 코드를 작성하는 것 이상입니다. 이는 엄격한 행동 계약(behavioral contracts), 명시적 설계, 그리고 플랫폼에 무관한 신뢰성이라는 문화에 참여하는 것을 의미합니다. 이 가이드는 fluo 저장소 구조, 기여 워크플로우, 그리고 생태계를 안정적으로 유지하는 거버넌스 모델에 대해 깊이 있게 다룹니다.

## Repository Structure and Philosophy

fluo 저장소는 `pnpm`으로 관리되는 고성능 모노레포입니다. 우리의 철학은 **행동 계약(Behavioral Contracts)**을 중심으로 합니다. 이는 모든 변경 사항이 단순히 기능뿐만 아니라, 다양한 런타임(Node.js, Bun, Workers)에서 프레임워크의 예측 가능성에 미치는 영향에 의해 평가됨을 의미합니다.

### Workspace Organization

- `packages/`: 프레임워크의 모듈식 구성 요소를 포함합니다.
- `docs/`: 운영 정책을 포함한 중앙 집중식 문서입니다.
- `examples/`: 검증을 위한 표준 애플리케이션 설정들입니다.
- `.github/`: 워크플로우 정의 및 이슈/PR 템플릿입니다.

`packages/` 디렉토리의 모든 패키지는 자체 테스트 스위트와 문서를 가진 독립된 단위로 취급되지만, 모두 전역 저장소 정책을 준수합니다.

## Issue and Label Workflow

우리는 메인테이너의 시간이 영향력 있는 작업에 집중될 수 있도록 매우 구조화된 이슈 접수 프로세스를 사용합니다.

### Issue Templates

fluo 저장소에서는 빈 이슈(blank issue)가 비활성화되어 있습니다. 모든 이슈는 다음 템플릿 중 하나를 따라야 합니다:
- **Bug Report**: 최소 재현 사례(stackblitz 또는 저장소)가 필요합니다.
- **Feature Request**: 상세한 "이유(Why)"와 "방법(How)" 제안이 필요합니다.
- **Documentation Issue**: 가이드의 누락이나 오류를 수정하기 위한 것입니다.
- **DX/Maintainability**: 개발자를 돕는 내부 개선 사항을 위한 것입니다.

질문은 이슈 트래커가 아닌 **GitHub Discussions**로 유도되어야 합니다.

### Labeling System

이슈는 사용된 템플릿에 따라 자동으로 라벨이 지정됩니다. 주요 라벨은 다음과 같습니다:
- `bug`: 확인된 회귀(regression) 또는 예기치 않은 동작.
- `enhancement`: 새로운 기능 또는 개선 사항.
- `type:maintainability`: 내부 정리 또는 도구 개선.
- `priority:p0` ~ `p2`: 이슈의 심각도.

## Review Culture

fluo에서 Pull Request를 리뷰하는 것은 엄격한 프로세스입니다. 우리는 단순히 "LGTM"만 하지 않고 검증합니다.

### Verification Gate

모든 PR은 다음을 실행하는 `pnpm verify` 명령을 통과해야 합니다:
- 린팅 및 포맷팅 확인.
- 단위 및 통합 테스트.
- 모든 워크스페이스 패키지에 대한 타입 체크.
- 빌드 검증.

### Behavioral Contract Review

고급 기여자로서 여러분의 리뷰는 변경 사항이 기존 계약을 보존하는지에 집중해야 합니다. `@fluojs/di`의 최적화가 `@fluojs/platform-cloudflare-workers`의 스코핑 규칙을 깨뜨리지는 않는지? `@fluojs/core`의 새로운 데코레이터가 TC39 표준을 준수하는지 확인해야 합니다.

### Documentation First

PR이 공개 API를 추가하는 경우, 인라인 문서(JSDoc)와 `docs/` 또는 `packages/*/README.md`의 관련 마크다운 파일 업데이트를 **반드시** 포함해야 합니다. 기능은 문서화되기 전까지 완료된 것이 아닙니다.

## Release Process and Governance

fluo는 높은 안정성을 유지하기 위해 감독된 릴리스 모델을 따릅니다.

### Package Tiers

패키지는 다음 세 가지 계층으로 분류됩니다:
- **Official**: 프로덕션 준비 완료, 엄격한 유의적 버전(semver)을 따름.
- **Preview**: 조기 채택자를 위한 준비 완료, 변경될 수 있음.
- **Experimental**: 인큐베이션 단계, 제거되거나 대폭 변경될 수 있음.

### SEMVER and Migration Notes

0.x 버전에서도 우리는 파괴적 변경(breaking changes)을 신중하게 다룹니다. 모든 파괴적 변경은 해당 패키지의 `CHANGELOG.md`에 상세한 마이그레이션 노트를 작성해야 합니다.

### Release Operations

릴리스 운영은 GitHub Actions를 통해 관리됩니다. 우리는 메인테이너가 `pnpm verify:release-readiness` 통과를 확인한 후 릴리스 워크플로우를 트리거하는 "감독된 자동(supervised-auto)" 모델을 사용합니다. 이는 깨지거나 불완전한 빌드가 실수로 게시되는 것을 방지합니다.

## Governance and RFC Workflow

작은 수정은 직접 PR할 수 있지만, 중요한 아키텍처 변경은 RFC(Request for Comments) 프로세스를 거쳐야 합니다.

### The RFC Path

1. **GitHub Discussions**: 커뮤니티의 관심도와 초기 실현 가능성을 측정하기 위해 "Ideas" 또는 "RFC" 카테고리에 스레드를 시작합니다.
2. **Formal Proposal**: For complex changes, create a markdown proposal (following the example in `packages/graphql/field-resolver-rfc.md`) and open a PR to the `docs/proposals` directory.
3. **Review and Consensus**: 핵심 메인테이너와 커뮤니티가 RFC를 리뷰합니다. 구현을 시작하기 전에 승인이 필요합니다.

### Behavioral Contract Policy

모든 기여자는 `docs/operations/behavioral-contract-policy.md`를 준수해야 합니다. 이 정책은 JavaScript 언어 경로에서 벗어나는 비표준 TypeScript 기능의 사용을 금지함으로써 fluo가 "표준 우선" 프레임워크로 남을 수 있도록 보장합니다.

## Local Development Workflow

fluo 저장소를 로컬에 설정하려면 다음을 실행하세요:

```bash
# Clone the repository
git clone https://github.com/fluojs/fluo.git
cd fluo

# Install dependencies
pnpm install

# Run verification
pnpm verify
```

메인테이너는 격리된 이슈 작업을 위해 **git worktrees**를 사용하는 것이 권장됩니다. 이를 통해 여러 PR이나 버그 수정을 동시에 작업하면서 `main` 브랜치를 깨끗하게 유지할 수 있습니다.

## Final Words

fluo의 강점은 커뮤니티에 있습니다. 프레임워크에 기여함으로써 여러분은 TypeScript 백엔드가 명시적이고, 표준을 준수하며, 플랫폼에 무관한 미래를 구축하는 데 도움을 주게 됩니다. 여러분의 첫 번째 PR을 기다리겠습니다!

---
<!-- lines: 208 -->

















































































