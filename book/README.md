# fluo 책 작업 공간

이 디렉터리는 GitHub issue #947에 연결된 **메인테이너급 fluo 입문서 프로젝트**의 작업 공간이다.

목표는 기존 문서를 단순히 복사하는 것이 아니다. 목표는 현재 저장소에 흩어져 있는 fluo 공식 문서, 패키지 README, 실행 가능한 예제, 운영 정책을 하나의 **긴 호흡의 학습 경로**로 재구성하여 장기적으로 600~700페이지 규모의 책으로 키우는 것이다.

## 이 디렉터리에 있는 것

- `SUMMARY.md` — 현재 책 작업 공간의 내비게이션 축
- `source-reference-convention.md` — 실제 fluo 문서/코드를 인용할 때의 출처 규칙
- `outline.md` — 합의된 상위 목차
- `part-map.md` — 파트별 학습 목표, 저장소 자산 매핑, 예상 분량
- `gap-analysis.md` — 현재 저장소가 이미 잘 설명하는 것과 책이 새로 메워야 하는 것
- `chapter-labs.md` — 각 챕터를 실제 예제 파일에 연결하는 실습 앵커 맵
- `chapters/` — 파트 개요와 chapter-level 원고 파일

## 편집 원칙

이 작업 공간은 저장소 안의 실제 fluo 자료를 **단일 진실 공급원**으로 취급한다. 저장소에 근거가 없는 동작을 책 안에서 새로 발명하지 않는다.

- 철학과 온보딩의 큰 흐름은 루트 README와 문서 허브에서 가져온다 `[repo:README.md]` `[repo:docs/README.md]`
- 실행 가능한 학습 순서는 예제 인덱스에서 가져온다 `[ex:README.md]`
- core, DI, runtime, HTTP 축은 개념 문서와 패키지 README를 함께 읽어 설명한다 `[repo:docs/concepts/architecture-overview.md]` `[repo:docs/concepts/di-and-modules.md]` `[repo:docs/concepts/http-runtime.md]` `[pkg:core/README.md]` `[pkg:di/README.md]` `[pkg:runtime/README.md]`
- 기여자/메인테이너 관점은 테스트와 릴리스 거버넌스 문서에 근거한다 `[repo:CONTRIBUTING.md]` `[repo:docs/operations/testing-guide.md]` `[repo:docs/operations/release-governance.md]`

## 가장 중요한 작업 규칙

이 디렉터리 안의 markdown 파일이 **실제 fluo 동작, 코드, 예제, 정책**을 언급할 때는 반드시 `source-reference-convention.md`에 정의된 KSR 규칙으로 출처를 남긴다.

## 현재 작업 범위

이번 단계의 범위는 다음과 같다.

1. 책의 상위 목차를 고정한다.
2. 각 파트를 저장소 안의 실제 자료와 연결한다.
3. chapter-level 파일로 분해해도 유지되는 구조를 만든다.
4. 특히 JavaScript 중급자가 `core → di → runtime → http` 흐름을 따라갈 수 있게 설명의 밀도를 높인다.

## 주요 소스 앵커

- fluo의 정체성과 철학: `[repo:README.md]`
- 공식 문서 허브와 학습 순서: `[repo:docs/README.md]`
- 빠른 시작과 첫 기능 경로: `[repo:docs/getting-started/quick-start.md]` `[repo:docs/getting-started/first-feature-path.md]`
- 예제 읽기 순서: `[ex:README.md]`
- 핵심 구조와 요청 흐름: `[repo:docs/concepts/architecture-overview.md]` `[repo:docs/concepts/di-and-modules.md]` `[repo:docs/concepts/http-runtime.md]`
- 표준 데코레이터와 메타데이터: `[repo:docs/concepts/decorators-and-metadata.md]` `[pkg:core/README.md]` `[pkg:core/src/decorators.ts]`
- DI 컨테이너와 스코프: `[pkg:di/README.md]` `[pkg:di/src/container.ts]` `[pkg:di/src/types.ts]`
