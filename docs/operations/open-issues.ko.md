# open issues

<p><a href="./open-issues.md"><kbd>English</kbd></a> <strong><kbd>한국어</kbd></strong></p>

이 문서는 현재 GitHub issue backlog를 보기 쉽게 묶어 놓은 색인입니다.

planning의 source of truth는 여전히 GitHub Issues입니다. 이 문서는 현재 열려 있는 issue들을 묶어서 보여주고, 각 issue가 무엇을 다루는지 설명하며, 실무적인 진행 순서를 제안하기 위해서만 존재합니다.

## 현재 source of truth

- canonical planning source -> `konektijs/konekti`의 GitHub Issues
- 현재 ship된 동작 -> `README.md`, `docs/`, `packages/*/README*.md`

## 추천 실행 순서

1. foundation 및 public-contract 정리
2. bootstrap 및 scaffold UX
3. core runtime 및 validation 계약
4. transport 확장
5. auth 기본값 및 ecosystem 확장

## issue 그룹

### foundation 및 public-contract 정리

#### `#1` Retire `konekti-plan` as an active source and finish repo docs migration

- 다루는 내용
  - 이전 planning repo의 마지막 migration 작업을 `konekti`로 마무리
  - `README.md`, `docs/`, package README만 active documentation source가 되도록 정리
  - historical material은 역사 기록으로만 남기고 active truth로 쓰지 않기
- 중요한 이유
  - 현재 truth가 어디에 있는지에 대한 모호함을 없애고 새 문서 모델을 고정함
- 진행 방법
  - 남아 있는 `konekti-plan` 산출물을 마지막으로 한 번 더 감사
  - durable contract가 모두 `docs/` 또는 package README에 있는지 확인
  - retired repo에 의존하는 contributor 흐름이 없어진 뒤에 issue 종료

#### `#2` Decide the public `create-konekti` compatibility wrapper story

- 다루는 내용
  - `create-konekti`를 실제 wrapper로 유지할지, 공개 스토리에서 제거할지 결정
- 중요한 이유
  - bootstrap 메시지와 문서는 실제 계약 하나만 설명해야 함
- 진행 방법
  - wrapper를 구현하거나, 모든 active 공개 문서에서 제거하는 둘 중 하나 선택
  - 유지한다면 `@konekti/cli`와의 보장 범위를 명시

#### `#10` Decide public release evolution for toolchain packages and metadata extension

- 다루는 내용
  - toolchain building block의 향후 패키징
  - third-party metadata/decorator extension 지원 범위
  - 현재 repo docs 정리 이후의 public-release 포지셔닝
- 중요한 이유
  - 릴리스 포지셔닝, package boundary, extension 보장에 직접 영향
- 진행 방법
  - 무엇이 internal-only인지 먼저 고정
  - 어떤 tooling 조각이 public package가 될지 결정
  - 광고하기 전에 extension 지원 범위를 명확히 결정

### bootstrap 및 scaffold UX

#### `#6` Decide scaffold evolution beyond the current CLI bootstrap flow

- 다루는 내용
  - package-manager별 출력 커스터마이징
  - current-directory 초기화 지원
- 중요한 이유
  - 첫 실행 경험과 starter 기대치를 결정함
- 진행 방법
  - canonical bootstrap contract를 먼저 안정화
  - end-to-end로 문서화와 테스트가 가능한 옵션만 추가

### core runtime 및 validation 계약

#### `#4` Decide future HTTP and runtime API expansion points

- 다루는 내용
  - transport-neutral `handler(requestObject)` API 가능성
  - first-class response wrapper
  - route-level middleware 개방 여부
  - richer custom guard 결과
- 중요한 이유
  - docs 정리 이후 가장 영향이 큰 framework surface 결정
- 진행 방법
  - decorator나 transport 계약을 넓히기 전에 runtime boundary부터 결정
  - 강한 use case 없이 dispatcher 명확성을 해치는 항목은 reject 또는 defer

#### `#3` Plan validation and DTO evolution beyond the current decorator model

- 다루는 내용
  - schema-object validation의 first-class 경로화
  - richer validation adapter interface
- 중요한 이유
  - request binding과 validation은 핵심 DX 계약이므로, 확장 시 docs/generator/test 전부에 영향
- 진행 방법
  - `#4` 이후 진행해서, 선택된 runtime/request 모델 위에서 DTO 방향을 결정

### transport 확장

#### `#9` Explore future non-HTTP transport and gateway model

- 다루는 내용
  - non-HTTP transport boundary model
  - gateway/websocket 실행 모델과 package surface
- 중요한 이유
  - future transport는 HTTP semantics를 흐리기보다 현재 framework contract를 재사용해야 함
- 진행 방법
  - `#4` 이후에 진행
  - 구현 전에 package boundary, lifecycle, ownership부터 정의

### auth 기본값 및 ecosystem 확장

#### `#7` Define the official auth product policy defaults

- 다루는 내용
  - bearer vs HttpOnly cookie 기본 권장안
  - refresh token lifecycle 및 rotation
  - logout/revoke 동작
  - identity source 간 account-linking 정책
- 중요한 이유
  - examples, starter guidance, public policy가 하나의 coherent auth story에 의존함
- 진행 방법
  - strategy-generic foundation은 유지
  - 문서/예제를 확장하기 전에 하나의 official default story를 선택

#### `#5` Track future support-matrix and data-layer expansion

- 다루는 내용
  - future ORM x DB 조합
  - integration이 template-level로 남을지 public package가 될지
  - MongoDB 같은 matrix 밖 후보
- 중요한 이유
  - support claim은 docs, CI, examples, package shape 전부에 영향
- 진행 방법
  - 새 stack을 승격할 때는 docs + tests + examples + support-tier 기준을 함께 요구

#### `#8` Plan the next expansion of `@konekti/testing`

- 다루는 내용
  - testing API를 어디까지 확장할지
  - generated test template를 얼마나 풍부하게 만들지
- 중요한 이유
  - testing은 지원되는 runtime/package workflow를 따라가야지, 먼저 앞서 나가면 안 됨
- 진행 방법
  - public bootstrap/auth/support 기본값이 더 명확해진 뒤 진행
  - 실제 사용자 workflow가 있는 경우에만 helper 확장

## 실무적인 다음 순서

지금 바로 진행한다면 가장 효율적인 순서는 다음과 같습니다.

1. `#1`
2. `#2`
3. `#10`
4. `#6`
5. `#4`
6. `#3`
7. `#9`
8. `#7`
9. `#5`
10. `#8`

## 유지 규칙

어떤 issue가 해결되면:

- GitHub issue를 닫고
- 영향을 받는 `docs/` 주제와 package README를 업데이트하고
- backlog 구조 자체가 바뀐 경우에만 이 파일을 수정합니다.
