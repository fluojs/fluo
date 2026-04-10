# 파트 IV 개요 — 검증과 메인테이너 트랙

> **기준 소스**: [repo:CONTRIBUTING.md] [repo:docs/operations/testing-guide.md] [repo:docs/operations/release-governance.md]

이 파트는 독자가 단순 사용자를 넘어, fluo를 유지보수하거나 확장할 수 있을 만큼 신뢰 가능한 기여자로 성장하는 경로를 설명한다.

## 파트 목표

1. 테스트 계층을 부록이 아니라 설계의 일부로 이해시킨다.
2. 릴리스 거버넌스와 품질 게이트를 고급 독자에게 명확하게 설명한다.
3. 메인테이너 규율이 일반 앱 사용자 관점과 어떻게 다른지 보여준다.

## 포함될 챕터

### 15장. 테스트 계층과 메인테이너 워크플로우

testing guide는 type safety, unit isolation, module wiring, runtime parity를 검증 계층으로 정리한다. 이 구조가 메인테이너 장의 중심이 된다 `[repo:docs/operations/testing-guide.md]`.

이 장 안에서 `pnpm verify`, worktree 기반 이슈 격리, package maturity, Semver, 안정성 계약을 함께 설명한다 `[repo:CONTRIBUTING.md]` `[repo:docs/operations/release-governance.md]`.

## 메인테이너를 어떻게 설명할 것인가

책은 maintainership를 다음의 결합으로 설명해야 한다.

- runtime boundary를 이해하는 능력
- behavioral contract를 지키는 태도
- docs와 examples를 함께 유지하는 습관
- 변경을 내보내기 전에 verification gate를 통과시키는 규율

이 프레이밍은 contributing 문서와 governance 문서에 직접 근거한다 `[repo:CONTRIBUTING.md]` `[repo:docs/operations/release-governance.md]`.

## 연결 챕터

- `chapter-15-testing-hierarchy-and-maintainer-workflow.md`
